import { describe, expect, it } from "vitest";
import { FmpEtfHoldingsProvider } from "./fmp-etf-holdings";

describe("FMP ETF holdings provider", () => {
  it("normalizes percentage weights and preserves source fields", async () => {
    const calls: URL[] = [];
    const provider = new FmpEtfHoldingsProvider("secret", async (input) => {
      calls.push(new URL(String(input)));
      return new Response(JSON.stringify([
        { asset: "NVDA", name: "NVIDIA", weightPercentage: 8.5, sharesNumber: 10, marketValue: 100, updated: "2026-07-25" },
        { asset: "AVGO", name: "Broadcom", weightPercentage: "7.25%", updated: "2026-07-25" },
        { asset: "KLAC", name: "KLA", weightPercentage: 0.12, updated: "2026-07-25" },
      ]));
    });

    const result = await provider.fetchHoldings("XNAS:SOXX");

    expect(result).toMatchObject({
      fundInstrumentId: "US:SOXX",
      asOf: "2026-07-25",
      provider: "fmp",
    });
    expect(result.holdings).toEqual([
      { constituentInstrumentId: "US:NVDA", name: "NVIDIA", weight: 0.085, shares: 10, marketValue: 100 },
      { constituentInstrumentId: "US:AVGO", name: "Broadcom", weight: 0.0725 },
      { constituentInstrumentId: "US:KLAC", name: "KLA", weight: 0.0012 },
    ]);
    expect(calls[0].pathname).toBe("/stable/etf/holdings");
    expect(calls[0].searchParams.get("symbol")).toBe("SOXX");
    expect(calls[0].searchParams.get("apikey")).toBe("secret");
  });

  it("fails explicitly for empty responses", async () => {
    const provider = new FmpEtfHoldingsProvider("secret", async () => new Response("[]"));
    await expect(provider.fetchHoldings("US:SOXX")).rejects.toThrow("response is empty");
  });
});
