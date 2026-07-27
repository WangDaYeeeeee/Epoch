import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import {
  exitRestriction, validateCatalyst, validateInvalidationCondition,
  type CatalystInput, type ExitType, type InvalidationConditionInput,
} from "../domain/position-governance";

export class PostgresPositionGovernanceRepository {
  constructor(private readonly sql: Sql) {}

  async saveCatalyst(candidateId: string, input: CatalystInput): Promise<string> {
    const catalyst = validateCatalyst(input);
    const id = randomUUID();
    await this.sql`
      INSERT INTO candidate_catalyst (
        id, candidate_id, title, expected_date, valid_through, status, observable_outcome
      ) VALUES (
        ${id}, ${candidateId}, ${catalyst.title}, ${catalyst.expectedDate}, ${catalyst.validThrough},
        ${catalyst.status}, ${catalyst.observableOutcome}
      )
    `;
    return id;
  }

  async saveInvalidation(candidateId: string, input: InvalidationConditionInput): Promise<string> {
    const condition = validateInvalidationCondition(input);
    const id = randomUUID();
    await this.sql`
      INSERT INTO invalidation_condition (
        id, candidate_id, statement, observable_metric, trigger
      ) VALUES (
        ${id}, ${candidateId}, ${condition.statement}, ${condition.observableMetric}, ${condition.trigger}
      )
    `;
    return id;
  }

  async recordExit(input: {
    candidateId: string;
    exitType: ExitType;
    exitDate: string;
    executionRecordId?: string | null;
  }): Promise<string | null> {
    const restriction = exitRestriction(input);
    if (!restriction.restricted || !restriction.restrictedUntil) return null;
    const id = randomUUID();
    await this.sql`
      INSERT INTO exit_restriction (
        id, candidate_id, exit_type, exit_date, restricted_until, execution_record_id
      ) VALUES (
        ${id}, ${input.candidateId}, 'active_exit', ${input.exitDate}, ${restriction.restrictedUntil},
        ${input.executionRecordId ?? null}
      )
    `;
    return id;
  }

  async load(candidateId: string, asOf: string) {
    const [catalysts, invalidations, restrictions] = await Promise.all([
      this.sql`
        SELECT id::text, title, expected_date::text, valid_through::text, status, observable_outcome
        FROM candidate_catalyst WHERE candidate_id = ${candidateId}
        ORDER BY expected_date DESC, recorded_at DESC
      `,
      this.sql`
        SELECT id::text, statement, observable_metric, trigger, status
        FROM invalidation_condition WHERE candidate_id = ${candidateId}
        ORDER BY recorded_at DESC
      `,
      this.sql`
        SELECT id::text, exit_date::text, restricted_until::text
        FROM exit_restriction
        WHERE candidate_id = ${candidateId} AND restricted_until >= ${asOf}
        ORDER BY restricted_until DESC
      `,
    ]);
    return { catalysts, invalidations, restrictions };
  }
}
