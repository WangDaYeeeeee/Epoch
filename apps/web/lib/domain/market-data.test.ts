import { describe, expect, it } from "vitest";
import { canonicalMarketInstrumentId, marketDataRequirement } from "./market-data";

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
});
