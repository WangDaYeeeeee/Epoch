import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { createDatabaseClient, migrateDatabase } from "../lib/server/database";
import { importIbkrFlexStatement } from "../lib/server/ibkr-flex-import";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const file = option("--file");
  const accountId = option("--account") ?? "ibkr_8602";
  if (!file) throw new Error("Usage: pnpm import:flex -- --file <statement.csv> [--account ibkr_8602] [--source-id id]");
  const filePath = resolve(file);
  const sql = createDatabaseClient();
  try {
    await migrateDatabase(sql);
    const result = await importIbkrFlexStatement(sql, {
      accountId,
      sourceId: option("--source-id") ?? basename(filePath),
      text: readFileSync(filePath, "utf8"),
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
