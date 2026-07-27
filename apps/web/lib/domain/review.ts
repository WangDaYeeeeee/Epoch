export const REVIEW_CADENCES = ["daily", "weekly", "monthly", "quarterly", "post_exit"] as const;
export type ReviewCadence = typeof REVIEW_CADENCES[number];
export type ReviewScope = "portfolio" | "position";

export type ReviewInput = {
  cadence: ReviewCadence;
  scope: ReviewScope;
  asOf: string;
  candidateId?: string | null;
  calculationRunId?: string | null;
  strategyVersion: string;
  parameterSetVersion: string;
  summary: string;
  whatWorked: string;
  whatFailed: string;
  followUp: string;
  confirmed: boolean;
};

const required = (value: string, name: string, maximum = 5000): string => {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) throw new Error(`${name} must contain 1-${maximum} characters`);
  return normalized;
};

export function validateReview(input: ReviewInput): ReviewInput {
  if (!REVIEW_CADENCES.includes(input.cadence)) throw new Error("Unsupported review cadence");
  if (!["portfolio", "position"].includes(input.scope)) throw new Error("Unsupported review scope");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.asOf)) throw new Error("Review asOf must be an ISO date");
  if (input.scope === "position" && !input.candidateId) throw new Error("Position review requires candidateId");
  if (input.scope === "portfolio" && input.candidateId) throw new Error("Portfolio review cannot reference candidateId");
  return {
    ...input,
    strategyVersion: required(input.strategyVersion, "review.strategyVersion", 200),
    parameterSetVersion: required(input.parameterSetVersion, "review.parameterSetVersion", 200),
    summary: required(input.summary, "review.summary"),
    whatWorked: required(input.whatWorked, "review.whatWorked"),
    whatFailed: required(input.whatFailed, "review.whatFailed"),
    followUp: required(input.followUp, "review.followUp"),
  };
}

export function assertAbsorptionCadence(cadence: ReviewCadence): void {
  if (cadence !== "quarterly") throw new Error("Only a quarterly review can absorb exception or refill records");
}
