import { createDatabaseClient, migrateDatabase } from "../lib/server/database";
import { importBaselineDataset } from "../lib/server/baseline-import";
import { loadBaselineDataset } from "../lib/server/baseline-data";
import { resolveDataRoot } from "../lib/server/portfolio";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const root = option("--root") ?? resolveDataRoot();
  if (!root) {
    if (process.argv.includes("--optional")) {
      console.log("No private baseline data found; keeping the reproducible synthetic dataset.");
      return;
    }
    throw new Error("Baseline data is unavailable. Pass --root or provide tmp/satellite-data.");
  }

  if (command === "check") {
    const dataset = loadBaselineDataset(root);
    console.log(JSON.stringify({ healthy: dataset.healthy, ledgerReconciled: dataset.ledgerReconciled, checks: dataset.checks }, null, 2));
    if (!dataset.healthy) process.exitCode = 1;
    return;
  }
  if (command !== "import") throw new Error("Usage: baseline.ts <check|import> [--root path] [--optional]");

  const sql = createDatabaseClient();
  try {
    await migrateDatabase(sql);
    console.log(JSON.stringify(await importBaselineDataset(sql, root), null, 2));
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
