import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import {
  assertAbsorptionCadence,
  validateReview,
  type ReviewInput,
} from "../domain/review";

export class PostgresReviewRepository {
  constructor(private readonly sql: Sql) {}

  async create(input: ReviewInput): Promise<string> {
    const review = validateReview(input);
    const id = randomUUID();
    await this.sql`
      INSERT INTO investment_review (
        id, cadence, scope, as_of, candidate_id, calculation_run_id,
        strategy_version_id, parameter_set_id, summary, what_worked,
        what_failed, follow_up, status
      ) VALUES (
        ${id}, ${review.cadence}, ${review.scope}, ${review.asOf},
        ${review.candidateId ?? null}, ${review.calculationRunId ?? null},
        ${review.strategyVersion}, ${review.parameterSetVersion}, ${review.summary},
        ${review.whatWorked}, ${review.whatFailed}, ${review.followUp},
        ${review.confirmed ? "confirmed" : "draft"}
      )
    `;
    return id;
  }

  async absorb(input: {
    reviewId: string;
    sourceType: "exception" | "refill_not_executed";
    sourceId: string;
    disposition: "absorbed" | "valid_exception" | "no_change";
    rationale: string;
  }): Promise<void> {
    const rationale = input.rationale.trim();
    if (!rationale) throw new Error("Review absorption rationale is required");
    await this.sql.begin(async (transaction) => {
      const reviews = await transaction<{ cadence: ReviewInput["cadence"]; status: string }[]>`
        SELECT cadence, status FROM investment_review WHERE id = ${input.reviewId} FOR UPDATE
      `;
      if (!reviews[0]) throw new Error("Review not found");
      assertAbsorptionCadence(reviews[0].cadence);
      if (reviews[0].status !== "confirmed") throw new Error("Absorption requires a confirmed quarterly review");

      if (input.sourceType === "exception") {
        const rows = await transaction<{ id: string }[]>`
          SELECT id::text FROM exception_record WHERE id = ${input.sourceId}
        `;
        if (!rows[0]) throw new Error("Exception record not found");
        if (input.disposition === "no_change") throw new Error("Exception absorption requires absorbed or valid_exception");
        await transaction`
          UPDATE exception_record SET review_status = ${input.disposition}
          WHERE id = ${input.sourceId}
        `;
      } else {
        const rows = await transaction<{ id: string }[]>`
          SELECT batch.id::text
          FROM refill_batch batch
          WHERE batch.id = ${input.sourceId} AND batch.state = 'not_executed'
        `;
        if (!rows[0]) throw new Error("Refill absorption requires a not_executed batch");
      }
      await transaction`
        INSERT INTO review_absorption (
          review_id, source_type, source_id, disposition, rationale
        ) VALUES (
          ${input.reviewId}, ${input.sourceType}, ${input.sourceId},
          ${input.disposition}, ${rationale}
        )
        ON CONFLICT (review_id, source_type, source_id)
        DO UPDATE SET disposition = EXCLUDED.disposition, rationale = EXCLUDED.rationale
      `;
    });
  }

  async load(limit = 50) {
    return this.sql`
      SELECT review.id::text, review.cadence, review.scope, review.as_of::text,
             review.candidate_id::text, review.calculation_run_id::text,
             review.strategy_version_id AS strategy_version,
             review.parameter_set_id AS parameter_set_version,
             review.summary, review.what_worked, review.what_failed,
             review.follow_up, review.status, review.recorded_at::text,
             COALESCE(absorption.absorption_count, 0)::int AS absorption_count
      FROM investment_review review
      LEFT JOIN LATERAL (
        SELECT count(*) AS absorption_count
        FROM review_absorption WHERE review_id = review.id
      ) absorption ON true
      ORDER BY review.as_of DESC, review.recorded_at DESC
      LIMIT ${limit}
    `;
  }
}
