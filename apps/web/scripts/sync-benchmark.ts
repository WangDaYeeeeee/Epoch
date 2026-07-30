import { ensureNasdaq100BenchmarkFresh, runNasdaq100BenchmarkSync } from "../lib/server/benchmark-sync";
import { createDatabaseClient, migrateDatabase } from "../lib/server/database";
import { loadWorkspaceEnvironment } from "../lib/server/environment";

loadWorkspaceEnvironment();

async function main(): Promise<void> {
  const sql = createDatabaseClient();
  try {
    await migrateDatabase(sql);
    const result = process.argv.includes("--if-stale")
      ? await ensureNasdaq100BenchmarkFresh(sql)
      : await runNasdaq100BenchmarkSync(sql);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
