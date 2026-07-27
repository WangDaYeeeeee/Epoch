export const AGENT_TASK_TYPES = [
  "research_candidate",
  "review_position",
  "review_portfolio",
  "prepare_event",
  "assess_event",
  "propose_rebalance",
  "run_review",
] as const;

export type AgentTaskType = typeof AGENT_TASK_TYPES[number];
export const AGENT_OUTPUT_SCHEMA_VERSION = "epoch-agent-output/1.0";

export type AgentCitation = {
  evidenceId?: string;
  sourceUrl?: string;
  title: string;
  supports: string;
};

export type AgentRunRequest = {
  taskType: AgentTaskType;
  model: string;
  promptVersion: string;
  input: Record<string, unknown>;
};

export type AgentRunCompletion = {
  runId: string;
  output: Record<string, unknown>;
  citations: AgentCitation[];
  limitations: string[];
  calculationRunIds?: string[];
};

const required = (value: unknown, name: string, maximum = 5000): string => {
  if (typeof value !== "string") throw new Error(`${name} must be a string`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) throw new Error(`${name} must contain 1-${maximum} characters`);
  return normalized;
};

const object = (value: unknown, name: string): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
};

export function validateAgentRunRequest(input: AgentRunRequest): AgentRunRequest {
  if (!AGENT_TASK_TYPES.includes(input.taskType)) throw new Error("Unsupported agent task type");
  return {
    taskType: input.taskType,
    model: required(input.model, "agent.model", 200),
    promptVersion: required(input.promptVersion, "agent.promptVersion", 200),
    input: object(input.input, "agent.input"),
  };
}

const requireSummary = (output: Record<string, unknown>) => required(output.summary, "agent.output.summary");

export function validateAgentOutput(taskType: AgentTaskType, raw: unknown): Record<string, unknown> {
  const output = object(raw, "agent.output");
  if (taskType === "research_candidate") {
    required(output.candidateId, "agent.output.candidateId", 100);
    if (!Array.isArray(output.claims) || !output.claims.length) throw new Error("Candidate research requires claims");
    for (const claim of output.claims) {
      const item = object(claim, "agent.output.claim");
      if (!["fact", "hypothesis", "inference"].includes(String(item.kind))) throw new Error("Unsupported research claim kind");
      required(item.statement, "agent.output.claim.statement");
      if (typeof item.confidence !== "number" || item.confidence < 0 || item.confidence > 1) {
        throw new Error("Claim confidence must be between 0 and 1");
      }
      required(item.asOf, "agent.output.claim.asOf", 10);
      if (!Array.isArray(item.supportingEvidenceIds) || !Array.isArray(item.counterEvidenceIds)) {
        throw new Error("Claims require supportingEvidenceIds and counterEvidenceIds");
      }
      if (item.kind === "fact" && !item.supportingEvidenceIds.length) {
        throw new Error("Fact claims require supportingEvidenceIds");
      }
      if (item.kind !== "fact") required(item.reasoning, "agent.output.claim.reasoning");
    }
    validateFactorAssessment(
      object(output.factorAssessment, "agent.output.factorAssessment") as Parameters<typeof validateFactorAssessment>[0],
    );
    validateWeightTier(
      object(output.weightTierProposal, "agent.output.weightTierProposal") as Parameters<typeof validateWeightTier>[0],
    );
  } else if (taskType === "prepare_event") {
    required(output.eventId, "agent.output.eventId", 100);
    requireSummary(output);
    if (!Array.isArray(output.branches) || !output.branches.length) throw new Error("Event preparation requires branches");
  } else if (taskType === "assess_event") {
    required(output.eventId, "agent.output.eventId", 100);
    requireSummary(output);
    required(output.proposedAction, "agent.output.proposedAction");
  } else if (taskType === "propose_rebalance") {
    if (!Array.isArray(output.targetWeights) || !output.targetWeights.length) throw new Error("Rebalance proposal requires targetWeights");
    for (const target of output.targetWeights) {
      const item = object(target, "agent.output.targetWeight");
      required(item.instrumentId, "agent.output.targetWeight.instrumentId", 100);
      if (typeof item.weight !== "number" || !Number.isFinite(item.weight) || Math.abs(item.weight) > 1) {
        throw new Error("Target weight must be finite and within [-1, 1]");
      }
    }
    required(output.rationale, "agent.output.rationale");
    if ("policyGatePassed" in output || "compliant" in output) {
      throw new Error("Agent output cannot assert Policy Gate compliance");
    }
  } else if (taskType === "run_review") {
    if (!["daily", "weekly", "monthly", "quarterly", "post_exit"].includes(String(output.cadence))) {
      throw new Error("Unsupported review cadence");
    }
    requireSummary(output);
    required(output.whatWorked, "agent.output.whatWorked");
    required(output.whatFailed, "agent.output.whatFailed");
    required(output.followUp, "agent.output.followUp");
  } else {
    requireSummary(output);
    if (!Array.isArray(output.findings)) throw new Error("Review output requires findings");
    if (!Array.isArray(output.recommendations)) throw new Error("Review output requires recommendations");
  }
  return output;
}

export function validateAgentCompletion(taskType: AgentTaskType, input: AgentRunCompletion): AgentRunCompletion {
  const citations = input.citations.map((citation) => ({
    ...(citation.evidenceId ? { evidenceId: required(citation.evidenceId, "citation.evidenceId", 100) } : {}),
    ...(citation.sourceUrl ? { sourceUrl: required(citation.sourceUrl, "citation.sourceUrl", 2000) } : {}),
    title: required(citation.title, "citation.title", 500),
    supports: required(citation.supports, "citation.supports", 1000),
  }));
  if (taskType === "research_candidate" && !citations.length) throw new Error("Candidate research requires citations");
  return {
    runId: required(input.runId, "agent.runId", 100),
    output: validateAgentOutput(taskType, input.output),
    citations,
    limitations: input.limitations.map((item) => required(item, "agent.limitation", 1000)),
    calculationRunIds: input.calculationRunIds ?? [],
  };
}

export const agentOutputJsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: AGENT_OUTPUT_SCHEMA_VERSION,
  type: "object",
  required: ["taskType", "output", "citations", "limitations"],
  properties: {
    taskType: { enum: AGENT_TASK_TYPES },
    output: { type: "object" },
    citations: {
      type: "array",
      items: {
        type: "object",
        required: ["title", "supports"],
        properties: {
          evidenceId: { type: "string" },
          sourceUrl: { type: "string", format: "uri" },
          title: { type: "string", minLength: 1 },
          supports: { type: "string", minLength: 1 },
        },
      },
    },
    limitations: { type: "array", items: { type: "string", minLength: 1 } },
  },
} as const;
import { validateFactorAssessment, validateWeightTier } from "./allocation-judgment";
