import { describe, expect, it } from "vitest";
import { assertAbsorptionCadence, validateReview } from "./review";

describe("multi-cycle review", () => {
  it("requires a candidate for position reviews and reserves absorption for quarterly reviews", () => {
    expect(() => validateReview({
      cadence: "monthly", scope: "position", asOf: "2026-07-27",
      strategyVersion: "strategy-v1", parameterSetVersion: "params-v1",
      summary: "Summary", whatWorked: "Worked", whatFailed: "Failed",
      followUp: "Follow-up", confirmed: true,
    })).toThrow("candidateId");
    expect(() => assertAbsorptionCadence("weekly")).toThrow("quarterly");
    expect(() => assertAbsorptionCadence("quarterly")).not.toThrow();
  });
});
