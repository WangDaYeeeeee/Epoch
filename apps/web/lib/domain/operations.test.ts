import { describe, expect, it } from "vitest";
import { buildOperationsSnapshot, mergeOperationItems } from "./operations";
import type { PortfolioPayload } from "../types";

const payload = (): Omit<PortfolioPayload, "operations"> => ({
  meta: { account: "TEST", asOf: "2026-07-24", baseCurrency: "USD", benchmark: ".NDX", strategyVersion: "test", classificationVersion: "test" },
  summary: { nav: 100, cash: 10, portfolioReturn: 0, benchmarkReturn: 0, activeReturn: 0 },
  series: [],
  positions: [],
  exposure: {
    methodology: "gross-market-value",
    totalGrossValueUsd: 100,
    issuerCoverage: { classifiedValueUsd: 100, totalValueUsd: 100, ratio: 1, missingInstrumentIds: [] },
    dimensionCoverage: {
      industry: { classifiedValueUsd: 100, totalValueUsd: 100, ratio: 1, missingInstrumentIds: [] },
      region: { classifiedValueUsd: 100, totalValueUsd: 100, ratio: 1, missingInstrumentIds: [] },
      theme: { classifiedValueUsd: 100, totalValueUsd: 100, ratio: 1, missingInstrumentIds: [] },
    },
    issuers: [], currencies: [], assetClasses: [], industries: [], regions: [], themes: [], holdingOverlaps: [],
  },
  health: {
    status: "healthy", ledgerBalanced: true, reconciliationDifference: 0, source: "test", message: "ok",
    marketDataFreshness: {
      status: "fresh", latestEffectiveDate: "2026-07-24", expectedThroughDate: "2026-07-24",
      tradingDayLag: 0, observedAt: "2026-07-24T22:00:00.000Z",
      observationTimestampQuality: "authoritative", reason: "fresh",
    },
  },
});

describe("operations snapshot", () => {
  it("requires a real risk run even when data health is clear", () => {
    const result = buildOperationsSnapshot(payload());
    expect(result.status).toBe("critical");
    expect(result.items.map((item) => item.id)).toEqual(["portfolio-risk-missing"]);
  });

  it("merges workflow tasks without duplicating stable ids", () => {
    const base = buildOperationsSnapshot(payload());
    const result = mergeOperationItems(base, [
      {
        id: "portfolio-risk-missing",
        priority: "review",
        category: "review",
        title: "Duplicate replacement",
        detail: "The workflow source owns the same stable id.",
        evidence: "one item",
      },
      {
        id: "review-due:quarterly",
        priority: "review",
        category: "review",
        title: "Quarterly review due",
        detail: "Review exceptions.",
        evidence: "No prior review",
      },
    ]);
    expect(result.items.filter((item) => item.id === "portfolio-risk-missing")).toHaveLength(1);
    expect(result.counts.review).toBe(2);
  });

  it("sorts a failed policy gate ahead of data and coverage work", () => {
    const input = payload();
    input.exposure.issuerCoverage = { classifiedValueUsd: 75, totalValueUsd: 100, ratio: 0.75, missingInstrumentIds: ["US:SOXX"] };
    input.health.marketDataFreshness = { ...input.health.marketDataFreshness!, status: "stale", reason: "two trading days behind" };
    input.risk = {
      calculationId: "risk-1", asOf: "2026-07-24", inputHash: "hash", status: "degraded",
      modelVersion: "test", dataStatus: "stale",
      portfolio: { volatilityAnnualized: 0.46, stressVolatilityAnnualized: 0.5, historicalCvarLoss: 0.05, cvarConfidence: 0.95 },
      instruments: [],
      policyGate: { limitAnnualized: 0.45, observedAnnualized: 0.46, passed: false, violations: ["PORTFOLIO_VOLATILITY_CAP_EXCEEDED"] },
      warnings: [],
    };
    const result = buildOperationsSnapshot(input);
    expect(result.items.map((item) => item.id)).toEqual(["portfolio-volatility-gate", "market-data-freshness", "issuer-coverage"]);
    expect(result.counts).toEqual({ critical: 1, action: 1, review: 1 });
  });

  it("deduplicates freshness work already represented by a persisted alert", () => {
    const input = payload();
    input.health.marketDataFreshness = { ...input.health.marketDataFreshness!, status: "stale", reason: "stale" };
    input.health.operationalAlerts = [{
      id: "alert-1", source: "market_data:normalized", severity: "warning", title: "Market data is not fresh",
      detail: "stale", occurrenceCount: 2, lastObservedAt: "2026-07-25T01:00:00.000Z",
    }];
    const result = buildOperationsSnapshot(input);
    const dataItems = result.items.filter((item) => item.category === "data");
    expect(dataItems).toHaveLength(1);
    expect(dataItems[0]).toMatchObject({ title: "行情需要刷新", detail: "stale" });
  });
});
