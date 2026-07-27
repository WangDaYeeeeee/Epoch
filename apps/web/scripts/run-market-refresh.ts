import { createDatabaseClient, migrateDatabase } from "../lib/server/database";
import { runMarketDataFreshnessMonitor } from "../lib/server/market-data-monitor";
import { executeMarketRefresh, marketRefreshPreflight } from "../lib/server/market-refresh";
import { PostgresMarketRefreshRunRepository } from "../lib/server/market-refresh-run";

async function main(): Promise<void> {
  const preflight = marketRefreshPreflight();
  const sql = createDatabaseClient();
  const connection = await sql.reserve();
  let locked = false;
  let runId: string | null = null;
  const repository = new PostgresMarketRefreshRunRepository(connection);
  try {
    await migrateDatabase(connection);
    const [lock] = await connection<{ acquired: boolean }[]>`
      SELECT pg_try_advisory_lock(hashtext('manual-market-refresh')) AS acquired
    `;
    locked = lock?.acquired === true;
    if (!locked) throw new Error("A market refresh is already running");
    const run = await repository.start(preflight);
    runId = run.id;
    const result = await executeMarketRefresh();
    await runMarketDataFreshnessMonitor(connection);
    const completed = await repository.succeed(run.id, result);
    console.log(JSON.stringify({ preflight, run: completed }, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (runId) {
      try {
        await repository.fail(runId, message);
      } catch {
        // Preserve the original refresh failure.
      }
    }
    throw error;
  } finally {
    if (locked) await connection`SELECT pg_advisory_unlock(hashtext('manual-market-refresh'))`;
    connection.release();
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
