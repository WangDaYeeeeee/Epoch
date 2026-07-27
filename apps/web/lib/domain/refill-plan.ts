export type RefillBatchNumber = 1 | 2 | 3;
export type RefillBatchState = "pending" | "eligible" | "blocked" | "executed" | "not_executed";

export type RefillEvaluationInput = {
  batchNumber: RefillBatchNumber;
  previousBatchesExecuted: boolean;
  consecutiveGatePassTradingDays: number;
  originalRiskSignalCleared: boolean;
  factorInvalidationTriggered: boolean;
  projectedPolicyGatePassed: boolean;
  currentTargetConfirmed: boolean;
};

export type RefillEvaluation = {
  state: "pending" | "eligible" | "blocked";
  mandatory: boolean;
  reasons: string[];
};

export function evaluateRefillBatch(input: RefillEvaluationInput): RefillEvaluation {
  if (![1, 2, 3].includes(input.batchNumber)) throw new Error("Refill batch number must be 1, 2 or 3");
  if (!Number.isInteger(input.consecutiveGatePassTradingDays) || input.consecutiveGatePassTradingDays < 0) {
    throw new Error("Consecutive gate-pass days must be a non-negative integer");
  }
  const mandatory = input.consecutiveGatePassTradingDays >= 10 && !input.factorInvalidationTriggered;
  const reasons: string[] = [];
  if (!input.currentTargetConfirmed) reasons.push("CURRENT_TARGET_NOT_CONFIRMED");
  if (input.factorInvalidationTriggered) reasons.push("FACTOR_INVALIDATION_TRIGGERED");
  if (!input.projectedPolicyGatePassed) reasons.push("REFILL_WOULD_EXCEED_POLICY_GATE");
  if (input.batchNumber > 1 && !input.previousBatchesExecuted) reasons.push("PREVIOUS_BATCH_NOT_EXECUTED");
  if (reasons.length) return { state: "blocked", mandatory, reasons };

  const triggerPassed = input.batchNumber === 1
    ? input.consecutiveGatePassTradingDays >= 1
    : input.batchNumber === 2
      ? input.consecutiveGatePassTradingDays >= 5 && input.originalRiskSignalCleared
      : input.consecutiveGatePassTradingDays >= 10;
  if (!triggerPassed) {
    if (input.batchNumber === 2 && input.consecutiveGatePassTradingDays >= 5 && !input.originalRiskSignalCleared) {
      reasons.push("ORIGINAL_RISK_SIGNAL_NOT_CLEARED");
    } else {
      reasons.push("TRIGGER_NOT_REACHED");
    }
    return { state: "pending", mandatory, reasons };
  }
  return { state: "eligible", mandatory, reasons: [] };
}

export function validateRefillTransition(input: {
  from: RefillBatchState;
  to: RefillBatchState;
  reason: string;
}): void {
  const allowed: Record<RefillBatchState, RefillBatchState[]> = {
    pending: ["eligible", "blocked"],
    eligible: ["blocked", "executed", "not_executed"],
    blocked: ["pending", "eligible", "not_executed"],
    executed: [],
    not_executed: [],
  };
  if (!allowed[input.from].includes(input.to)) throw new Error(`Invalid refill transition: ${input.from} -> ${input.to}`);
  if (input.to === "not_executed" && !input.reason.trim()) throw new Error("A non-execution reason is required");
}
