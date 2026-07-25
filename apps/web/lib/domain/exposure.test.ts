import { describe, expect, it } from "vitest";
import { buildExposureSnapshot } from "./exposure";

describe("portfolio exposure", () => {
  it("combines broker aliases into one issuer exposure", () => {
    const result = buildExposureSnapshot([
      { instrumentId: "US:GOOGL", marketValueUsd: 60, currency: "USD", assetClass: "stock" },
      { instrumentId: "XNAS:GOOGL", marketValueUsd: 40, currency: "USD", assetClass: "stock" },
    ], [{ instrumentId: "US:GOOGL", issuer: { id: "issuer:alphabet", name: "Alphabet Inc." } }]);

    expect(result.issuerCoverage).toEqual({ classifiedValueUsd: 100, totalValueUsd: 100, ratio: 1, missingInstrumentIds: [] });
    expect(result.issuers).toEqual([{ id: "issuer:alphabet", name: "Alphabet Inc.", marketValueUsd: 100, weight: 1 }]);
  });

  it("looks through known ETF holdings and preserves the uncovered remainder", () => {
    const result = buildExposureSnapshot([
      { instrumentId: "US:ETF", marketValueUsd: 100, currency: "USD", assetClass: "broad_index_fund" },
    ], [{
      instrumentId: "US:ETF",
      issuerHoldings: [
        { id: "issuer:a", name: "Issuer A", weight: 0.4 },
        { id: "issuer:b", name: "Issuer B", weight: 0.35 },
      ],
    }]);

    expect(result.issuerCoverage).toEqual({ classifiedValueUsd: 75, totalValueUsd: 100, ratio: 0.75, missingInstrumentIds: ["US:ETF"] });
    expect(result.issuers).toContainEqual({ id: "unclassified", name: "待穿透", marketValueUsd: 25, weight: 0.25 });
  });

  it("uses absolute market value for gross exposure", () => {
    const result = buildExposureSnapshot([
      { instrumentId: "US:OPTION", marketValueUsd: -20, currency: "USD", assetClass: "derivative" },
    ], []);

    expect(result.totalGrossValueUsd).toBe(20);
    expect(result.issuerCoverage.missingInstrumentIds).toEqual(["US:OPTION"]);
    expect(result.currencies[0]).toMatchObject({ id: "USD", marketValueUsd: 20, weight: 1 });
  });
});
