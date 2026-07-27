import { describe, expect, it } from "vitest";
import fixtures from "../../fixtures/agent-evals/v1.json";
import { validateAgentOutput, validateAgentRunRequest, type AgentTaskType } from "./agent-gateway";

describe("agent gateway contract", () => {
  it("accepts all declared task types and rejects agent-authored Policy Gate claims", () => {
    expect(validateAgentRunRequest({
      taskType: "review_portfolio",
      model: "test-model",
      promptVersion: "prompt-v1",
      input: {},
    }).taskType).toBe("review_portfolio");
    expect(() => validateAgentOutput("propose_rebalance", {
      targetWeights: [{ instrumentId: "US:GOOGL", weight: 0.2 }],
      rationale: "Reduce concentration.",
      policyGatePassed: true,
    })).toThrow("cannot assert Policy Gate");
  });

  it("requires citations for fact-based candidate research", () => {
    expect(() => validateAgentOutput("research_candidate", {
      candidateId: "candidate-1",
      claims: [{
        kind: "fact", statement: "Orders rose.", confidence: 0.8, asOf: "2026-07-27",
        supportingEvidenceIds: [], counterEvidenceIds: [],
      }],
      factorAssessment: Array.from({ length: 6 }, () => ({})),
      weightTierProposal: {},
    })).toThrow("supportingEvidenceIds");
  });

  it("accepts the fixed regression output for every task type", () => {
    expect(fixtures).toHaveLength(7);
    for (const fixture of fixtures) {
      expect(() => validateAgentOutput(fixture.taskType as AgentTaskType, fixture.output)).not.toThrow();
    }
  });
});
