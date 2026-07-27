import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { validateException } from "../domain/playbook";

export class PostgresExceptionRecordRepository {
  constructor(private readonly sql: Sql) {}

  async create(input: {
    eventId: string;
    playbookRevisionId?: string | null;
    uncoveredReason: string;
    logicChange: string;
    action: string;
    decidedAt: string;
    executeAfter: string;
    delayWaiverReason?: string | null;
  }): Promise<string> {
    const exception = validateException(input);
    const id = randomUUID();
    await this.sql`
      INSERT INTO exception_record (
        id, event_id, playbook_revision_id, uncovered_reason, logic_change, action,
        decided_at, execute_after, delay_waiver_reason
      ) VALUES (
        ${id}, ${input.eventId}, ${input.playbookRevisionId ?? null}, ${exception.uncoveredReason},
        ${exception.logicChange}, ${exception.action}, ${exception.decidedAt}, ${exception.executeAfter},
        ${exception.delayWaiverReason ?? null}
      )
    `;
    return id;
  }

  async review(exceptionId: string, status: "absorbed" | "valid_exception"): Promise<void> {
    await this.sql`
      UPDATE exception_record SET review_status = ${status}
      WHERE id = ${exceptionId} AND review_status = 'pending'
    `;
  }
}
