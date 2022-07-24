import { statSync, lstatSync, existsSync } from "fs";
import { resolve, dirname, join, basename, relative } from "path";
import * as core from "@actions/core";
import glob from "glob";
import { Client, SFTPWrapper, ConnectConfig } from "ssh2";

const host: string = core.getInput("host", { required: true });
const username: string = core.getInput("username", { required: true });
const password: string = core.getInput("password");
const port: number = parseInt(core.getInput("port")) || 22;
const privateKey: string = core.getInput("private_key");
const proxyHost: string = core.getInput("proxy_host");
const proxyUsername: string = core.getInput("proxy_username");
const proxyPassword: string = core.getInput("proxy_password");
const proxyPort: number = parseInt(core.getInput("proxy_port")) || 22;
const proxyPrivateKey: string = core.getInput("proxy_private_key");
const local: string = core.getInput("local", { required: true });
const remote: string = core.getInput("remote", { required: true });

core.setSecret("password");
core.setSecret("key");
core.setSecret("proxy_password");
core.setSecret("proxy_key");

const connect = (
  client: Client,
  config: ConnectConfig,
  proxyConfig?: ConnectConfig
) =>
  new Promise<Client>((resolve, reject) => {
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

        const forwardedClient = await connect(new Client(), {
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

const putFile = (sftp: SFTPWrapper, local: string, remote: string) =>
  new Promise<void>((resolve, reject) => {
    // TODO: Preserve file permissions flag, flag when file is 400 or lower
    sftp.fastPut(local, remote, { mode: statSync(local).mode }, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });

const exec = (client: Client, command: string) =>
  new Promise<void>((resolve, reject) => {
    client.exec(command, (err, channel) => {
      if (err) {
        reject(err);
      }

      let stdErr: string[] = [];

      channel.stderr.on("data", (chunk: Buffer) => {
        stdErr.push(chunk.toString());
      });

      channel.on("data", (chunk: Buffer) => {
        console.log(chunk.toString());
      });

      channel.on("close", () => {
        if (stdErr.length) return reject(stdErr.join("\n"));
        resolve();
      });
    });
  });

const handleError = (e: unknown) => {
  console.log(
    "Encountered an error. Full details:\n",
    "\x1b[31m",
    e,
    "\x1b[0m"
  );
  core.setFailed(e instanceof Error ? e : "Encountered an error");
};

function* splitToChunks<T>(arr: T[], n: number) {
  for (let i = 0; i < arr.length; i += n) {
    yield arr.slice(i, i + n);
  }
}

async function main() {
  const client = await connect(
    new Client(),
    // Host Config
    { host, username, password, port, privateKey },
    // Proxy config
    proxyHost
      ? {
          host: proxyHost,
          port: proxyPort,
          username: proxyUsername,
          password: proxyPassword,
          privateKey: proxyPrivateKey,
        }
      : undefined
  ).catch(handleError);

  if (!client) return;

  try {
    const sftp = await requestSFTP(client);
    const localTrailingSlash = local.endsWith("/");

    // Checks
    if (!existsSync(local) || !lstatSync(local).isDirectory()) {
      throw new Error(`Local "${local}" is not a directory`);
    }

    const globOptions: glob.IOptions = {
      absolute: true,
      dot: true,
      ignore: ["node_modules/**/*", ".git/**/*"],
      matchBase: true,
    };

    const directories = glob.sync(local + "**/*/", globOptions);
    // If there's no trailing slash we should also create the local directory on the remote
    if (!localTrailingSlash) directories.push(resolve(local));

    const files = glob.sync(local + "/**/*", {
      ...globOptions,
      nodir: true,
    });

    // Sort short to long
    directories.sort((a, b) => a.length - b.length);

    // Make directories
    for (const dir of directories) {
      const remoteDirPath = join(
        remote,
        relative(localTrailingSlash ? local : dirname(local), dir)
      );

      try {
        await exec(client, `mkdir -p ${remoteDirPath}`);
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
          remote,
          relative(localTrailingSlash ? local : dirname(local), dirname(f)),
          basename(f)
        );

        return putFile(sftp, f, remoteFilePath)
          .then(() => console.log(`✅ Uploaded ${remoteFilePath}`))
          .catch((e) => console.log(`🛑 Error with file ${f}`, e));
      });

      await Promise.all(putFiles);
    }
  } catch (e) {
    handleError(e);
  } finally {
    client.end();
  }
}

main();
