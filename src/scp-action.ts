import { statSync, lstatSync, existsSync } from "node:fs";
import { resolve, dirname, join, basename, relative } from "node:path";
import * as core from "@actions/core";
import { globSync } from "glob";
import type { GlobOptionsWithFileTypesFalse } from "glob";
import { Client } from "ssh2";
import type { SFTPWrapper, ConnectConfig } from "ssh2";

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

    client.on("close", () => {
      reject(new Error("No response from server"));
    });
  });

const end = (client: Client) =>
  new Promise<void>((resolve) => {
    client.on("end", () => {
      console.log("🌐 Connection end");
      resolve();
    });

    client.end();
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
      },
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
  new Promise<void>((resolve, reject) => {
    client.exec(command, (err, channel) => {
      if (err) {
        reject(err);
      }

      channel.stderr.on("data", (chunk: Buffer) =>
        process.stderr.write(`err: ${chunk.toString()}`),
      );

      channel.on("data", (chunk: Buffer) =>
        process.stdout.write(`out: ${chunk.toString()}`),
      );

      channel.on("close", resolve);
    });
  });

const execPrettyPrint = async (
  client: Client,
  command: string,
  dryRun = false,
) => {
  console.log("🔸 Executing command");
  console.log("------ command ------");
  console.log(command);
  console.log("------ output -------");
  !dryRun ? await exec(client, command) : console.log("[DRY-RUN] No output");
  console.log("---------------------");
};

function* splitMapToChunks(map: Map<string, string>, n: number) {
  for (let i = 0; i < map.size; i += n) {
    yield Array.from(map).slice(i, i + n);
  }
}

export const handleError = (e: unknown) => {
  console.log(
    "Encountered an error. Full details:\n",
    "\x1b[31m",
    e,
    "\x1b[0m",
  );
  core.setFailed(e instanceof Error ? e : "Encountered an error");
};

export async function run() {
  const source = core.getMultilineInput("source") || [];
  const target = core.getInput("target");
  const command = core.getInput("command");
  const commandAfter = core.getInput("command_after");
  const dryRun = core.getBooleanInput("dry_run");
  const preserveHierarchy = core.getBooleanInput("preserve_hierarchy");

  const hostConfig = {
    host: core.getInput("host", { required: true }),
    username: core.getInput("username", { required: true }),
    password: core.getInput("password"),
    port: Number.parseInt(core.getInput("port")) || 22,
    privateKey: core.getInput("private_key"),
  };

  const proxyConfig = {
    host: core.getInput("proxy_host"),
    username: core.getInput("proxy_username"),
    password: core.getInput("proxy_password"),
    port: Number.parseInt(core.getInput("proxy_port")) || 22,
    privateKey: core.getInput("proxy_private_key"),
  };

  const client = await connect(
    hostConfig,
    proxyConfig.host ? proxyConfig : undefined,
  ).catch(handleError);

  if (!client) return false;

  try {
    const sftp = await requestSFTP(client);

    const globOptions: GlobOptionsWithFileTypesFalse = {
      withFileTypes: false,
      dot: core.getBooleanInput("include_dotfiles"),
      ignore: ["node_modules/**/*", ".git/**/*"],
    };

    // Checks
    for (const s of source) {
      if (!existsSync(s) || !lstatSync(s).isDirectory()) {
        throw new Error(`Source "${source}" is not a directory`);
      }
    }

    // Search all directories for each line in source and return its remote counterpart path
    const [directories, files] = source.reduce(
      ([directories, files], searchDir) => {
        const localDirs = globSync(`${searchDir}/**/*/`, globOptions);
        const pathBase = preserveHierarchy
          ? "."
          : searchDir.endsWith("/")
            ? searchDir
            : dirname(searchDir);

        // If there's no trailing slash we should also create the local directory on the remote
        if (!searchDir.endsWith("/") || preserveHierarchy)
          localDirs.push(resolve(searchDir));

        const remoteDirs = localDirs.map((localDir) =>
          join(target, relative(pathBase, localDir)),
        );

        const localFiles = globSync(`${searchDir}/**/*`, {
          ...globOptions,
          nodir: true,
        });

        // Create a new file map and prepend the current found files
        const fileMap = new Map<string, string>(
          (function* () {
            yield* files;
            yield* localFiles.map(
              (f) =>
                [
                  f,
                  join(target, relative(pathBase, dirname(f)), basename(f)),
                ] as [string, string],
            );
          })(),
        );

        return [[...directories, ...remoteDirs], fileMap];
      },
      [[] as string[], new Map<string, string>()],
    );

    // Sort short to long
    directories.sort((a, b) => a.length - b.length);

    // Execute command
    if (command) await execPrettyPrint(client, command, dryRun);

    // Make directories
    for (const dir of directories) {
      try {
        !dryRun && (await exec(client, `mkdir -p ${dir}`));
        console.log(
          `📁 ${dryRun ? "[DRY-RUN] " : ""}Created remote dir ${dir}`,
        );
      } catch (e) {
        console.log(`🛑 There was a problem creating folder ${dir}`);
        throw e;
      }
    }

    // Upload files
    for (const chunk of splitMapToChunks(files, 64)) {
      const putFiles = chunk.map(([f, remoteFilePath]) =>
        !dryRun
          ? putFile(sftp, f, remoteFilePath)
              .then(() => console.log(`✅ Uploaded ${remoteFilePath}`))
              .catch((e) => {
                console.log(`🛑 Error with file ${f}`, e);
                throw e;
              })
          : Promise.resolve(),
      );

      await Promise.all(putFiles);
    }

    // Execute command after
    if (commandAfter) await execPrettyPrint(client, commandAfter, dryRun);
  } catch (e) {
    handleError(e);
  } finally {
    await end(client);
  }
}
