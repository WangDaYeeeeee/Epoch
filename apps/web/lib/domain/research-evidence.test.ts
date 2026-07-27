import { describe, expect, it } from "vitest";
import { validateClaim, validateEvidence } from "./research-evidence";

describe("research evidence", () => {
  it("requires immutable source identity for evidence", () => {
    const evidence = validateEvidence({
      title: "Company filing", sourceType: "primary", sourceName: "SEC",
      sourceUrl: "https://www.sec.gov/example", observedAt: "2026-07-27T00:00:00Z",
      effectiveDate: "2026-07-26", excerpt: "Revenue increased.", contentHash: "a".repeat(64),
    });
    expect(evidence.contentHash).toBe("a".repeat(64));
  });

  it("requires evidence for facts and reasoning for hypotheses", () => {
    expect(() => validateClaim({
      kind: "fact", statement: "Revenue increased", reasoning: "", confidence: 1,
      asOf: "2026-07-27", supportingEvidenceIds: [], counterEvidenceIds: [],
    })).toThrow("requires supporting evidence");
    expect(() => validateClaim({
      kind: "hypothesis", statement: "Margins may expand", reasoning: "", confidence: 0.6,
      asOf: "2026-07-27", supportingEvidenceIds: ["e1"], counterEvidenceIds: [],
    })).toThrow("require reasoning");
  });

  it("keeps supporting and counter evidence roles disjoint", () => {
    expect(() => validateClaim({
      kind: "inference", statement: "Demand is durable", reasoning: "Orders and lead times agree",
      confidence: 0.7, asOf: "2026-07-27", supportingEvidenceIds: ["e1"], counterEvidenceIds: ["e1"],
    })).toThrow("cannot support and counter");
  });
});
