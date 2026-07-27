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

  it("aggregates direct and ETF look-through industry, region, and multi-label themes", () => {
    const result = buildExposureSnapshot([
      { instrumentId: "US:NVDA", marketValueUsd: 100, currency: "USD", assetClass: "stock" },
      { instrumentId: "US:ETF", marketValueUsd: 100, currency: "USD", assetClass: "broad_index_fund" },
    ], [
      {
        instrumentId: "US:NVDA",
        issuer: { id: "issuer:nvidia", name: "NVIDIA" },
        industry: { id: "industry:semiconductors", name: "半导体" },
        region: { id: "region:us", name: "美国" },
        themes: [{ id: "theme:ai", name: "AI" }, { id: "theme:chips", name: "芯片" }],
      },
      {
        instrumentId: "US:ETF",
        issuerHoldings: [{ id: "issuer:nvidia", name: "NVIDIA", weight: 0.5 }],
        industryHoldings: [{ id: "industry:semiconductors", name: "半导体", weight: 0.5 }],
        regionHoldings: [{ id: "region:us", name: "美国", weight: 0.5 }],
        themeHoldings: [
          { id: "theme:ai", name: "AI", weight: 0.5 },
          { id: "theme:chips", name: "芯片", weight: 0.5 },
        ],
        themeCoverageWeight: 0.5,
      },
    ]);

    expect(result.industries.find((bucket) => bucket.id === "industry:semiconductors")?.marketValueUsd).toBe(150);
    expect(result.regions.find((bucket) => bucket.id === "region:us")?.marketValueUsd).toBe(150);
    expect(result.themes.find((bucket) => bucket.id === "theme:ai")?.marketValueUsd).toBe(150);
    expect(result.themes.find((bucket) => bucket.id === "theme:chips")?.marketValueUsd).toBe(150);
    expect(result.dimensionCoverage.industry.ratio).toBe(0.75);
    expect(result.dimensionCoverage.region.ratio).toBe(0.75);
    expect(result.dimensionCoverage.theme.ratio).toBe(0.75);
    expect(result.holdingOverlaps).toEqual([{
      issuerId: "issuer:nvidia",
      issuerName: "NVIDIA",
      marketValueUsd: 150,
      weight: 0.75,
      sources: [
        { instrumentId: "US:NVDA", sourceType: "direct", marketValueUsd: 100, weightWithinIssuer: 2 / 3 },
        { instrumentId: "US:ETF", sourceType: "fund", marketValueUsd: 50, weightWithinIssuer: 1 / 3 },
      ],
    }]);
  });
});
