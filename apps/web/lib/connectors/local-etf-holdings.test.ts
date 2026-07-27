import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LocalCsvEtfHoldingsProvider, parseLocalEtfHoldings } from "./local-etf-holdings";

describe("local ETF holdings provider", () => {
  it("parses the normalized reusable CSV format", () => {
    const result = parseLocalEtfHoldings(
      "fund_instrument_id,as_of,constituent_instrument_id,name,weight,shares,market_value\n"
      + "US:SOXX,2026-07-17,US:NVDA,NVIDIA,0.085,10,100\n"
      + "US:SOXX,2026-07-17,XNAS:AVGO,Broadcom,0.0725,,\n",
      "soxx.csv",
      "2026-07-18T00:00:00Z",
    );
    expect(result).toMatchObject({ fundInstrumentId: "US:SOXX", asOf: "2026-07-17", provider: "local_csv" });
    expect(result.holdings).toEqual([
      { constituentInstrumentId: "US:NVDA", name: "NVIDIA", weight: 0.085, shares: 10, marketValue: 100 },
      { constituentInstrumentId: "US:AVGO", name: "Broadcom", weight: 0.0725 },
    ]);
  });

  it("parses an iShares download without manual weight editing", () => {
    const result = parseLocalEtfHoldings(
      "iShares Semiconductor ETF\nFund Holdings as of,\"Jul 17, 2026\"\n"
      + "Ticker,Name,Sector,Asset Class,Market Value,Weight (%),Quantity\n"
      + "NVDA,NVIDIA,Semiconductors,Equity,\"1,000\",8.50,10\n"
      + "USD,USD Cash and/or Derivatives,,Cash,\"10\",0.10,10\n",
      "SOXX_holdings.csv",
      "2026-07-18T00:00:00Z",
    );
    expect(result).toMatchObject({ fundInstrumentId: "US:SOXX", asOf: "2026-07-17" });
    expect(result.holdings).toEqual([
      { constituentInstrumentId: "US:NVDA", name: "NVIDIA", weight: 0.085, shares: 10, marketValue: 1000 },
    ]);
  });

  it("selects the latest local point-in-time file for the requested ETF", async () => {
    const root = await mkdtemp(join(tmpdir(), "epoch-etf-holdings-"));
    await writeFile(join(root, "soxx-old.csv"),
      "fund_instrument_id,as_of,constituent_instrument_id,name,weight\nUS:SOXX,2026-06-30,US:NVDA,NVIDIA,0.1\n");
    await writeFile(join(root, "soxx-new.csv"),
      "fund_instrument_id,as_of,constituent_instrument_id,name,weight\nUS:SOXX,2026-07-17,US:NVDA,NVIDIA,0.2\n");
    const result = await new LocalCsvEtfHoldingsProvider(root).fetchHoldings("XNAS:SOXX", "2026-07-17");
    expect(result.asOf).toBe("2026-07-17");
    expect(result.holdings[0].weight).toBe(0.2);
  });
});
