import type { Sql } from "postgres";
import { memoryMatchScore, normalizeMemoryQuery, type ResearchMemoryKind } from "../domain/research-memory";

type MemoryRow = {
  id: string;
  kind: ResearchMemoryKind;
  title: string;
  body: string;
  as_of: string;
  confidence: number | null;
  source: string;
  candidate_id: string | null;
  status: string | null;
};

export class PostgresResearchMemoryRepository {
  constructor(private readonly sql: Sql) {}

  async search(query: string, limit = 30) {
    const tokens = normalizeMemoryQuery(query);
    const boundedLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    const patterns = tokens.map((token) => `%${token}%`);
    const rows = await this.sql<MemoryRow[]>`
      WITH memory AS (
        SELECT claim.id::text, 'claim'::text AS kind, claim.statement AS title,
               claim.reasoning AS body, claim.as_of::text,
               claim.confidence::float8 AS confidence, claim.kind AS source,
               claim.candidate_id::text, outcome.outcome AS status
        FROM research_claim claim
        LEFT JOIN LATERAL (
          SELECT outcome FROM claim_outcome WHERE claim_id = claim.id
          ORDER BY evaluated_as_of DESC, recorded_at DESC LIMIT 1
        ) outcome ON true
        UNION ALL
        SELECT evidence.id::text, 'evidence', evidence.title, evidence.excerpt,
               COALESCE(evidence.effective_date::text, evidence.observed_at::date::text),
               NULL::float8, evidence.source_name, NULL::text, evidence.source_type
        FROM research_evidence evidence
        UNION ALL
        SELECT version.id::text, 'theme', theme.name, concat_ws(' ', version.thesis, version.profit_path, version.invalidation_condition),
               version.as_of::text, NULL::float8, version.phase, NULL::text, version.status
        FROM theme_version version JOIN investment_theme theme ON theme.id = version.theme_id
        UNION ALL
        SELECT review.id::text, 'review', review.summary,
               concat_ws(' ', review.what_worked, review.what_failed, review.follow_up),
               review.as_of::text, NULL::float8, review.cadence,
               review.candidate_id::text, review.status
        FROM investment_review review
      )
      SELECT * FROM memory
      WHERE EXISTS (
        SELECT 1 FROM unnest(${patterns}::text[]) pattern
        WHERE concat_ws(' ', title, body, source) ILIKE pattern
      )
      ORDER BY as_of DESC, id
      LIMIT ${Math.min(500, boundedLimit * 10)}
    `;
    return rows
      .map((row) => ({
        ...row,
        score: memoryMatchScore(`${row.title} ${row.body} ${row.source}`, tokens),
      }))
      .sort((left, right) => right.score - left.score || right.as_of.localeCompare(left.as_of))
      .slice(0, boundedLimit);
  }
}
