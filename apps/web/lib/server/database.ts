import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import postgres, { type Sql } from "postgres";

export function databaseUrl(): string {
  return process.env.DATABASE_URL ?? "postgresql://epoch:epoch-local-only@127.0.0.1:5432/epoch";
}

export function createDatabaseClient(): Sql {
  return postgres(databaseUrl(), { max: 4, idle_timeout: 10, connect_timeout: 10 });
}

export function resolveMigrationsRoot(): string {
  const candidates = [resolve(process.cwd(), "migrations"), resolve(process.cwd(), "../../migrations")];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error("Migrations directory is unavailable");
  return found;
}

export async function migrateDatabase(sql: Sql, root = resolveMigrationsRoot()): Promise<string[]> {
  const connection = await sql.reserve();
  const applied: string[] = [];
  let locked = false;
  try {
    await connection.unsafe(`CREATE TABLE IF NOT EXISTS schema_migration (
      version text PRIMARY KEY,
      content_hash text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    await connection`SELECT pg_advisory_lock(18917101)`;
    locked = true;
    const files = readdirSync(root).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
    for (const file of files) {
      const content = readFileSync(resolve(root, file), "utf8");
      const contentHash = createHash("sha256").update(content).digest("hex");
      const [existing] = await connection<{ content_hash: string }[]>`SELECT content_hash FROM schema_migration WHERE version = ${file}`;
      if (existing) {
        if (existing.content_hash !== contentHash) throw new Error(`Applied migration changed: ${file}`);
        continue;
      }
      await connection.begin(async (transaction) => {
        await transaction.unsafe(content);
        await transaction`INSERT INTO schema_migration (version, content_hash) VALUES (${file}, ${contentHash})`;
      });
      applied.push(file);
    }
  } finally {
    if (locked) await connection`SELECT pg_advisory_unlock(18917101)`;
    connection.release();
  }
  return applied;
}
