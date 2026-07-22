import { createDatabaseClient, migrateDatabase } from "../lib/server/database";
import { runDueJobs } from "../lib/server/scheduler";

const once = process.argv.includes("--once");
const pollMilliseconds = Number(process.env.SCHEDULER_POLL_MS ?? 30_000);

async function main(): Promise<void> {
  const sql = createDatabaseClient();
  const tick = async () => {
    const results = await runDueJobs(sql);
    if (results.length) console.log(JSON.stringify({ at: new Date().toISOString(), results }));
  };

  try {
    await migrateDatabase(sql);
    await tick();
  } catch (error) {
    await sql.end();
    throw error;
  }

  if (once) {
    await sql.end();
    return;
  }

  const timer = setInterval(() => void tick().catch((error) => console.error(error)), pollMilliseconds);
  const shutdown = async () => { clearInterval(timer); await sql.end(); process.exit(0); };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
