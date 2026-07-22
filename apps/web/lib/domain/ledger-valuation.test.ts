import { describe, expect, it } from "vitest";
import { valueDailyLedger } from "./ledger-valuation";

describe("daily ledger valuation", () => {
  it("values cash, transit, cash equivalents, and listed securities in USD", () => {
    const result = valueDailyLedger([{
      date: "2026-01-02",
      cash: { "a|HKD": 100 },
      transit: { "bank|USD": 5 },
      cashEquivalents: { "a|FUND:HK0000938420": 20 },
      quantities: { "a|FUND:HK0000938420": 2, "a|US:NVDA": 3 },
    }], [
      { date: "2026-01-02", instrument_id: "FX:HKDUSD", close: "0.125", currency: "USD" },
      { date: "2026-01-02", instrument_id: "US:NVDA", close: "10", currency: "USD" },
    ], [
      { date: "2026-01-01", instrument_id: "FUND:HK0000938420", price: "10", currency: "HKD" },
    ], [{ date: "2026-01-02", total_assets: "50" }]);
    expect(result).toMatchObject({ totalDays: 1, valuedDays: 1, accountedDays: 1, residualBridgeDays: 0, missingPriceDays: 0, terminalDifferenceUsd: 0 });
    expect(result.points[0]).toMatchObject({ knownValueUsd: 50, ledgerValueUsd: 50, accountedValueUsd: 50, reportedValueUsd: 50, differenceUsd: 0, residualBridgeUsd: null, valuationMethod: "independent" });
  });

  it("reports open derivatives as missing instead of pricing them as shares", () => {
    const result = valueDailyLedger([{
      date: "2026-01-02", cash: { "a|USD": 100 }, transit: {}, cashEquivalents: {},
      quantities: { "a|US:TCOM260220P65000": -1 },
    }], [], [], [{ date: "2026-01-02", total_assets: "100" }]);
    expect(result).toMatchObject({ valuedDays: 0, missingPriceDays: 1, missingInstrumentIds: ["US:TCOM260220P65000"] });
    expect(result.points[0]).toMatchObject({ knownValueUsd: 100, ledgerValueUsd: null, accountedValueUsd: 100, differenceUsd: null, residualBridgeUsd: 0, valuationMethod: "residual_bridge" });
  });

  it("requires child-account valuations while transferred funds are being traded", () => {
    const result = valueDailyLedger([{
      date: "2026-01-02", cash: {}, transit: { "subaccount:7313|USD": 90 }, cashEquivalents: {}, quantities: {},
    }], [], [], [{ date: "2026-01-02", total_assets: "90" }]);
    expect(result).toMatchObject({ valuedDays: 0, accountedDays: 1, residualBridgeDays: 1, missingInstrumentIds: ["SUBACCOUNT:7313"] });
  });

  it("uses published fund NAV while retaining book value as the fallback", () => {
    const state = {
      date: "2026-01-02", cash: {}, transit: {},
      cashEquivalents: { "a|FUND:HK0000938420": 20 },
      quantities: { "a|FUND:HK0000938420": 2 },
    };
    const marked = valueDailyLedger([state], [{ date: "2026-01-02", instrument_id: "FUND:HK0000938420", close: "11", currency: "USD" }], [], [{ date: "2026-01-02", total_assets: "22" }]);
    const fallback = valueDailyLedger([state], [], [{ date: "2026-01-01", instrument_id: "FUND:HK0000938420", price: "10", currency: "USD" }], [{ date: "2026-01-02", total_assets: "20" }]);
    expect(marked.terminalDifferenceUsd).toBe(0);
    expect(fallback.terminalDifferenceUsd).toBe(0);
  });

  it("carries Friday marks through weekends and bridges changed broker snapshots", () => {
    const states = ["2026-01-02", "2026-01-03"].map((date) => ({
      date, cash: { "a|HKD": 80 }, transit: {}, cashEquivalents: {}, quantities: {},
    }));
    const prices = [
      { date: "2026-01-02", instrument_id: "FX:HKDUSD", close: "0.125", currency: "USD" },
      { date: "2026-01-03", instrument_id: "FX:HKDUSD", close: "0.13", currency: "USD" },
    ];
    const unchanged = valueDailyLedger(states, prices, [], [
      { date: "2026-01-02", total_assets: "10" }, { date: "2026-01-03", total_assets: "10" },
    ]);
    expect(unchanged.points[1]).toMatchObject({ ledgerValueUsd: 10, valuationMethod: "independent" });
    const changed = valueDailyLedger(states, prices, [], [
      { date: "2026-01-02", total_assets: "10" }, { date: "2026-01-03", total_assets: "9" },
    ]);
    expect(changed.points[1]).toMatchObject({ ledgerValueUsd: null, residualBridgeUsd: -1, valuationMethod: "residual_bridge", missingInstrumentIds: ["REPORTING_SNAPSHOT_TIMING"] });
  });
});
