import { describe, expect, it } from "vitest";
import { parseSecNportHoldings, SecNportEtfHoldingsProvider } from "./sec-nport-holdings";

const xml = `<?xml version="1.0"?>
<edgarSubmission>
  <seriesId>S000004354</seriesId>
  <repPdDate>2026-03-31</repPdDate>
  <invstOrSecs>
    <invstOrSec>
      <name>NVIDIA CORP</name>
      <identifiers><ticker value="NVDA"/></identifiers>
      <balance>1000</balance>
      <valUSD>120000</valUSD>
      <pctVal>8.5</pctVal>
    </invstOrSec>
    <invstOrSec>
      <name>Cash</name>
      <balance>10</balance>
      <valUSD>10</valUSD>
      <pctVal>0.1</pctVal>
    </invstOrSec>
  </invstOrSecs>
</edgarSubmission>`;

describe("SEC N-PORT ETF holdings provider", () => {
  it("parses a series-validated N-PORT XML filing", () => {
    const result = parseSecNportHoldings({
      xml,
      fundInstrumentId: "US:SOXX",
      expectedSeriesId: "S000004354",
      observedAt: "2026-05-28T00:00:00Z",
    });
    expect(result).toMatchObject({ fundInstrumentId: "US:SOXX", asOf: "2026-03-31", provider: "sec_nport" });
    expect(result.holdings).toEqual([{
      constituentInstrumentId: "US:NVDA",
      name: "NVIDIA CORP",
      weight: 0.085,
      shares: 1000,
      marketValue: 120000,
    }]);
  });

  it("rejects a filing for a different fund series", () => {
    expect(() => parseSecNportHoldings({
      xml,
      fundInstrumentId: "US:SOXX",
      expectedSeriesId: "S000000001",
      observedAt: "2026-05-28T00:00:00Z",
    })).toThrow("series mismatch");
  });

  it("discovers the matching filing from SEC submissions and skips other series", async () => {
    const calls: string[] = [];
    const provider = new SecNportEtfHoldingsProvider("Epoch test@example.com", async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("submissions")) {
        return new Response(JSON.stringify({
          filings: { recent: {
            accessionNumber: ["0000000000-26-000002", "0002071691-26-012504"],
            filingDate: ["2026-05-29", "2026-05-28"],
            reportDate: ["2026-03-31", "2026-03-31"],
            form: ["NPORT-P", "NPORT-P"],
            primaryDocument: ["primary_doc.xml", "primary_doc.xml"],
          } },
        }));
      }
      if (url.includes("000000000026000002")) {
        return new Response(xml.replace("S000004354", "S000000001"));
      }
      return new Response(xml);
    });
    const result = await provider.fetchHoldings("XNAS:SOXX", "2026-07-17");
    expect(result.asOf).toBe("2026-03-31");
    expect(calls).toHaveLength(3);
    expect(calls[2]).toContain("/1100663/000207169126012504/primary_doc.xml");
  });
});
