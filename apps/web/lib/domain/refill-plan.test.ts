import { describe, expect, it } from "vitest";
import { evaluateRefillBatch, validateRefillTransition } from "./refill-plan";

describe("refill plan", () => {
  it("makes the first batch eligible when the gate returns below the cap", () => {
    expect(evaluateRefillBatch({
      batchNumber: 1, previousBatchesExecuted: true, consecutiveGatePassTradingDays: 1,
      originalRiskSignalCleared: false, factorInvalidationTriggered: false,
      projectedPolicyGatePassed: true, currentTargetConfirmed: true,
    })).toEqual({ state: "eligible", mandatory: false, reasons: [] });
  });

  it("requires five days and the original risk signal to clear for batch two", () => {
    expect(evaluateRefillBatch({
      batchNumber: 2, previousBatchesExecuted: true, consecutiveGatePassTradingDays: 5,
      originalRiskSignalCleared: false, factorInvalidationTriggered: false,
      projectedPolicyGatePassed: true, currentTargetConfirmed: true,
    })).toMatchObject({ state: "pending", reasons: ["ORIGINAL_RISK_SIGNAL_NOT_CLEARED"] });
  });

  it("forces remaining refill after ten pass days unless invalidated or gate-blocked", () => {
    expect(evaluateRefillBatch({
      batchNumber: 3, previousBatchesExecuted: true, consecutiveGatePassTradingDays: 10,
      originalRiskSignalCleared: true, factorInvalidationTriggered: false,
      projectedPolicyGatePassed: true, currentTargetConfirmed: true,
    })).toEqual({ state: "eligible", mandatory: true, reasons: [] });
    expect(evaluateRefillBatch({
      batchNumber: 3, previousBatchesExecuted: true, consecutiveGatePassTradingDays: 10,
      originalRiskSignalCleared: true, factorInvalidationTriggered: false,
      projectedPolicyGatePassed: false, currentTargetConfirmed: true,
    })).toMatchObject({ state: "blocked", mandatory: true, reasons: ["REFILL_WOULD_EXCEED_POLICY_GATE"] });
  });

  it("requires written reasons when an eligible batch is not executed", () => {
    expect(() => validateRefillTransition({ from: "eligible", to: "not_executed", reason: "" }))
      .toThrow("non-execution reason");
  });
});
