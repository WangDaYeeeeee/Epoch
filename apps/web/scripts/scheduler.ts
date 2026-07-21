import { createDatabaseClient, migrateDatabase } from "../lib/server/database";
import { runDueJobs } from "../lib/server/scheduler";

const sql = createDatabaseClient();
const once = process.argv.includes("--once");
const pollMilliseconds = Number(process.env.SCHEDULER_POLL_MS ?? 30_000);

async function tick() {
  const results = await runDueJobs(sql);
  if (results.length) console.log(JSON.stringify({ at: new Date().toISOString(), results }));
}

await migrateDatabase(sql);
await tick();
if (once) {
  await sql.end();
} else {
  const timer = setInterval(() => void tick().catch((error) => console.error(error)), pollMilliseconds);
  const shutdown = async () => { clearInterval(timer); await sql.end(); process.exit(0); };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
