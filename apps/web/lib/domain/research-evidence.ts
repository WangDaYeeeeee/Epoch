export const CLAIM_KINDS = ["fact", "hypothesis", "inference"] as const;
export type ClaimKind = typeof CLAIM_KINDS[number];
export const EVIDENCE_SOURCE_TYPES = ["primary", "secondary", "internal"] as const;
export type EvidenceSourceType = typeof EVIDENCE_SOURCE_TYPES[number];

export type EvidenceInput = {
  title: string;
  sourceType: EvidenceSourceType;
  sourceName: string;
  sourceUrl?: string | null;
  observedAt: string;
  effectiveDate?: string | null;
  excerpt: string;
  contentHash: string;
};

export type ClaimInput = {
  kind: ClaimKind;
  statement: string;
  reasoning: string;
  confidence: number;
  asOf: string;
  supportingEvidenceIds: string[];
  counterEvidenceIds: string[];
};

const text = (value: string, name: string, maximum: number): string => {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) throw new Error(`${name} must contain 1-${maximum} characters`);
  return normalized;
};

export function validateEvidence(input: EvidenceInput): EvidenceInput {
  if (!EVIDENCE_SOURCE_TYPES.includes(input.sourceType)) throw new Error("Unsupported evidence source type");
  if (!Number.isFinite(Date.parse(input.observedAt))) throw new Error("Evidence observedAt must be an ISO timestamp");
  if (input.effectiveDate != null && !/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveDate)) {
    throw new Error("Evidence effectiveDate must be an ISO date");
  }
  if (!/^[a-f0-9]{64}$/i.test(input.contentHash)) throw new Error("Evidence contentHash must be SHA-256");
  if (input.sourceUrl != null) {
    const url = new URL(input.sourceUrl);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("Evidence sourceUrl must use HTTP(S)");
  }
  return {
    ...input,
    title: text(input.title, "evidence.title", 300),
    sourceName: text(input.sourceName, "evidence.sourceName", 300),
    excerpt: text(input.excerpt, "evidence.excerpt", 5000),
    contentHash: input.contentHash.toLowerCase(),
  };
}

export function validateClaim(input: ClaimInput): ClaimInput {
  if (!CLAIM_KINDS.includes(input.kind)) throw new Error("Unsupported claim kind");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.asOf)) throw new Error("Claim asOf must be an ISO date");
  if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
    throw new Error("Claim confidence must be between 0 and 1");
  }
  const supportingEvidenceIds = [...new Set(input.supportingEvidenceIds)];
  const counterEvidenceIds = [...new Set(input.counterEvidenceIds)];
  if (supportingEvidenceIds.some((id) => counterEvidenceIds.includes(id))) {
    throw new Error("The same evidence cannot support and counter the same claim");
  }
  if (input.kind === "fact" && supportingEvidenceIds.length === 0) {
    throw new Error("A fact claim requires supporting evidence");
  }
  if (input.kind !== "fact" && !input.reasoning.trim()) {
    throw new Error("Hypothesis and inference claims require reasoning");
  }
  return {
    ...input,
    statement: text(input.statement, "claim.statement", 2000),
    reasoning: input.kind === "fact" ? input.reasoning.trim() : text(input.reasoning, "claim.reasoning", 5000),
    supportingEvidenceIds,
    counterEvidenceIds,
  };
}
