"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleError = exports.exec = exports.putFile = exports.connect = void 0;
exports.run = run;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const core = __importStar(require("@actions/core"));
const glob_1 = require("glob");
const ssh2_1 = require("ssh2");
core.setSecret("password");
core.setSecret("key");
core.setSecret("proxy_password");
core.setSecret("proxy_key");
const connect = (config, proxyConfig) => new Promise((resolve, reject) => {
    const client = new ssh2_1.Client();
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
exports.connect = connect;
const end = (client) => new Promise((resolve) => {
    client.on("end", () => {
        console.log("🌐 Connection end");
        resolve();
    });
    client.end();
});
const jumpHost = (client, config) => new Promise((resolve, reject) => {
    if (!config.host)
        return reject("Supply proxy host");
    client.forwardOut("localhost", 0, config.host, config.port || 22, (err, stream) => __awaiter(void 0, void 0, void 0, function* () {
        if (err)
            return reject(err);
        const forwardedClient = yield (0, exports.connect)(Object.assign({ sock: stream }, config));
        // Close the original client when we call end on the forwardedClient
        forwardedClient.on("end", () => {
            client.end();
        });
        resolve(forwardedClient);
    }));
});
const requestSFTP = (client) => new Promise((resolve, reject) => {
    client.on("error", reject);
    client.sftp((err, res) => {
        client.removeListener("error", reject);
        if (err) {
            reject(err);
        }
        resolve(res);
    });
});
const putFile = (sftp, source, target) => new Promise((resolve, reject) => {
    // TODO: Preserve file permissions flag, flag when file is 400 or lower
    sftp.fastPut(source, target, { mode: (0, node_fs_1.statSync)(source).mode }, (err) => {
        if (err)
            return reject(err);
        resolve();
    });
});
exports.putFile = putFile;
const exec = (client, command) => new Promise((resolve, reject) => {
    client.exec(command, (err, channel) => {
        if (err) {
            reject(err);
        }
        channel.stderr.on("data", (chunk) => process.stderr.write(`err: ${chunk.toString()}`));
        channel.on("data", (chunk) => process.stdout.write(`out: ${chunk.toString()}`));
        channel.on("close", resolve);
    });
});
exports.exec = exec;
const execPrettyPrint = (client_1, command_1, ...args_1) => __awaiter(void 0, [client_1, command_1, ...args_1], void 0, function* (client, command, dryRun = false) {
    console.log("🔸 Executing command");
    console.log("------ command ------");
    console.log(command);
    console.log("------ output -------");
    !dryRun ? yield (0, exports.exec)(client, command) : console.log("[DRY-RUN] No output");
    console.log("---------------------");
});
function* splitMapToChunks(map, n) {
    for (let i = 0; i < map.size; i += n) {
        yield Array.from(map).slice(i, i + n);
    }
}
const handleError = (e) => {
    console.log("Encountered an error. Full details:\n", "\x1b[31m", e, "\x1b[0m");
    core.setFailed(e instanceof Error ? e : "Encountered an error");
};
exports.handleError = handleError;
function run() {
    return __awaiter(this, void 0, void 0, function* () {
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
        const client = yield (0, exports.connect)(hostConfig, proxyConfig.host ? proxyConfig : undefined).catch(exports.handleError);
        if (!client)
            return false;
        try {
            const sftp = yield requestSFTP(client);
            const globOptions = {
                withFileTypes: false,
                dot: core.getBooleanInput("include_dotfiles"),
                ignore: ["node_modules/**/*", ".git/**/*"],
            };
            // Checks
            for (const s of source) {
                if (!(0, node_fs_1.existsSync)(s) || !(0, node_fs_1.lstatSync)(s).isDirectory()) {
                    throw new Error(`Source "${source}" is not a directory`);
                }
            }
            // Search all directories for each line in source and return its remote counterpart path
            const [directories, files] = source.reduce(([directories, files], searchDir) => {
                const localDirs = (0, glob_1.globSync)(`${searchDir}/**/*/`, globOptions);
                const pathBase = preserveHierarchy
                    ? "."
                    : searchDir.endsWith("/")
                        ? searchDir
                        : (0, node_path_1.dirname)(searchDir);
                // If there's no trailing slash we should also create the local directory on the remote
                if (!searchDir.endsWith("/") || preserveHierarchy)
                    localDirs.push((0, node_path_1.resolve)(searchDir));
                const remoteDirs = localDirs.map((localDir) => (0, node_path_1.join)(target, (0, node_path_1.relative)(pathBase, localDir)));
                const localFiles = (0, glob_1.globSync)(`${searchDir}/**/*`, Object.assign(Object.assign({}, globOptions), { nodir: true }));
                // Create a new file map and prepend the current found files
                const fileMap = new Map((function* () {
                    yield* files;
                    yield* localFiles.map((f) => [
                        f,
                        (0, node_path_1.join)(target, (0, node_path_1.relative)(pathBase, (0, node_path_1.dirname)(f)), (0, node_path_1.basename)(f)),
                    ]);
                })());
                return [[...directories, ...remoteDirs], fileMap];
            }, [[], new Map()]);
            // Sort short to long
            directories.sort((a, b) => a.length - b.length);
            // Execute command
            if (command)
                yield execPrettyPrint(client, command, dryRun);
            // Make directories
            for (const dir of directories) {
                try {
                    !dryRun && (yield (0, exports.exec)(client, `mkdir -p ${dir}`));
                    console.log(`📁 ${dryRun ? "[DRY-RUN] " : ""}Created remote dir ${dir}`);
                }
                catch (e) {
                    console.log(`🛑 There was a problem creating folder ${dir}`);
                    throw e;
                }
            }
            // Upload files
            for (const chunk of splitMapToChunks(files, 64)) {
                const putFiles = chunk.map(([f, remoteFilePath]) => !dryRun
                    ? (0, exports.putFile)(sftp, f, remoteFilePath)
                        .then(() => console.log(`✅ Uploaded ${remoteFilePath}`))
                        .catch((e) => {
                        console.log(`🛑 Error with file ${f}`, e);
                        throw e;
                    })
                    : Promise.resolve());
                yield Promise.all(putFiles);
            }
            // Execute command after
            if (commandAfter)
                yield execPrettyPrint(client, commandAfter, dryRun);
        }
        catch (e) {
            (0, exports.handleError)(e);
        }
        finally {
            yield end(client);
        }
    });
}
