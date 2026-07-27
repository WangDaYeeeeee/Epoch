export type ClaimOutcome = "verified_true" | "verified_false" | "indeterminate";

export function oneStepVarianceEvaluation(input: {
  predictedVariance: number;
  previousClose: number;
  realizedClose: number;
}) {
  if (!Number.isFinite(input.predictedVariance) || input.predictedVariance < 0) {
    throw new Error("Predicted variance must be finite and non-negative");
  }
  if (![input.previousClose, input.realizedClose].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error("Forecast evaluation requires positive closes");
  }
  const realizedReturn = Math.log(input.realizedClose / input.previousClose);
  const realizedVariance = realizedReturn ** 2;
  const error = input.predictedVariance - realizedVariance;
  return {
    predictedVariance: input.predictedVariance,
    realizedReturn,
    realizedVariance,
    error,
    absoluteError: Math.abs(error),
    squaredError: error ** 2,
  };
}

export function validateClaimOutcome(value: string): ClaimOutcome {
  if (!["verified_true", "verified_false", "indeterminate"].includes(value)) {
    throw new Error("Unsupported claim outcome");
  }
  return value as ClaimOutcome;
}
