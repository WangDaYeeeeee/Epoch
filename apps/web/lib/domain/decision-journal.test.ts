import { describe, expect, it } from "vitest";
import { validateDecision, validateExecution } from "./decision-journal";

describe("decision journal", () => {
  it("requires an explicit trigger, outcome and rationale", () => {
    expect(validateDecision({
      calculationRunId: "run-1", triggerType: "routine", outcome: "confirmed",
      rationale: "Quarterly rebalance", monitoringNotes: "Watch earnings", decidedAt: "2026-07-27T00:00:00Z",
    }).outcome).toBe("confirmed");
  });

  it("records canonical actual weights without normalizing them", () => {
    const result = validateExecution({
      decisionId: "decision-1", executedAt: "2026-07-27T00:00:00Z", brokerReference: "manual-1",
      actualWeights: [{ instrumentId: "us:googl", weight: 0.25 }, { instrumentId: "US:TSM", weight: 0.2 }],
      note: "Executed outside Epoch",
    });
    expect(result.actualWeights).toEqual([
      { instrumentId: "US:GOOGL", weight: 0.25 },
      { instrumentId: "US:TSM", weight: 0.2 },
    ]);
  });

  it("rejects duplicate or over-allocated execution records", () => {
    expect(() => validateExecution({
      decisionId: "decision-1", executedAt: "2026-07-27T00:00:00Z", brokerReference: "manual-1",
      actualWeights: [{ instrumentId: "US:GOOGL", weight: 0.6 }, { instrumentId: "US:TSM", weight: 0.5 }],
      note: "",
    })).toThrow("cannot exceed 100%");
  });
});
