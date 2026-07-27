import { describe, expect, it } from "vitest";
import {
  FACTOR_NAMES, validateFactorAssessment, validateWeightTier, type FactorAssessmentItem,
} from "./allocation-judgment";

const factors = (): FactorAssessmentItem[] => FACTOR_NAMES.map((factor) => ({
  factor, conclusion: "neutral", confidence: 0.6, evidence: `${factor} evidence`,
  counterEvidence: `${factor} counter`, direction: "stable", impact: `${factor} impact`,
}));

describe("allocation judgment", () => {
  it("requires each of the six non-scored factors exactly once", () => {
    expect(validateFactorAssessment({
      asOf: "2026-07-27", summary: "Balanced assessment", rankingReason: "Ranks above peers", items: factors(),
    }).items.map((item) => item.factor)).toEqual(FACTOR_NAMES);
    expect(() => validateFactorAssessment({
      asOf: "2026-07-27", summary: "x", rankingReason: "x", items: factors().slice(1),
    })).toThrow("all six factors");
  });

  it("accepts only the explicit strategy weight ladder", () => {
    expect(validateWeightTier({
      asOf: "2026-07-27", weightPercent: 25, earningsExpectation: "If EPS reaches X, upside is Y",
      primaryRisk: "Demand weakens", invalidationCondition: "Orders decline for two quarters",
      whyThisTier: "More certain than standard positions but below the core holding",
    }).weightPercent).toBe(25);
    expect(() => validateWeightTier({
      asOf: "2026-07-27", weightPercent: 22 as 25, earningsExpectation: "x", primaryRisk: "x",
      invalidationCondition: "x", whyThisTier: "x",
    })).toThrow("10/15/20/25/30/35/40");
  });
});
