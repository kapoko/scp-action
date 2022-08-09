import { statSync, lstatSync, existsSync } from "fs";
import { resolve, dirname, join, basename, relative } from "path";
import * as core from "@actions/core";
import glob from "glob";
import { Client, SFTPWrapper, ConnectConfig } from "ssh2";

core.setSecret("password");
core.setSecret("key");
core.setSecret("proxy_password");
core.setSecret("proxy_key");

export const connect = (config: ConnectConfig, proxyConfig?: ConnectConfig) =>
  new Promise<Client>((resolve, reject) => {
    const client = new Client();

    // If there's a proxy supplied first connect there
    client.connect(proxyConfig ? proxyConfig : config);

    client.on("error", reject);

    client.on("ready", () => {
      client.removeListener("error", reject);
      console.log("🌐 Connection ready");

      if (proxyConfig) {
        const forwardedClient = jumpHost(client, config);
        return resolve(forwardedClient);
      }

      resolve(client);
    });

    client.on("end", () => {
      console.log("🌐 Connection end");
    });

    client.on("close", () => {
      reject(new Error("No response from server"));
    });
  });

const jumpHost = (client: Client, config: ConnectConfig) =>
  new Promise<Client>((resolve, reject) => {
    if (!config.host) return reject("Supply proxy host");

    client.forwardOut(
      "localhost",
      0,
      config.host,
      config.port || 22,
      async (err, stream) => {
        if (err) return reject(err);

        const forwardedClient = await connect({
          sock: stream,
          ...config,
        });

        // Close the original client when we call end on the forwardedClient
        forwardedClient.on("end", () => {
          client.end();
        });

        resolve(forwardedClient);
      }
    );
  });

const requestSFTP = (client: Client) =>
  new Promise<SFTPWrapper>((resolve, reject) => {
    client.on("error", reject);
    client.sftp((err, res) => {
      client.removeListener("error", reject);
      if (err) {
        reject(err);
      }

      resolve(res);
    });
  });

export const putFile = (sftp: SFTPWrapper, source: string, target: string) =>
  new Promise<void>((resolve, reject) => {
    // TODO: Preserve file permissions flag, flag when file is 400 or lower
    sftp.fastPut(source, target, { mode: statSync(source).mode }, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });

export const exec = (client: Client, command: string) =>
  new Promise<string[]>((resolve, reject) => {
    client.exec(command, (err, channel) => {
      if (err) {
        reject(err);
      }

      let output: string[] = [];

      channel.stderr.on("data", (chunk: Buffer) => {
        output.push("err: " + chunk.toString());
      });

      channel.on("data", (chunk: Buffer) => {
        output.push("out: " + chunk.toString());
      });

      channel.on("close", () => {
        resolve(output);
      });
    });
  });

const execPrettyPrint = async (client: Client, command: string) => {
  console.log(`🔸 Executing command`);
  console.log(`----- command -----`);
  console.log(command);
  console.log(`----- output ------`);
  const result = await exec(client, command);
  result.map((str) => process.stdout.write(str));
  console.log(`-------------------`);
};

const handleError = (e: unknown) => {
  console.log(
    "Encountered an error. Full details:\n",
    "\x1b[31m",
    e,
    "\x1b[0m"
  );
  core.setFailed(e instanceof Error ? e : "Encountered an error");
};

export function* splitToChunks<T>(arr: T[], n: number) {
  for (let i = 0; i < arr.length; i += n) {
    yield arr.slice(i, i + n);
  }
}

export async function run() {
  const source = core.getInput("source", { required: true });
  const target = core.getInput("target", { required: true });
  const command = core.getInput("command");
  const commandAfter = core.getInput("command_after");
  const dryRun = core.getBooleanInput("dry_run");

  const hostConfig = {
    host: core.getInput("host", { required: true }),
    username: core.getInput("username", { required: true }),
    password: core.getInput("password"),
    port: parseInt(core.getInput("port")) || 22,
    privateKey: core.getInput("private_key"),
  };

  const proxyConfig = {
    host: core.getInput("proxy_host"),
    username: core.getInput("proxy_username"),
    password: core.getInput("proxy_password"),
    port: parseInt(core.getInput("proxy_port")) || 22,
    privateKey: core.getInput("proxy_private_key"),
  };

  const client = await connect(
    hostConfig,
    proxyConfig.host ? proxyConfig : undefined
  ).catch(handleError);

  if (!client) return false;

  try {
    const sftp = await requestSFTP(client);
    const sourceTrailingSlash = source.endsWith("/");

    // Checks
    if (!existsSync(source) || !lstatSync(source).isDirectory()) {
      throw new Error(`Source "${source}" is not a directory`);
    }

    const globOptions: glob.IOptions = {
      dot: core.getBooleanInput("include_dotfiles"),
      ignore: ["./node_modules/**/*", "./.git/**/*"],
    };

    const directories = glob.sync(source + "**/*/", globOptions);
    // If there's no trailing slash we should also create the local directory on the remote
    if (!sourceTrailingSlash) directories.push(resolve(source));

    const files = glob.sync(source + "/**/*", {
      ...globOptions,
      nodir: true,
    });

    // Sort short to long
    directories.sort((a, b) => a.length - b.length);

    // Execute command
    if (!dryRun && command) await execPrettyPrint(client, command);

    // Make directories
    for (const dir of directories) {
      const remoteDirPath = join(
        target,
        relative(sourceTrailingSlash ? source : dirname(source), dir)
      );

      try {
        !dryRun && (await exec(client, `mkdir -p ${remoteDirPath}`));
        console.log(`📁 Created remote dir ${remoteDirPath}`);
      } catch (e) {
        console.log(`🛑 There was a problem creating folder ${remoteDirPath}`);
        throw e;
      }
    }

    // Upload files
    for (const chunk of [...splitToChunks(files, 64)]) {
      const putFiles = chunk.map((f) => {
        const remoteFilePath = join(
          target,
          relative(sourceTrailingSlash ? source : dirname(source), dirname(f)),
          basename(f)
        );

        return !dryRun
          ? putFile(sftp, f, remoteFilePath)
              .then(() => console.log(`✅ Uploaded ${remoteFilePath}`))
              .catch((e) => console.log(`🛑 Error with file ${f}`, e))
          : Promise.resolve();
      });

      await Promise.all(putFiles);
    }

    // Execute command after
    if (!dryRun && commandAfter) await execPrettyPrint(client, commandAfter);
  } catch (e) {
    handleError(e);
  } finally {
    client.end();
  }
}
