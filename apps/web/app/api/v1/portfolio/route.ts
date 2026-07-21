import { NextResponse } from "next/server";
import { loadPortfolio } from "@/lib/server/portfolio";

export const dynamic = "force-dynamic";

export function GET() {
  try { return NextResponse.json(loadPortfolio()); }
  catch (error) { return NextResponse.json({ error: "portfolio_unavailable", detail: error instanceof Error ? error.message : "unknown" }, { status: 503 }); }
}
