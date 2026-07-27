import { canonicalMarketInstrumentId } from "./market-data";
import type { PortfolioRiskInput } from "./risk-input";

export type RebalanceTargetWeight = {
  instrumentId: string;
  weight: number;
};

export class RebalanceIntentError extends Error {}

export function buildRebalanceRiskInput(
  current: PortfolioRiskInput,
  targetWeights: RebalanceTargetWeight[],
): PortfolioRiskInput {
  if (!targetWeights.length) throw new RebalanceIntentError("Rebalance intent requires at least one target weight");
  const availableSeries = new Map(current.series.map((series) => [series.instrumentId, series]));
  const targets = new Map<string, number>();
  for (const target of targetWeights) {
    const instrumentId = canonicalMarketInstrumentId(target.instrumentId);
    if (targets.has(instrumentId)) throw new RebalanceIntentError(`Duplicate target instrument: ${instrumentId}`);
    if (!Number.isFinite(target.weight) || Math.abs(target.weight) > 1) {
      throw new RebalanceIntentError(`Target weight for ${instrumentId} must be finite and within [-1, 1]`);
    }
    if (Math.abs(target.weight) <= 1e-12) continue;
    if (!availableSeries.has(instrumentId)) {
      throw new RebalanceIntentError(`No validated risk series is available for target instrument ${instrumentId}`);
    }
    targets.set(instrumentId, target.weight);
  }
  if (!targets.size) throw new RebalanceIntentError("Rebalance intent has no non-zero market-risk weights");
  const instrumentIds = [...targets.keys()].sort();
  return {
    ...current,
    positions: instrumentIds.map((instrumentId) => ({
      instrumentId,
      weight: targets.get(instrumentId)!,
    })),
    series: instrumentIds.map((instrumentId) => availableSeries.get(instrumentId)!),
  };
}
