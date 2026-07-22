import { NextResponse } from "next/server";
import { loadPortfolioPreferDatabase } from "@/lib/server/portfolio";

export const dynamic = "force-dynamic";

export async function GET() {
  try { return NextResponse.json(await loadPortfolioPreferDatabase()); }
  catch (error) { return NextResponse.json({ error: "portfolio_unavailable", detail: error instanceof Error ? error.message : "unknown" }, { status: 503 }); }
}
