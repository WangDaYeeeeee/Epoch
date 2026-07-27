import { describe, expect, it } from "vitest";
import { buildMarketRefreshPreflight, confirmsMarketRefresh, validateIncrementalMarketRefresh } from "./market-refresh";

describe("market refresh preflight", () => {
  it("is deterministic and discloses the exact external target set without portfolio facts", () => {
    const input = {
      instrumentIds: ["US:GOOGL", "XKRX:000660", "FX:KRWUSD"],
      latestDates: { "US:GOOGL": "2026-07-24", "XKRX:000660": "2026-07-23", "FX:KRWUSD": "2026-07-24" },
    };
    const first = buildMarketRefreshPreflight({ ...input, now: new Date("2026-07-27T00:00:00Z") });
    const second = buildMarketRefreshPreflight({ ...input, now: new Date("2026-07-27T12:00:00Z") });
    expect(first).toEqual(second);
    expect(first.dateFrom).toBe("2026-07-16");
    expect(first.dateToExclusive).toBe("2026-07-28");
    expect(first.targets).toHaveLength(3);
    expect(first.targets).toContainEqual({
      instrumentId: "FX:KRWUSD",
      provider: "Yahoo Finance chart v8",
      providerSymbol: "KRWUSD=X",
    });
    expect(first.targets.every((target) => (
      Object.keys(target).sort().join(",") === "instrumentId,provider,providerSymbol"
    ))).toBe(true);
  });

  it("requires both explicit confirmation and the exact current fingerprint", () => {
    const preflight = buildMarketRefreshPreflight({
      now: new Date("2026-07-27T00:00:00Z"),
      instrumentIds: ["US:GOOGL"],
    });
    expect(confirmsMarketRefresh({ confirmed: false, fingerprint: preflight.fingerprint }, preflight)).toBe(false);
    expect(confirmsMarketRefresh({ confirmed: true, fingerprint: "stale" }, preflight)).toBe(false);
    expect(confirmsMarketRefresh({ confirmed: true, fingerprint: preflight.fingerprint }, preflight)).toBe(true);
  });

  it("fails closed when a newly held instrument has no provider mapping", () => {
    expect(() => buildMarketRefreshPreflight({
      now: new Date("2026-07-27T00:00:00Z"),
      instrumentIds: ["US:UNMAPPED"],
    })).toThrow("No market-data source mapping for: US:UNMAPPED");
  });

  it("accepts complete incremental rows and rejects incomplete or inconsistent provider data", () => {
    const valid = {
      targetInstrumentIds: ["US:GOOGL", "FX:KRWUSD"],
      prices: [
        ["2026-07-24", "US:GOOGL", "200"],
        ["2026-07-24", "FX:KRWUSD", "0.00072"],
      ],
      bars: [["2026-07-24", "US:GOOGL", "198", "202", "197", "200"]],
      splits: [] as string[][],
      dateFrom: "2026-07-20",
      dateToExclusive: "2026-07-28",
    };
    expect(validateIncrementalMarketRefresh(valid)).toMatchObject({
      targets: 2,
      priceRows: 2,
      barRows: 1,
      latestByInstrument: { "US:GOOGL": "2026-07-24", "FX:KRWUSD": "2026-07-24" },
    });
    expect(() => validateIncrementalMarketRefresh({
      ...valid,
      prices: valid.prices.slice(0, 1),
    })).toThrow("Market refresh returned no prices for: FX:KRWUSD");
    expect(() => validateIncrementalMarketRefresh({
      ...valid,
      bars: [["2026-07-24", "US:GOOGL", "198", "196", "197", "200"]],
    })).toThrow("Inconsistent OHLC values: 2026-07-24|US:GOOGL");
  });
});
