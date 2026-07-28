import { describe, expect, it } from "vitest";
import { calculateRiskDrift } from "./risk-drift";

describe("risk volatility drift", () => {
  it("classifies the strategy 1.5x and 2.0x levels from an explicit anchor", () => {
    const result = calculateRiskDrift({
      currentPortfolioVolatilityAnnualized: 0.3,
      currentInstruments: [
        { instrumentId: "US:AAA", weight: 0.4, volatilityAnnualized: 0.3, riskContribution: 0.12 },
        { instrumentId: "US:BBB", weight: 0.6, volatilityAnnualized: 0.4, riskContribution: 0.18 },
      ],
      anchor: {
        id: "anchor",
        calculationRunId: "run",
        effectiveAt: "2026-01-01T00:00:00Z",
        portfolioVolatilityAnnualized: 0.2,
        instruments: [
          { instrumentId: "US:AAA", weight: 0.5, volatilityAnnualized: 0.2, riskContribution: 0.1 },
          { instrumentId: "US:BBB", weight: 0.4, volatilityAnnualized: 0.2, riskContribution: 0.1 },
          { instrumentId: "US:EXITED", weight: 0.1, volatilityAnnualized: 0.1, riskContribution: 0.05 },
        ],
      },
    });
    expect(result.portfolio.ratio).toBeCloseTo(1.5);
    expect(result.portfolio.level).toBe("highlight");
    expect(result.divergence.weight).toBeCloseTo(0.2);
    expect(result.divergence.riskContribution).toBeCloseTo(0.075);
    expect(result.instruments[0]?.ratio).toBeCloseTo(1.5);
    expect(result.instruments[0]).toMatchObject({
      instrumentId: "US:AAA",
      anchorWeight: 0.5,
      currentWeight: 0.4,
      level: "highlight",
    });
    expect(result.instruments[1]).toMatchObject({ instrumentId: "US:BBB", ratio: 2, level: "strong" });
    expect(result.instruments[2]).toMatchObject({
      instrumentId: "US:EXITED",
      currentVolatilityAnnualized: null,
      ratio: null,
      level: "normal",
    });
  });
});
