import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import type { MarketRefreshPreflight } from "./market-refresh";

export type MarketRefreshRun = {
  id: string;
  fingerprint: string;
  preflight: MarketRefreshPreflight;
  status: "running" | "succeeded" | "failed";
  result: Record<string, unknown> | null;
  failureReason: string | null;
  requestedAt: string;
  finishedAt: string | null;
};

type Row = {
  id: string;
  fingerprint: string;
  preflight: MarketRefreshPreflight;
  status: MarketRefreshRun["status"];
  result: Record<string, unknown> | null;
  failure_reason: string | null;
  requested_at: string;
  finished_at: string | null;
};

const toRun = (row: Row): MarketRefreshRun => ({
  id: row.id,
  fingerprint: row.fingerprint,
  preflight: row.preflight,
  status: row.status,
  result: row.result,
  failureReason: row.failure_reason,
  requestedAt: new Date(row.requested_at).toISOString(),
  finishedAt: row.finished_at ? new Date(row.finished_at).toISOString() : null,
});

export class PostgresMarketRefreshRunRepository {
  constructor(private readonly sql: Sql) {}

  async start(preflight: MarketRefreshPreflight): Promise<MarketRefreshRun> {
    const rows = await this.sql<Row[]>`
      INSERT INTO market_refresh_run (id, fingerprint, preflight, status)
      VALUES (
        ${randomUUID()}, ${preflight.fingerprint},
        ${this.sql.json(JSON.parse(JSON.stringify(preflight)))}, 'running'
      )
      RETURNING id::text, fingerprint, preflight, status, result, failure_reason,
                requested_at::text, finished_at::text
    `;
    return toRun(rows[0]);
  }

  async succeed(id: string, result: Record<string, unknown>): Promise<MarketRefreshRun> {
    const rows = await this.sql<Row[]>`
      UPDATE market_refresh_run
      SET status = 'succeeded', result = ${this.sql.json(JSON.parse(JSON.stringify(result)))},
          failure_reason = NULL, finished_at = now()
      WHERE id = ${id} AND status = 'running'
      RETURNING id::text, fingerprint, preflight, status, result, failure_reason,
                requested_at::text, finished_at::text
    `;
    if (!rows[0]) throw new Error(`Market refresh run could not be completed: ${id}`);
    return toRun(rows[0]);
  }

  async fail(id: string, reason: string): Promise<MarketRefreshRun> {
    const rows = await this.sql<Row[]>`
      UPDATE market_refresh_run
      SET status = 'failed', failure_reason = ${reason}, finished_at = now()
      WHERE id = ${id} AND status = 'running'
      RETURNING id::text, fingerprint, preflight, status, result, failure_reason,
                requested_at::text, finished_at::text
    `;
    if (!rows[0]) throw new Error(`Market refresh run could not be failed: ${id}`);
    return toRun(rows[0]);
  }

  async loadLatest(): Promise<MarketRefreshRun | null> {
    const rows = await this.sql<Row[]>`
      SELECT id::text, fingerprint, preflight, status, result, failure_reason,
             requested_at::text, finished_at::text
      FROM market_refresh_run
      ORDER BY requested_at DESC, id DESC
      LIMIT 1
    `;
    return rows[0] ? toRun(rows[0]) : null;
  }
}
