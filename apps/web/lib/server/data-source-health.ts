import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Sql } from "postgres";
import { parseCsv } from "./csv";
import { resolveDataRoot } from "./portfolio";

export class PostgresDataSourceHealthRepository {
  constructor(private readonly sql: Sql) {}

  async observe(input: {
    sourceId: string;
    status: "success" | "degraded" | "failure";
    effectiveAt?: string | null;
    observedAt?: string;
    detail: string;
  }): Promise<string> {
    const detail = input.detail.trim();
    if (!detail) throw new Error("Data source observation detail is required");
    const id = randomUUID();
    const rows = await this.sql<{ id: string }[]>`
      INSERT INTO data_source_observation (
        id, source_id, status, effective_at, observed_at, detail
      ) SELECT
        ${id}, definition.id, ${input.status}, ${input.effectiveAt ?? null},
        ${input.observedAt ?? new Date().toISOString()}, ${detail}
      FROM data_source_definition definition WHERE definition.id = ${input.sourceId}
      RETURNING id::text
    `;
    if (!rows[0]) throw new Error("Unknown data source");
    return rows[0].id;
  }

  async activate(input: {
    sourceId: string;
    provider: string;
    maximumAgeHours: number;
    note: string;
  }): Promise<void> {
    if (!input.provider.trim() || !input.note.trim() || !Number.isInteger(input.maximumAgeHours) || input.maximumAgeHours <= 0) {
      throw new Error("Active data source configuration is invalid");
    }
    const rows = await this.sql`
      UPDATE data_source_definition
      SET provider = ${input.provider}, status = 'active',
          maximum_age_hours = ${input.maximumAgeHours}, note = ${input.note}
      WHERE id = ${input.sourceId}
      RETURNING id
    `;
    if (!rows[0]) throw new Error("Unknown data source");
  }

  async collectLocal(): Promise<number> {
    let observations = 0;
    const root = resolveDataRoot();
    if (root) {
      const bars = parseCsv(readFileSync(resolve(root, "normalized/market-bars.csv"), "utf8"));
      const latest = bars.map((row) => row.date).sort().at(-1);
      const observedAt = bars.map((row) => row.observed_at).filter(Boolean).sort().at(-1);
      if (latest) {
        await this.observe({
          sourceId: "daily-market-bars",
          status: "success",
          effectiveAt: `${latest}T23:59:59Z`,
          observedAt,
          detail: `${bars.length} normalized observations through ${latest}`,
        });
        observations += 1;
      }
    }
    const snapshots = await this.sql<{ as_of: string; observed_at: string; providers: string; snapshots: number }[]>`
      SELECT max(as_of)::text AS as_of, max(observed_at)::text AS observed_at,
             string_agg(DISTINCT provider, ', ' ORDER BY provider) AS providers,
             count(*)::int AS snapshots
      FROM fund_holdings_snapshot
    `;
    if (snapshots[0]?.as_of) {
      await this.observe({
        sourceId: "fund-holdings",
        status: "success",
        effectiveAt: `${snapshots[0].as_of}T23:59:59Z`,
        observedAt: new Date(snapshots[0].observed_at).toISOString(),
        detail: `${snapshots[0].snapshots} snapshots from ${snapshots[0].providers}`,
      });
      observations += 1;
    }
    return observations;
  }

  async load() {
    return this.sql`
      SELECT definition.id, definition.capability, definition.provider,
             definition.status AS configured_status, definition.required,
             definition.maximum_age_hours, definition.fallback_source_id,
             definition.note, observation.status AS observation_status,
             observation.effective_at::text, observation.observed_at::text,
             observation.detail,
             CASE
               WHEN definition.status <> 'active' THEN definition.status
               WHEN observation.id IS NULL THEN 'missing'
               WHEN observation.status = 'failure' THEN 'failure'
               WHEN definition.maximum_age_hours IS NOT NULL
                 AND observation.effective_at < now() - (definition.maximum_age_hours * interval '1 hour')
                 THEN 'stale'
               ELSE observation.status
             END AS health_status
      FROM data_source_definition definition
      LEFT JOIN LATERAL (
        SELECT * FROM data_source_observation
        WHERE source_id = definition.id
        ORDER BY observed_at DESC, recorded_at DESC LIMIT 1
      ) observation ON true
      ORDER BY definition.required DESC, definition.id
    `;
  }
}
