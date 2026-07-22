import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { loadPortfolio } from "./portfolio";

describe("staged satellite portfolio", () => {
  it("keeps the two-account history as one continuous portfolio", () => {
    const payload = loadPortfolio(resolve(process.cwd(), "../../tmp/satellite-data"));
    expect(payload.series).toHaveLength(545);
    expect(payload.meta.account).toContain("FUTU");
    expect(payload.meta.account).toContain("IBKR");
    expect(payload.series[0].date).toBe("2025-01-20");
    expect(payload.series.at(-1)?.date).toBe("2026-07-18");
    expect(payload.series.every((point) => point.portfolio > 0 && point.benchmark > 0)).toBe(true);
    expect(payload.positions.every((position) => position.marketValue < payload.summary.nav)).toBe(true);
    expect(payload.positions.some((position) => position.currency === "KRW")).toBe(true);
    expect(payload.health.positionReconciliation).toMatchObject({ comparisons: 71, matched: 71, timezoneAdjustedTransactions: 8 });
    expect(payload.health.positionReconciliation?.differences).toHaveLength(0);
    expect(payload.health.assetReturnsReconciled).toBe(true);
    expect(payload.health.eventCoverage).toMatchObject({ total: 536, classified: 536, dividends: 24, taxes: 24, fxLegs: 16, transfers: 20, adjustments: 4 });
    expect(payload.health.valuationCoverage).toMatchObject({ total: 113, withFx: 113, fxReconciled: 113, missingFx: 0 });
    expect(payload.health.marketDataRequirement).toMatchObject({
      dateFrom: "2025-01-20", dateTo: "2026-07-18", rawInstrumentIds: 34, aliasesCollapsed: 6,
      fxPairs: ["HKDUSD", "KRWUSD"],
    });
    expect(payload.health.marketDataRequirement?.canonicalInstrumentIds).toHaveLength(28);
    expect(payload.health.marketDataCoverage).toMatchObject({
      requiredSecurities: 28, coveredSecurities: 28, requiredFxPairs: 2, coveredFxPairs: 2,
      priceObservations: 11148, splitEvents: 6,
      missingInstrumentIds: [],
    });
    expect(payload.health.ledgerReplayReadiness).toMatchObject({
      total: 536, classified: 536, marketTrades: 258, derivativeTrades: 3, cashEquivalentTrades: 94,
      cashEvents: 141, fxLegs: 16, transfers: 20, adjustments: 4,
      splitEvents: 6, positionImpactingSplits: 0,
    });
    expect(payload.health.cashEndpointReconciliation).toMatchObject({ endpoints: 4, matched: 4, differences: [] });
    const cashDifferences = payload.health.cashEndpointReconciliation?.differences ?? [];
    expect(cashDifferences.find((item) => item.currency === "HKD")).toBeUndefined();
    expect(cashDifferences.find((item) => item.currency === "USD")).toBeUndefined();
    expect(payload.summary.portfolioReturn).toBeCloseTo(0.491620749, 8);
    expect(payload.summary.moneyWeightedReturn).toBeCloseTo(0.299429546, 8);
    expect(payload.summary.cumulativeMoneyWeightedReturn).toBeCloseTo(0.477536869, 8);
    expect(payload.positions.map((position) => position.marketValue)).toEqual(
      [...payload.positions].map((position) => position.marketValue).sort((left, right) => right - left),
    );
  });

  it("falls back to a fully reproducible synthetic portfolio without private data", () => {
    const payload = loadPortfolio(null);
    expect(payload.meta.account).toBe("DEMO-SATELLITE-USD");
    expect(payload.health.ledgerBalanced).toBe(true);
    expect(payload.health.source).toBe("synthetic");
    expect(payload.series).toHaveLength(10);
  });
});
