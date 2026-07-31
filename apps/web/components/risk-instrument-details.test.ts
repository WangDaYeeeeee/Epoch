import { describe, expect, it } from "vitest";
import {
  buildRiskComposition,
  effectiveHoldingCount,
  instrumentVolatilitySeries,
  proportionalSectorAreaOuterRadius,
  riskAmplification,
  sortRiskInstruments,
} from "./risk-instrument-details";

describe("effectiveHoldingCount", () => {
  it("equals the actual count for equal contributions", () => {
    expect(effectiveHoldingCount([0.25, 0.25, 0.25, 0.25])).toBe(4);
  });

  it("reveals concentration and prevents negative contributions from cancelling", () => {
    expect(effectiveHoldingCount([0.8, 0.1, 0.1])).toBeCloseTo(1.515, 3);
    expect(effectiveHoldingCount([0.5, -0.5])).toBe(2);
  });

  it("returns unavailable when there is no effective exposure", () => {
    expect(effectiveHoldingCount([0, Number.NaN])).toBeNull();
  });
});

describe("riskAmplification", () => {
  it("compares absolute risk contribution with absolute capital weight", () => {
    expect(riskAmplification(0.2, 0.3)).toBeCloseTo(1.5);
    expect(riskAmplification(-0.2, -0.1)).toBeCloseTo(0.5);
    expect(riskAmplification(0, 0.1)).toBeNull();
  });
});

describe("buildRiskComposition", () => {
  it("normalizes capital and absolute risk into two independently comparable rings", () => {
    const composition = buildRiskComposition([
      { instrumentId: "US:AAA", name: "AAA", weight: 0.6, riskContribution: 0.2, volatilityAnnualized: 0.3, riskCapitalRatio: null },
      { instrumentId: "US:BBB", name: "BBB", weight: 0.4, riskContribution: -0.3, volatilityAnnualized: 0.4, riskCapitalRatio: null },
    ]);
    expect(composition.reduce((sum, item) => sum + item.weightShare, 0)).toBeCloseTo(1);
    expect(composition.reduce((sum, item) => sum + item.riskShare, 0)).toBeCloseTo(1);
    expect(composition[1].hedging).toBe(true);
    expect(composition[1].riskShare).toBeCloseTo(0.6);
  });
});

describe("proportionalSectorAreaOuterRadius", () => {
  it("preserves proportional risk area across differently sized weight angles", () => {
    const innerRadius = 140;
    const areaScale = 10000;
    const firstAngle = Math.PI / 3;
    const secondAngle = Math.PI / 6;
    const firstRadius = proportionalSectorAreaOuterRadius(innerRadius, areaScale, 0.2, firstAngle);
    const secondRadius = proportionalSectorAreaOuterRadius(innerRadius, areaScale, 0.4, secondAngle);
    const firstArea = 0.5 * firstAngle * (firstRadius ** 2 - innerRadius ** 2);
    const secondArea = 0.5 * secondAngle * (secondRadius ** 2 - innerRadius ** 2);
    expect(firstArea).toBeCloseTo(areaScale * 0.2);
    expect(secondArea).toBeCloseTo(areaScale * 0.4);
  });
});

describe("sortRiskInstruments", () => {
  it("orders instruments by absolute risk contribution before weight", () => {
    const instruments = [
      { id: "MU", weight: 0.3, riskContribution: 0.12 },
      { id: "TSM", weight: 0.28, riskContribution: 0.4 },
      { id: "KLAC", weight: 0.15, riskContribution: -0.2 },
    ];
    expect(sortRiskInstruments(instruments).map((item) => item.id)).toEqual(["TSM", "KLAC", "MU"]);
  });
});

describe("instrumentVolatilitySeries", () => {
  it("deduplicates dates and lets the current snapshot replace historical values", () => {
    const historical = {
      asOf: "2026-07-01T00:00:00Z",
      instruments: [{ instrumentId: "US:NVDA", volatilityAnnualized: 0.3 }],
    };
    const current = {
      asOf: "2026-07-02T00:00:00Z",
      instruments: [{ instrumentId: "US:NVDA", volatilityAnnualized: 0.4 }],
    };
    expect(instrumentVolatilitySeries("US:NVDA", current as never, [historical as never])).toEqual([
      { date: "2026-07-01", value: 0.3 },
      { date: "2026-07-02", value: 0.4 },
    ]);
  });
});
