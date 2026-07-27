import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const codeInputs = [
  "apps/web/lib/domain/rebalance-intent.ts",
  "apps/web/lib/domain/risk-input.ts",
  "apps/web/lib/server/analytics-client.ts",
  "apps/web/lib/server/calculation-run.ts",
  "services/analytics/src/epoch_analytics/contracts.py",
  "services/analytics/src/epoch_analytics/risk_core.py",
  "services/analytics/src/epoch_analytics/risk_engine.py",
  "contracts/analytics/v1/portfolio-risk-input.schema.json",
  "contracts/analytics/v1/portfolio-risk-output.schema.json",
];

export function resolveWorkspaceRoot(): string {
  const candidates = [resolve(process.cwd(), "../.."), process.cwd()];
  const found = candidates.find((candidate) => {
    try {
      return readFileSync(resolve(candidate, "contracts/analytics/v1/portfolio-risk-input.schema.json"), "utf8").length > 0;
    } catch {
      return false;
    }
  });
  if (!found) throw new Error("Workspace root is unavailable");
  return found;
}

export function riskCodeVersion(root = resolveWorkspaceRoot()): string {
  const hash = createHash("sha256");
  for (const path of codeInputs) {
    hash.update(path);
    hash.update(readFileSync(resolve(root, path)));
  }
  return `portfolio-risk-workspace-${hash.digest("hex").slice(0, 16)}`;
}
