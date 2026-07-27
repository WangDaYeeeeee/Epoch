export const FACTOR_NAMES = [
  "momentum", "certainty", "moat", "earnings_quality", "earnings_revision", "valuation",
] as const;
export type FactorName = typeof FACTOR_NAMES[number];
export type FactorConclusion = "strong" | "neutral" | "weak" | "insufficient";
export type FactorDirection = "improving" | "stable" | "deteriorating" | "unknown";
export const WEIGHT_TIERS = [10, 15, 20, 25, 30, 35, 40] as const;
export type WeightTierPercent = typeof WEIGHT_TIERS[number];

export type FactorAssessmentItem = {
  factor: FactorName;
  conclusion: FactorConclusion;
  confidence: number;
  evidence: string;
  counterEvidence: string;
  direction: FactorDirection;
  impact: string;
};

export type FactorAssessmentInput = {
  asOf: string;
  summary: string;
  rankingReason: string;
  items: FactorAssessmentItem[];
};

export type WeightTierInput = {
  asOf: string;
  weightPercent: WeightTierPercent;
  earningsExpectation: string;
  primaryRisk: string;
  invalidationCondition: string;
  whyThisTier: string;
};

const required = (value: string, name: string, maximum = 2000): string => {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) throw new Error(`${name} must contain 1-${maximum} characters`);
  return normalized;
};

export function validateFactorAssessment(input: FactorAssessmentInput): FactorAssessmentInput {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.asOf)) throw new Error("Factor assessment asOf must be an ISO date");
  if (input.items.length !== FACTOR_NAMES.length) throw new Error("Factor assessment must contain all six factors");
  const byName = new Map(input.items.map((item) => [item.factor, item]));
  if (byName.size !== FACTOR_NAMES.length || FACTOR_NAMES.some((factor) => !byName.has(factor))) {
    throw new Error("Factor assessment must contain each factor exactly once");
  }
  return {
    asOf: input.asOf,
    summary: required(input.summary, "summary"),
    rankingReason: required(input.rankingReason, "rankingReason"),
    items: FACTOR_NAMES.map((factor) => {
      const item = byName.get(factor)!;
      if (!Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1) {
        throw new Error(`Confidence for ${factor} must be between 0 and 1`);
      }
      return {
        ...item,
        evidence: required(item.evidence, `${factor}.evidence`),
        counterEvidence: required(item.counterEvidence, `${factor}.counterEvidence`),
        impact: required(item.impact, `${factor}.impact`),
      };
    }),
  };
}

export function validateWeightTier(input: WeightTierInput): WeightTierInput {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.asOf)) throw new Error("Weight tier asOf must be an ISO date");
  if (!WEIGHT_TIERS.includes(input.weightPercent)) throw new Error("Weight tier must be one of 10/15/20/25/30/35/40");
  return {
    asOf: input.asOf,
    weightPercent: input.weightPercent,
    earningsExpectation: required(input.earningsExpectation, "earningsExpectation", 1000),
    primaryRisk: required(input.primaryRisk, "primaryRisk", 1000),
    invalidationCondition: required(input.invalidationCondition, "invalidationCondition", 1000),
    whyThisTier: required(input.whyThisTier, "whyThisTier", 1000),
  };
}
