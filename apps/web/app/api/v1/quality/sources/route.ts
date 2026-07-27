import { NextResponse } from "next/server";
import { createDatabaseClient, migrateDatabase } from "@/lib/server/database";
import { PostgresDataSourceHealthRepository } from "@/lib/server/data-source-health";

export const dynamic = "force-dynamic";

export async function GET() {
  const sql = createDatabaseClient();
  try {
    await migrateDatabase(sql);
    return NextResponse.json({ sources: await new PostgresDataSourceHealthRepository(sql).load() });
  } catch (error) {
    return NextResponse.json({ error: "data_source_health_unavailable", detail: error instanceof Error ? error.message : "unknown" }, { status: 503 });
  } finally { await sql.end(); }
}

export async function POST() {
  const sql = createDatabaseClient();
  try {
    await migrateDatabase(sql);
    const repository = new PostgresDataSourceHealthRepository(sql);
    return NextResponse.json({ observations: await repository.collectLocal(), sources: await repository.load() });
  } catch (error) {
    return NextResponse.json({ error: "data_source_health_unavailable", detail: error instanceof Error ? error.message : "unknown" }, { status: 503 });
  } finally { await sql.end(); }
}
