import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { resolve } from "node:path";

export function loadWorkspaceEnvironment(): void {
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../../.env"),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found) loadEnvFile(found);
}
