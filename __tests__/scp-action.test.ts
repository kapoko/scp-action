import { expect, describe, beforeAll } from "@jest/globals";
import * as core from "@actions/core";

import { Client } from "ssh2";
import * as action from "../src/scp-action";

let inputs = {
  host: process.env.HOST,
  port: Number.parseInt(process.env.PORT || ""),
  username: process.env.USERNAME,
  private_key: process.env.PRIVATE_KEY,
  include_dotfiles: true,
  dry_run: false,
  source: ["src", "dist/build"],
  target: "scp-action-test",
  preserve_hierarchy: false,
} as any;
const inputsPristine = Object.freeze(inputs);

let client: Client;

const mockGetInput = () => {
  const mock = (name: string, options?: core.InputOptions) => {
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

describe("ssh client", () => {
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
        host: process.env.SECOND_HOST,
        username: process.env.SECOND_USERNAME,
        port: Number.parseInt(process.env.SECOND_PORT || ""),
        privateKey: process.env.SECOND_PRIVATE_KEY,
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

describe("action", () => {
  beforeAll(() => {
    process.stdout.write = jest.fn();
  });

  afterEach(() => {
    inputs = inputsPristine;
  });

  mockGetInput();

  it("runs", async () => {
    const failed = jest.spyOn(core, "setFailed");
    const handleError = jest.spyOn(action, "handleError");

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

    const putFile = jest.spyOn(action, "putFile");

    await action.run();

    expect(putFile).not.toBeCalled();
    expect(process.stdout.write).toHaveBeenCalledWith("out: hello\n");
  });

  it("doesn't upload hidden files when include_dotfiles is false", async () => {
    inputs = {
      ...inputsPristine,
      include_dotfiles: false,
      source: ["."],
    };

    const putFile = jest.spyOn(action, "putFile");

    await action.run();

    expect(putFile).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.stringMatching(/.env.example$/),
      expect.anything(),
    );
  });

  it("doesn't execute commands or upload files when dry_run is true", async () => {
    inputs = { ...inputsPristine, dry_run: true };

    const putFile = jest.spyOn(action, "putFile");
    const exec = jest.spyOn(action, "exec");

    await action.run();

    expect(putFile).not.toBeCalled();
    expect(exec).not.toBeCalled();
  });

  it("uploads multiple source folders", async () => {
    inputs = { ...inputsPristine, source: ["src", ".github"] };

    const putFile = jest.spyOn(action, "putFile");

    await action.run();

    expect(putFile).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringMatching(/tests.yml$/),
      expect.anything(),
    );

    expect(putFile).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringMatching(/index.ts$/),
      expect.anything(),
    );
  });

  it("preserves hierarchy when it needs to", async () => {
    inputs = {
      ...inputsPristine,
      preserve_hierarchy: true,
      source: ["src", ".github/workflows/"],
    };

    const exec = jest.spyOn(action, "exec");
    const putFile = jest.spyOn(action, "putFile");

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
