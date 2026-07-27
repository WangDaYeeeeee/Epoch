import { NextResponse } from "next/server";
import { RebalanceIntentError, type RebalanceTargetWeight } from "@/lib/domain/rebalance-intent";
import { evaluateRebalanceRisk } from "@/lib/server/rebalance-risk";

export const dynamic = "force-dynamic";

const targetWeights = (body: unknown): RebalanceTargetWeight[] => {
  if (typeof body !== "object" || body === null || !Array.isArray((body as Record<string, unknown>).targetWeights)) {
    throw new RebalanceIntentError("Request must contain targetWeights");
  }
  return (body as { targetWeights: unknown[] }).targetWeights.map((item) => {
    if (
      typeof item !== "object" || item === null
      || typeof (item as Record<string, unknown>).instrumentId !== "string"
      || typeof (item as Record<string, unknown>).weight !== "number"
    ) throw new RebalanceIntentError("Each target weight requires instrumentId and numeric weight");
    return item as RebalanceTargetWeight;
  });
};

export async function POST(request: Request) {
  let weights: RebalanceTargetWeight[];
  try {
    weights = targetWeights(await request.json());
  } catch (error) {
    return NextResponse.json({
      error: "invalid_rebalance_intent",
      detail: error instanceof Error ? error.message : "Invalid JSON request",
    }, { status: 422 });
  }

  try {
    return NextResponse.json(await evaluateRebalanceRisk(weights));
  } catch (error) {
    if (error instanceof RebalanceIntentError) {
      return NextResponse.json({ error: "invalid_rebalance_intent", detail: error.message }, { status: 422 });
    }
    return NextResponse.json({
      error: "rebalance_risk_unavailable",
      detail: error instanceof Error ? error.message : "unknown",
    }, { status: 503 });
  }
}
