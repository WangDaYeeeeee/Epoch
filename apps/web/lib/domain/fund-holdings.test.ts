import { describe, expect, it } from "vitest";
import {
  ChainedEtfHoldingsProvider,
  discoverHeldFunds,
  holdingsClassifications,
  selectFundHoldingsSnapshot,
  validateFundHoldingsSnapshot,
  type FundHoldingsSnapshot,
} from "./fund-holdings";

const snapshot = (asOf: string): FundHoldingsSnapshot => ({
  fundInstrumentId: "US:SOXX",
  asOf,
  observedAt: `${asOf}T22:00:00Z`,
  provider: "fixture",
  sourceHash: `hash-${asOf}`,
  holdings: [{ constituentInstrumentId: "US:NVDA", name: "NVIDIA", weight: 0.2 }],
});

describe("fund holdings", () => {
  it("automatically discovers non-zero ETF positions and canonicalizes broker aliases", () => {
    expect(discoverHeldFunds([
      { instrumentId: "XNAS:SOXX", assetClass: "broad_index_fund", quantity: 30 },
      { instrumentId: "US:SMH", assetClass: "thematic_etf", quantity: 0 },
      { instrumentId: "US:NVDA", assetClass: "stock", quantity: 10 },
    ])).toEqual(["US:SOXX"]);
  });

  it("selects the latest point-in-time snapshot without looking into the future", () => {
    const result = selectFundHoldingsSnapshot(
      [snapshot("2026-07-01"), snapshot("2026-07-20")],
      "2026-07-17",
      30,
    );
    expect(result).toMatchObject({ status: "fresh", ageDays: 16 });
    expect(result.snapshot?.asOf).toBe("2026-07-01");
  });

  it("keeps stale and missing states explicit", () => {
    expect(selectFundHoldingsSnapshot([snapshot("2026-01-01")], "2026-07-17", 30).status).toBe("stale");
    expect(selectFundHoldingsSnapshot([], "2026-07-17", 30).status).toBe("missing");
  });

  it("resolves ETF constituents through the same direct issuer registry", () => {
    const selections = new Map([["US:SOXX", {
      snapshot: {
        ...snapshot("2026-07-17"),
        holdings: [
          { constituentInstrumentId: "XNAS:NVDA", name: "NVIDIA", weight: 0.2 },
          { constituentInstrumentId: "US:UNKNOWN", name: "Unknown", weight: 0.1 },
        ],
      },
      status: "fresh" as const,
      ageDays: 0,
    }]]);
    expect(holdingsClassifications(selections, [
      { instrumentId: "US:NVDA", issuer: { id: "issuer:nvidia", name: "NVIDIA Corporation" } },
    ])).toMatchObject([{
      instrumentId: "US:SOXX",
      issuerHoldings: [
        { id: "issuer:nvidia", name: "NVIDIA Corporation", weight: 0.2 },
        { id: "issuer:security:us-unknown", name: "Unknown", weight: 0.1 },
      ],
    }]);
  });

  it("rejects duplicate constituents and overweight snapshots", () => {
    expect(() => validateFundHoldingsSnapshot({
      ...snapshot("2026-07-17"),
      holdings: [
        { constituentInstrumentId: "US:NVDA", name: "NVIDIA", weight: 0.6 },
        { constituentInstrumentId: "XNAS:NVDA", name: "NVIDIA", weight: 0.4 },
      ],
    })).toThrow("Duplicate fund holding");
  });

  it("falls through providers in configured order", async () => {
    const provider = new ChainedEtfHoldingsProvider([
      { id: "local", fetchHoldings: async () => { throw new Error("missing"); } },
      { id: "sec", fetchHoldings: async () => snapshot("2026-07-17") },
    ]);
    await expect(provider.fetchHoldings("US:SOXX")).resolves.toMatchObject({ asOf: "2026-07-17" });
    expect(provider.id).toBe("local,sec");
  });
});
