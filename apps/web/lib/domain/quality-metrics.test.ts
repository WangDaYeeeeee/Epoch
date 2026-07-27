import { describe, expect, it } from "vitest";
import { oneStepVarianceEvaluation, validateClaimOutcome } from "./quality-metrics";

describe("quality metrics", () => {
  it("evaluates a one-step variance forecast against the next observed close", () => {
    const result = oneStepVarianceEvaluation({
      predictedVariance: 0.0004,
      previousClose: 100,
      realizedClose: 102,
    });
    expect(result.realizedReturn).toBeCloseTo(Math.log(1.02));
    expect(result.absoluteError).toBeCloseTo(Math.abs(0.0004 - Math.log(1.02) ** 2));
  });

  it("keeps indeterminate outcomes out of binary truth claims", () => {
    expect(validateClaimOutcome("indeterminate")).toBe("indeterminate");
    expect(() => validateClaimOutcome("mostly_true")).toThrow("Unsupported");
  });
});
