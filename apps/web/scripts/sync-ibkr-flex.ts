import { createDatabaseClient, migrateDatabase } from "../lib/server/database";
import { loadWorkspaceEnvironment } from "../lib/server/environment";
import { ensureIbkrFlexFresh, runIbkrFlexSync } from "../lib/server/ibkr-flex-sync";

loadWorkspaceEnvironment();

async function main(): Promise<void> {
  const sql = createDatabaseClient();
  try {
    await migrateDatabase(sql);
    const result = process.argv.includes("--if-stale")
      ? await ensureIbkrFlexFresh(sql)
      : await runIbkrFlexSync(sql);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
