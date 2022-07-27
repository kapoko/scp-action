import { expect, describe, test, beforeAll } from "@jest/globals";
import * as core from "@actions/core";
import { run, connect } from "../src/scp-action";
import { Client } from "ssh2";

const inputs = {
  host: process.env.HOST,
  port: parseInt(process.env.PORT || ""),
  username: process.env.USERNAME,
  private_key: process.env.PRIVATE_KEY,
  local: "src",
  remote: ".",
} as any;

const mockGetInput = () => {
  beforeAll(() => {
    jest
      .spyOn(core, "getInput")
      .mockImplementation((name: string, options?: core.InputOptions) => {
        if (options?.required && !inputs[name]) {
          throw new Error(`Input '${name}' is required`);
        }
        return inputs[name];
      });
  });
};

describe("ssh client", () => {
  console.log = jest.fn();
  mockGetInput();

  it("can connect", async () => {
    const client = await connect(new Client(), {
      host: inputs.host,
      username: inputs.username,
      port: inputs.port,
      privateKey: inputs.private_key,
    });

    expect(client).toBeInstanceOf(Client);
    expect(client).toHaveProperty("config.host", inputs.host);

    client.end();
  });

  test("rejects when given non-existing host", async () => {
    const connection = connect(new Client(), {
      host: "non_existing_host",
      username: inputs.username,
    });

    expect(connection).rejects.toThrow();
  });
});

describe("action", () => {
  console.log = jest.fn();
  mockGetInput();

  it("runs", async () => {
    const failed = jest.spyOn(core, "setFailed");

    const action = run();
    await expect(action).resolves.not.toThrow();
    await expect(failed).not.toHaveBeenCalled();
  });
});
