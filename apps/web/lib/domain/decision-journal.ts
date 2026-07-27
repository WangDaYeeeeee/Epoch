export const DECISION_TRIGGER_TYPES = ["risk", "temporary", "exception", "routine"] as const;
export type DecisionTriggerType = typeof DECISION_TRIGGER_TYPES[number];
export const DECISION_OUTCOMES = ["confirmed", "modified", "rejected"] as const;
export type DecisionOutcome = typeof DECISION_OUTCOMES[number];

export type DecisionInput = {
  calculationRunId: string;
  triggerType: DecisionTriggerType;
  outcome: DecisionOutcome;
  rationale: string;
  monitoringNotes: string;
  decidedAt: string;
};

export type ExecutionInput = {
  decisionId: string;
  executedAt: string;
  brokerReference: string;
  actualWeights: { instrumentId: string; weight: number }[];
  note: string;
};

export type DecisionJournalEntry = {
  id: string;
  calculationRunId: string;
  triggerType: DecisionTriggerType;
  outcome: DecisionOutcome;
  rationale: string;
  monitoringNotes: string;
  decidedAt: string;
  targetInput: Record<string, unknown> | null;
  riskOutput: Record<string, unknown> | null;
  rebalanceRecord: Record<string, unknown> | null;
  execution: {
    id: string;
    executedAt: string;
    brokerReference: string;
    actualWeights: unknown;
  } | null;
};

const required = (value: string, name: string, maximum = 5000): string => {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) throw new Error(`${name} must contain 1-${maximum} characters`);
  return normalized;
};

export function validateDecision(input: DecisionInput): DecisionInput {
  if (!DECISION_TRIGGER_TYPES.includes(input.triggerType)) throw new Error("Unsupported decision trigger type");
  if (!DECISION_OUTCOMES.includes(input.outcome)) throw new Error("Unsupported decision outcome");
  if (!Number.isFinite(Date.parse(input.decidedAt))) throw new Error("Decision decidedAt must be an ISO timestamp");
  return {
    ...input,
    calculationRunId: required(input.calculationRunId, "calculationRunId", 100),
    rationale: required(input.rationale, "rationale"),
    monitoringNotes: input.monitoringNotes.trim(),
  };
}

export function validateExecution(input: ExecutionInput): ExecutionInput {
  if (!Number.isFinite(Date.parse(input.executedAt))) throw new Error("Execution executedAt must be an ISO timestamp");
  if (!input.actualWeights.length) throw new Error("Execution requires actual weights");
  const seen = new Set<string>();
  const actualWeights = input.actualWeights.map((item) => {
    const instrumentId = item.instrumentId.trim().toUpperCase();
    if (!instrumentId.includes(":") || seen.has(instrumentId)) throw new Error("Execution instrument ids must be canonical and unique");
    if (!Number.isFinite(item.weight) || item.weight < 0 || item.weight > 1) throw new Error("Execution weights must be between 0 and 1");
    seen.add(instrumentId);
    return { instrumentId, weight: item.weight };
  });
  if (actualWeights.reduce((sum, item) => sum + item.weight, 0) > 1 + 1e-9) {
    throw new Error("Execution risk-asset weights cannot exceed 100%");
  }
  return {
    ...input,
    decisionId: required(input.decisionId, "decisionId", 100),
    brokerReference: required(input.brokerReference, "brokerReference", 300),
    note: input.note.trim(),
    actualWeights,
  };
}
