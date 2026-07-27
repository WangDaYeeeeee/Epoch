import { NextResponse } from "next/server";
import type { ThemeVersionInput } from "@/lib/domain/theme";
import { createDatabaseClient, migrateDatabase } from "@/lib/server/database";
import { PostgresThemeRepository } from "@/lib/server/theme";

export const dynamic = "force-dynamic";

export async function GET() {
  const sql = createDatabaseClient();
  try {
    await migrateDatabase(sql);
    return NextResponse.json({ themes: await new PostgresThemeRepository(sql).load() });
  } catch (error) {
    return NextResponse.json({ error: "themes_unavailable", detail: error instanceof Error ? error.message : "unknown" }, { status: 503 });
  } finally {
    await sql.end();
  }
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "invalid_theme", detail: "Invalid JSON request" }, { status: 422 }); }
  const sql = createDatabaseClient();
  try {
    await migrateDatabase(sql);
    const repository = new PostgresThemeRepository(sql);
    if (body.action === "create" && typeof body.name === "string") {
      return NextResponse.json({ themeId: await repository.create(body.name) }, { status: 201 });
    }
    if (body.action === "save_version" && typeof body.themeId === "string" && typeof body.version === "object" && body.version !== null) {
      return NextResponse.json({ versionId: await repository.saveVersion(body.themeId, body.version as ThemeVersionInput) }, { status: 201 });
    }
    if (body.action === "link_candidate" && typeof body.themeId === "string" && typeof body.candidateId === "string" && typeof body.role === "string") {
      await repository.linkCandidate(body.themeId, body.candidateId, body.role);
      return NextResponse.json({ status: "linked" });
    }
    if (
      body.action === "link_evidence" && typeof body.themeVersionId === "string"
      && typeof body.evidenceId === "string" && ["support", "counter"].includes(String(body.role))
    ) {
      await repository.linkEvidence(body.themeVersionId, body.evidenceId, body.role as "support" | "counter");
      return NextResponse.json({ status: "linked" });
    }
    return NextResponse.json({ error: "invalid_theme", detail: "Unsupported action or missing fields" }, { status: 422 });
  } catch (error) {
    return NextResponse.json({ error: "invalid_theme", detail: error instanceof Error ? error.message : "unknown" }, { status: 422 });
  } finally { await sql.end(); }
}
