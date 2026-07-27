import { NextResponse } from "next/server";
import { agentOutputJsonSchema } from "@/lib/domain/agent-gateway";

export function GET() {
  return NextResponse.json(agentOutputJsonSchema);
}
