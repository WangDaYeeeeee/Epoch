import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { resolveWorkspaceRoot } from "./risk-code-version";

export function configuredDataRoot(): string {
  const configured = process.env.EPOCH_DATA_ROOT?.trim();
  if (!configured) return resolve(resolveWorkspaceRoot(), "tmp/satellite-data");
  return isAbsolute(configured) ? resolve(configured) : resolve(resolveWorkspaceRoot(), configured);
}

export function existingDataRoot(): string | null {
  const configured = configuredDataRoot();
  return existsSync(resolve(configured, "validation.json")) ? configured : null;
}
