import { NextResponse } from "next/server";
import { calculateDemoLedger } from "@/lib/server/demo-ledger";

export const dynamic = "force-dynamic";

export function GET() {
  try { return NextResponse.json(calculateDemoLedger()); }
  catch (error) { return NextResponse.json({ error: "demo_calculation_failed", detail: error instanceof Error ? error.message : "unknown" }, { status: 500 }); }
}
