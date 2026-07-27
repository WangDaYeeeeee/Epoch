import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import {
  validateClaim, validateEvidence, type ClaimInput, type EvidenceInput,
} from "../domain/research-evidence";

export class PostgresResearchEvidenceRepository {
  constructor(private readonly sql: Sql) {}

  async saveEvidence(input: EvidenceInput): Promise<string> {
    const evidence = validateEvidence(input);
    const rows = await this.sql<{ id: string }[]>`
      INSERT INTO research_evidence (
        id, title, source_type, source_name, source_url, observed_at, effective_date, excerpt, content_hash
      ) VALUES (
        ${randomUUID()}, ${evidence.title}, ${evidence.sourceType}, ${evidence.sourceName},
        ${evidence.sourceUrl ?? null}, ${evidence.observedAt}, ${evidence.effectiveDate ?? null},
        ${evidence.excerpt}, ${evidence.contentHash}
      )
      ON CONFLICT (source_name, content_hash) DO UPDATE SET title = research_evidence.title
      RETURNING id::text
    `;
    return rows[0].id;
  }

  async saveClaim(candidateId: string, input: ClaimInput): Promise<string> {
    const claim = validateClaim(input);
    const id = randomUUID();
    await this.sql.begin(async (transaction) => {
      const evidenceIds = [...claim.supportingEvidenceIds, ...claim.counterEvidenceIds];
      if (evidenceIds.length) {
        const existing = await transaction<{ id: string }[]>`
          SELECT id::text FROM research_evidence WHERE id = ANY(${evidenceIds})
        `;
        if (existing.length !== evidenceIds.length) throw new Error("Claim references unknown evidence");
      }
      await transaction`
        INSERT INTO research_claim (id, candidate_id, kind, statement, reasoning, confidence, as_of)
        VALUES (${id}, ${candidateId}, ${claim.kind}, ${claim.statement}, ${claim.reasoning}, ${claim.confidence}, ${claim.asOf})
      `;
      for (const evidenceId of claim.supportingEvidenceIds) {
        await transaction`INSERT INTO claim_evidence (claim_id, evidence_id, role) VALUES (${id}, ${evidenceId}, 'support')`;
      }
      for (const evidenceId of claim.counterEvidenceIds) {
        await transaction`INSERT INTO claim_evidence (claim_id, evidence_id, role) VALUES (${id}, ${evidenceId}, 'counter')`;
      }
    });
    return id;
  }

  async linkAssessment(input: {
    assessmentId: string;
    claimId: string;
    role: "support" | "counter";
  }): Promise<void> {
    const rows = await this.sql<{ valid: boolean }[]>`
      SELECT true AS valid
      FROM factor_assessment assessment
      JOIN research_claim claim ON claim.candidate_id = assessment.candidate_id
      WHERE assessment.id = ${input.assessmentId} AND claim.id = ${input.claimId}
    `;
    if (!rows[0]) throw new Error("Assessment and claim must belong to the same candidate");
    await this.sql`
      INSERT INTO factor_assessment_claim (assessment_id, claim_id, role)
      VALUES (${input.assessmentId}, ${input.claimId}, ${input.role})
      ON CONFLICT (assessment_id, claim_id) DO UPDATE SET role = EXCLUDED.role
    `;
  }

  async loadClaims(candidateId: string) {
    return this.sql<{
      id: string; kind: string; statement: string; reasoning: string; confidence: string;
      as_of: string; evidence_id: string | null; evidence_role: string | null;
    }[]>`
      SELECT claim.id::text, claim.kind, claim.statement, claim.reasoning, claim.confidence::text,
             claim.as_of::text, link.evidence_id::text, link.role AS evidence_role
      FROM research_claim claim
      LEFT JOIN claim_evidence link ON link.claim_id = claim.id
      WHERE claim.candidate_id = ${candidateId}
      ORDER BY claim.as_of DESC, claim.recorded_at DESC, claim.id, link.role, link.evidence_id
    `;
  }
}
