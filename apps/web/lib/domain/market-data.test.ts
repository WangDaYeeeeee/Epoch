import { describe, expect, it } from "vitest";
import { auditDailyMarketBars, canonicalMarketInstrumentId, currentPositionMarketDataRequirement, evaluateMarketDataFreshness, marketDataRequirement } from "./market-data";

describe("market data requirements", () => {
  it("collapses broker-specific US venue aliases", () => {
    expect(canonicalMarketInstrumentId("XNAS:NVDA")).toBe("US:NVDA");
    expect(canonicalMarketInstrumentId("ARCX:GLD")).toBe("US:GLD");
    expect(canonicalMarketInstrumentId("XKRX:000660")).toBe("XKRX:000660");
  });

  it("reports canonical securities, FX pairs, and the required date range", () => {
    const result = marketDataRequirement([
      { action: "buy", instrument_id: "US:NVDA", currency: "USD" },
      { action: "sell", instrument_id: "XNAS:NVDA", currency: "USD" },
      { action: "buy", instrument_id: "XKRX:000660", currency: "KRW" },
      { action: "buy", instrument_id: "FUND:HK0000938420", currency: "USD" },
      { action: "fx_buy", instrument_id: "FX:USDKRW", currency: "KRW" },
    ], [{ date: "2025-01-20" }, { date: "2026-07-18" }]);
    expect(result).toEqual({
      dateFrom: "2025-01-20", dateTo: "2026-07-18", rawInstrumentIds: 3,
      canonicalInstrumentIds: ["US:NVDA", "XKRX:000660"], aliasesCollapsed: 1, fxPairs: ["KRWUSD"],
    });
  });

  it("treats the three money-market funds as cash equivalents", () => {
    const result = marketDataRequirement([
      { action: "buy", instrument_id: "FUND:HK0000502390", currency: "HKD" },
      { action: "buy", instrument_id: "FUND:HK0000584752", currency: "USD" },
      { action: "buy", instrument_id: "FUND:HK0000938420", currency: "USD" },
    ], [{ date: "2025-01-20" }]);
    expect(result.canonicalInstrumentIds).toEqual([]);
  });

  it("derives operational freshness requirements from the latest open positions", () => {
    expect(currentPositionMarketDataRequirement([
      { date: "2026-07-16", instrument_id: "US:OLD", quantity: "1", currency: "USD" },
      { date: "2026-07-17", instrument_id: "XNAS:GOOGL", quantity: "2", currency: "USD" },
      { date: "2026-07-17", instrument_id: "XKRX:000660", quantity: "9", currency: "KRW" },
      { date: "2026-07-17", instrument_id: "CASH:KRW", quantity: "-100", currency: "KRW" },
      { date: "2026-07-17", instrument_id: "FUND:HK0000502390", quantity: "5", currency: "HKD" },
    ])).toEqual({
      dateFrom: "2026-07-17",
      dateTo: "2026-07-17",
      rawInstrumentIds: 2,
      canonicalInstrumentIds: ["US:GOOGL", "XKRX:000660"],
      aliasesCollapsed: 0,
      fxPairs: ["HKDUSD", "KRWUSD"],
    });
  });

  it("reports stale market inputs without treating them as missing", () => {
    expect(evaluateMarketDataFreshness({
      latestEffectiveDate: "2026-07-17",
      expectedThroughDate: "2026-07-22",
      tradingDayLag: 3,
      observedAt: "2026-07-22T09:28:59.000Z",
      observationTimestampQuality: "filesystem_fallback",
    })).toEqual({
      status: "stale",
      latestEffectiveDate: "2026-07-17",
      expectedThroughDate: "2026-07-22",
      tradingDayLag: 3,
      observedAt: "2026-07-22T09:28:59.000Z",
      observationTimestampQuality: "filesystem_fallback",
      reason: "最新共同行情日期较预期截止日滞后 3 个交易日。",
    });
  });

  it("allows one trading day of publication lag", () => {
    expect(evaluateMarketDataFreshness({
      latestEffectiveDate: "2026-07-21",
      expectedThroughDate: "2026-07-22",
      tradingDayLag: 1,
    }).status).toBe("fresh");
  });

  it("validates OHLCV invariants and required instrument coverage", () => {
    expect(auditDailyMarketBars([
      {
        date: "2026-07-22", instrument_id: "US:GOOGL", open: "190", high: "195", low: "188", close: "193",
        volume: "1000", currency: "USD", source: "fixture", observed_at: "2026-07-23T01:00:00Z",
      },
      {
        date: "2026-07-22", instrument_id: "US:BROKEN", open: "10", high: "9", low: "8", close: "11",
        volume: "-1", currency: "USD", source: "fixture", observed_at: "invalid",
      },
    ], ["US:GOOGL", "US:SOXX"])).toEqual({
      requiredInstruments: 2,
      coveredInstruments: 1,
      missingInstrumentIds: ["US:SOXX"],
      totalBars: 2,
      validBars: 1,
      invalidBars: 1,
      duplicateBars: 0,
    });
  });
});
