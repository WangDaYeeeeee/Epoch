import { createDatabaseClient, migrateDatabase } from "../lib/server/database";

const sql = createDatabaseClient();
try {
  const applied = await migrateDatabase(sql);
  console.log(applied.length ? `Applied migrations: ${applied.join(", ")}` : "Database is up to date");
} finally {
  await sql.end();
}
