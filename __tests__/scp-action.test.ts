import { expect, describe, beforeAll } from "@jest/globals";
import * as core from "@actions/core";

import { Client } from "ssh2";
import * as action from "../src/scp-action";

const inputs = {
  host: process.env.HOST,
  port: parseInt(process.env.PORT || ""),
  username: process.env.USERNAME,
  private_key: process.env.PRIVATE_KEY,
  include_dotfiles: true,
  dry_run: false,
  source: ["src"],
  target: ".",
} as any;

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
  beforeAll(() => {
    console.log = jest.fn();
  });
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
        port: parseInt(process.env.SECOND_PORT || ""),
        privateKey: process.env.SECOND_PRIVATE_KEY,
      },
      {
        host: inputs.host,
        username: inputs.username,
        port: inputs.port,
        privateKey: inputs.private_key,
      }
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
    console.log = jest.fn();
    process.stdout.write = jest.fn();
  });

  mockGetInput();

  it("runs", async () => {
    const failed = jest.spyOn(core, "setFailed");

    const run = action.run();

    await expect(run).resolves.not.toThrow();
    await expect(failed).not.toHaveBeenCalled();
  });

  it("executes commands", async () => {
    inputs.command = "echo hello";
    inputs.command_after = "echo there!";

    await action.run();

    expect(process.stdout.write).toHaveBeenCalledWith("out: hello\n");
    expect(process.stdout.write).toHaveBeenCalledWith("out: there!\n");
  });

  it("doesn't upload hidden files when include_dotfiles is false", async () => {
    inputs.include_dotfiles = false;
    inputs.source = ".";

    const putFile = jest.spyOn(action, "putFile");

    await action.run();

    expect(putFile).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.stringMatching(/.env.example$/),
      expect.anything()
    );

    inputs.source = ["src"];
  });

  it("doesn't execute commands or upload files when dry_run is true", async () => {
    inputs.dry_run = true;

    const putFile = jest.spyOn(action, "putFile");
    const exec = jest.spyOn(action, "exec");

    await action.run();

    expect(putFile).not.toBeCalled();
    expect(exec).not.toBeCalled();

    inputs.dry_run = false;
  });

  it("uploads multiple source folders", async () => {
    inputs.source = ["src", ".github"];

    const putFile = jest.spyOn(action, "putFile");

    await action.run();

    expect(putFile).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringMatching(/tests.yml$/),
      expect.anything()
    );

    expect(putFile).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringMatching(/index.ts$/),
      expect.anything()
    );

    inputs.source = ["src"];
  });
});
