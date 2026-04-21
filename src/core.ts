import * as actionsCore from "@actions/core";

export type InputOptions = actionsCore.InputOptions;

export const core = {
  getInput: actionsCore.getInput,
  getMultilineInput: actionsCore.getMultilineInput,
  getBooleanInput: actionsCore.getBooleanInput,
  setFailed: actionsCore.setFailed,
  setSecret: actionsCore.setSecret,
};
