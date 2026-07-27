import { describe, expect, it } from "vitest";
import { buildRebalanceRiskInput, RebalanceIntentError } from "./rebalance-intent";
import type { PortfolioRiskInput } from "./risk-input";

const current: PortfolioRiskInput = {
  schemaVersion: "portfolio-risk-input/1.0",
  asOf: "2026-07-16T00:00:00Z",
  baseCurrency: "USD",
  weightDefinition: "market_value_usd_over_net_nav_cash_in_denominator",
  marketDataDefinition: {
    priceAdjustment: "split_adjusted",
    ohlcCurrency: "usd_using_same_date_fx_close",
    returnMethod: "common_date_close_to_close_usd",
    dividendTreatment: "excluded",
  },
  positions: [
    { instrumentId: "US:AAA", weight: 0.6 },
    { instrumentId: "US:BBB", weight: 0.4 },
  ],
  series: [
    { instrumentId: "US:AAA", bars: [], returnsUsd: [] },
    { instrumentId: "US:BBB", bars: [], returnsUsd: [] },
  ],
};

describe("rebalance risk intent", () => {
  it("applies explicit weights without solving or normalizing them", () => {
    const result = buildRebalanceRiskInput(current, [
      { instrumentId: "XNAS:AAA", weight: 0.35 },
      { instrumentId: "US:BBB", weight: 0.5 },
    ]);
    expect(result.positions).toEqual([
      { instrumentId: "US:AAA", weight: 0.35 },
      { instrumentId: "US:BBB", weight: 0.5 },
    ]);
    expect(result.positions.reduce((sum, position) => sum + position.weight, 0)).toBe(0.85);
  });

  it("rejects unavailable instruments and duplicate canonical aliases", () => {
    expect(() => buildRebalanceRiskInput(current, [{ instrumentId: "US:NEW", weight: 0.2 }]))
      .toThrowError(new RebalanceIntentError("No validated risk series is available for target instrument US:NEW"));
    expect(() => buildRebalanceRiskInput(current, [
      { instrumentId: "XNAS:AAA", weight: 0.2 },
      { instrumentId: "US:AAA", weight: 0.3 },
    ])).toThrow("Duplicate target instrument");
  });
});
