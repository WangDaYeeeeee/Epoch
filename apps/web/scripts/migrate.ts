import { createDatabaseClient, migrateDatabase } from "../lib/server/database";

async function main(): Promise<void> {
  const sql = createDatabaseClient();
  try {
    const applied = await migrateDatabase(sql);
    console.log(applied.length ? `Applied migrations: ${applied.join(", ")}` : "Database is up to date");
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
