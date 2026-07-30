import { afterEach, describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { configuredDataRoot } from "./data-root";
import { resolveWorkspaceRoot } from "./risk-code-version";

const originalDataRoot = process.env.EPOCH_DATA_ROOT;

afterEach(() => {
  if (originalDataRoot === undefined) delete process.env.EPOCH_DATA_ROOT;
  else process.env.EPOCH_DATA_ROOT = originalDataRoot;
});

describe("configuredDataRoot", () => {
  it("resolves a relative configured path from the workspace root", () => {
    process.env.EPOCH_DATA_ROOT = "./tmp/satellite-data";
    expect(configuredDataRoot()).toBe(resolve(resolveWorkspaceRoot(), "tmp/satellite-data"));
  });

  it("preserves an absolute configured path", () => {
    process.env.EPOCH_DATA_ROOT = "/tmp/epoch-data";
    expect(configuredDataRoot()).toBe("/tmp/epoch-data");
  });
});
