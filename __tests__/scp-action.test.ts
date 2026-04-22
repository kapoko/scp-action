import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { Client } from "ssh2";
import type { InputOptions } from "../src/core.js";
import { core } from "../src/core.js";
import * as action from "../src/scp-action";
import { actionApi } from "../src/scp-action";

type TestInputValue = string | number | boolean | string[] | null | undefined;

type TestInputs = {
  host?: string;
  port?: number;
  username?: string;
  private_key?: string;
  include_dotfiles?: boolean;
  dry_run?: boolean;
  source?: string[] | null;
  target?: string | null;
  preserve_hierarchy?: boolean;
  command?: string;
  command_after?: string;
  [key: string]: TestInputValue;
};

let inputs: TestInputs = {
  host: process.env.SSH_HOST ?? process.env.HOST,
  port: Number.parseInt(process.env.SSH_PORT ?? process.env.PORT ?? "", 10),
  username: process.env.SSH_USERNAME ?? process.env.USERNAME,
  private_key: process.env.SSH_PRIVATE_KEY ?? process.env.PRIVATE_KEY,
  include_dotfiles: true,
  dry_run: false,
  source: ["src", "dist/build"],
  target: "scp-action-test",
  preserve_hierarchy: false,
};
const inputsPristine = Object.freeze(inputs);

let client: Client;
const describeIntegration =
  process.env.RUN_INTEGRATION === "true" ? describe : describe.skip;

describe("smoke", () => {
  it("loads action module", () => {
    expect(action).toBeDefined();
  });
});

const mockGetInput = () => {
  const mock = (name: string, options?: InputOptions) => {
    if (options?.required && !inputs[name]) {
      throw new Error(`Input '${name}' is required`);
    }
    return inputs[name];
  };

  beforeAll(() => {
    jest.spyOn(core, "getInput").mockImplementation(mock);
    jest.spyOn(core, "getMultilineInput").mockImplementation(mock);
    jest
      .spyOn(core, "getBooleanInput")
      .mockImplementation((name: string) => !!inputs[name]);
  });
};

describeIntegration("ssh client", () => {
  mockGetInput();

  it("can connect with a private key", async () => {
    client = await action.connect({
      host: inputs.host,
      username: inputs.username,
      port: inputs.port,
      privateKey: inputs.private_key,
    });

    expect(client).toBeInstanceOf(Client);
    expect(client).toHaveProperty("config.host", inputs.host);
  });

  it("can connect with a password", async () => {
    client = await action.connect({
      host: inputs.host,
      username: inputs.username,
      port: inputs.port,
      password: process.env.PASSWORD,
    });

    expect(client).toBeInstanceOf(Client);
    expect(client).toHaveProperty("config.host", inputs.host);
  });

  it("can connect through a proxy", async () => {
    client = await action.connect(
      {
        host: process.env.SECOND_SSH_HOST ?? process.env.SECOND_HOST,
        username:
          process.env.SECOND_SSH_USERNAME ?? process.env.SECOND_USERNAME,
        port: Number.parseInt(
          process.env.SECOND_SSH_PORT ?? process.env.SECOND_PORT ?? "",
          10,
        ),
        privateKey:
          process.env.SECOND_SSH_PRIVATE_KEY ?? process.env.SECOND_PRIVATE_KEY,
      },
      {
        host: inputs.host,
        username: inputs.username,
        port: inputs.port,
        privateKey: inputs.private_key,
      },
    );

    expect(client).toBeInstanceOf(Client);
    expect(client).toHaveProperty("config.host", process.env.SECOND_HOST);
  });

  afterEach(() => {
    if (client) client.end();
  });

  it("rejects when given non-existing host", async () => {
    const connection = action.connect({
      host: "non_existing_host",
      username: inputs.username,
    });

    expect(connection).rejects.toThrow();
  });
});

describeIntegration("action", () => {
  let stdoutWriteSpy: jest.SpiedFunction<typeof process.stdout.write>;
  beforeAll(() => {
    stdoutWriteSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
  });
  afterAll(() => {
    stdoutWriteSpy.mockRestore();
  });

  afterEach(() => {
    inputs = inputsPristine;
  });

  mockGetInput();

  it("runs", async () => {
    const failed = jest.spyOn(core, "setFailed");
    const handleError = jest.spyOn(actionApi, "handleError");

    const run = action.run();

    await expect(run).resolves.not.toThrow();
    expect(handleError).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled();
  });

  it("executes commands", async () => {
    inputs = {
      ...inputsPristine,
      command: "echo hello",
      command_after: "echo there!",
    };

    await action.run();

    expect(process.stdout.write).toHaveBeenCalledWith("out: hello\n");
    expect(process.stdout.write).toHaveBeenCalledWith("out: there!\n");
  });

  it("execute commands without supplying source & target paths", async () => {
    inputs = {
      ...inputsPristine,
      source: null,
      target: null,
      command: "echo hello",
    };

    const putFile = jest.spyOn(actionApi, "putFile");

    await action.run();

    expect(putFile).not.toHaveBeenCalled();
    expect(process.stdout.write).toHaveBeenCalledWith("out: hello\n");
  });

  it("doesn't upload hidden files when include_dotfiles is false", async () => {
    inputs = {
      ...inputsPristine,
      include_dotfiles: false,
      source: ["."],
    };

    const putFile = jest.spyOn(actionApi, "putFile");

    await action.run();

    expect(putFile).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.stringMatching(/.env.example$/),
      expect.anything(),
    );
  });

  it("doesn't execute commands or upload files when dry_run is true", async () => {
    inputs = { ...inputsPristine, dry_run: true };

    const putFile = jest.spyOn(actionApi, "putFile");
    const exec = jest.spyOn(actionApi, "exec");

    await action.run();

    expect(putFile).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
  });

  it("uploads multiple source folders", async () => {
    inputs = { ...inputsPristine, source: ["src", ".github"] };

    const putFile = jest.spyOn(actionApi, "putFile");

    await action.run();

    expect(putFile).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringMatching(/tests.yml$/),
      expect.anything(),
    );

    expect(putFile).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringMatching(/index.cts$/),
      expect.anything(),
    );
  });

  it("preserves hierarchy when it needs to", async () => {
    inputs = {
      ...inputsPristine,
      preserve_hierarchy: true,
      source: ["src", ".github/workflows/"],
    };

    const exec = jest.spyOn(actionApi, "exec");
    const putFile = jest.spyOn(actionApi, "putFile");

    await action.run();

    expect(exec).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringMatching(/.github\/workflows/),
    );

    expect(putFile).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringMatching(/.github\/workflows\/tests.yml/),
      expect.anything(),
    );
  });
});
