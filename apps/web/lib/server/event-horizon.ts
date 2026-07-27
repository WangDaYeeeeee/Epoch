import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import {
  buildEventHorizon,
  INVESTMENT_EVENT_TYPES,
  type EventHorizonSnapshot,
  type InvestmentEvent,
  type InvestmentEventType,
} from "../domain/event-horizon";
import { validatePlaybook, type PlaybookBranchInput } from "../domain/playbook";

type EventRow = {
  id: string;
  title: string;
  instrument_id: string | null;
  event_type: InvestmentEventType;
  scheduled_date: string;
  source: string;
  playbook_status: "draft" | "ready" | null;
  playbook_summary: string | null;
};

const toEvent = (row: EventRow): InvestmentEvent => ({
  id: row.id,
  title: row.title,
  instrumentId: row.instrument_id,
  eventType: row.event_type,
  scheduledDate: row.scheduled_date,
  source: row.source,
  playbookStatus: row.playbook_status ?? "missing",
  playbookSummary: row.playbook_summary,
});

export class PostgresEventHorizonRepository {
  constructor(private readonly sql: Sql) {}

  async load(asOf: string): Promise<EventHorizonSnapshot> {
    const rows = await this.sql<EventRow[]>`
      SELECT event.id::text, event.title, event.instrument_id, event.event_type,
             event.scheduled_date::text, event.source,
             playbook.status AS playbook_status, playbook.summary AS playbook_summary
      FROM investment_event event
      LEFT JOIN event_playbook playbook ON playbook.event_id = event.id
      WHERE event.status = 'scheduled'
        AND event.scheduled_date >= ${asOf}::date - interval '30 days'
      ORDER BY event.scheduled_date, event.id
    `;
    return buildEventHorizon(rows.map(toEvent), asOf);
  }

  async create(input: {
    title: string;
    instrumentId?: string | null;
    eventType: InvestmentEventType;
    scheduledDate: string;
    source?: string;
    observedAt?: string;
  }): Promise<string> {
    if (!input.title.trim() || input.title.length > 200) throw new Error("Event title must contain 1-200 characters");
    if (!INVESTMENT_EVENT_TYPES.includes(input.eventType)) throw new Error("Unsupported event type");
    const id = randomUUID();
    await this.sql`
      INSERT INTO investment_event (
        id, title, instrument_id, event_type, scheduled_date, source, observed_at
      ) VALUES (
        ${id}, ${input.title.trim()}, ${input.instrumentId?.trim() || null}, ${input.eventType},
        ${input.scheduledDate}, ${input.source?.trim() || "manual"}, ${input.observedAt ?? new Date().toISOString()}
      )
    `;
    return id;
  }

  async savePlaybook(input: {
    eventId: string;
    status: "draft" | "ready";
    summary: string;
    asOf: string;
    branches: PlaybookBranchInput[];
  }): Promise<string> {
    const events = await this.sql<{ event_type: string }[]>`
      SELECT event_type FROM investment_event WHERE id = ${input.eventId}
    `;
    if (!events[0]) throw new Error("Investment event not found");
    const playbook = validatePlaybook({ ...input, eventType: events[0].event_type });
    const revisionId = randomUUID();
    await this.sql.begin(async (transaction) => {
      const rows = await transaction<{ id: string }[]>`
        INSERT INTO event_playbook (id, event_id, status, summary, as_of)
        VALUES (${randomUUID()}, ${input.eventId}, ${playbook.status}, ${playbook.summary}, ${playbook.asOf})
        ON CONFLICT (event_id) DO UPDATE
        SET status = EXCLUDED.status, summary = EXCLUDED.summary, as_of = EXCLUDED.as_of, updated_at = now()
        RETURNING id::text
      `;
      await transaction`
        INSERT INTO playbook_revision (id, playbook_id, status, summary, as_of)
        VALUES (${revisionId}, ${rows[0].id}, ${playbook.status}, ${playbook.summary}, ${playbook.asOf})
      `;
      for (const branch of playbook.branches) {
        await transaction`
          INSERT INTO playbook_branch (
            id, revision_id, scope, scenario, trigger, action, risk_direction
          ) VALUES (
            ${randomUUID()}, ${revisionId}, ${branch.scope}, ${branch.scenario},
            ${branch.trigger}, ${branch.action}, ${branch.riskDirection}
          )
        `;
      }
    });
    return revisionId;
  }
}
