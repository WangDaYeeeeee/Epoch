import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { fetchIbkrFlexReport, type IbkrFlexWebServiceConfig } from "../connectors/ibkr-flex-web-service";
import { parseIbkrFlexStatement } from "../connectors/ibkr-flex";
import { importIbkrFlexStatement } from "./ibkr-flex-import";

export type IbkrFlexSyncResult = {
  status: "succeeded" | "skipped";
  runId?: string;
  referenceCode?: string;
  duplicateStatement?: boolean;
  tradesInserted?: number;
  cashFlowsInserted?: number;
  navSnapshotsInserted?: number;
  positionSnapshotsInserted?: number;
  latestNavDate?: string;
  latestPositionDate?: string;
  reason?: string;
};

export type IbkrFlexFreshnessResult = IbkrFlexSyncResult & {
  latestSuccessfulSyncAt?: string;
};

export function ibkrFlexConfigFromEnvironment(): (IbkrFlexWebServiceConfig & {
  accountId: string;
    requireNav: boolean;
    requirePositions: boolean;
}) | null {
  const token = process.env.IBKR_FLEX_TOKEN?.trim() ?? "";
  const queryId = process.env.IBKR_FLEX_QUERY_ID?.trim() ?? "";
  if (!token && !queryId) return null;
  if (!token) throw new Error("IBKR_FLEX_TOKEN is required when IBKR_FLEX_QUERY_ID is configured");
  if (!queryId) throw new Error("IBKR_FLEX_QUERY_ID is required when IBKR_FLEX_TOKEN is configured");
  return {
    token,
    queryId,
    accountId: process.env.IBKR_FLEX_ACCOUNT_ID?.trim() || "ibkr_8602",
    requireNav: process.env.IBKR_FLEX_REQUIRE_NAV !== "false",
    requirePositions: process.env.IBKR_FLEX_REQUIRE_POSITIONS !== "false",
    baseUrl: process.env.IBKR_FLEX_BASE_URL?.trim() || undefined,
    userAgent: process.env.IBKR_FLEX_USER_AGENT?.trim() || undefined,
    timeoutMs: Number(process.env.IBKR_FLEX_TIMEOUT_MS ?? 30_000),
    pollIntervalMs: Number(process.env.IBKR_FLEX_POLL_INTERVAL_MS ?? 10_000),
    maxPollAttempts: Number(process.env.IBKR_FLEX_MAX_POLL_ATTEMPTS ?? 8),
  };
}

export async function runIbkrFlexSync(
  sql: Sql,
  dependencies: {
    config?: ReturnType<typeof ibkrFlexConfigFromEnvironment>;
    fetchReport?: typeof fetchIbkrFlexReport;
    observedAt?: Date;
  } = {},
): Promise<IbkrFlexSyncResult> {
  const config = dependencies.config === undefined ? ibkrFlexConfigFromEnvironment() : dependencies.config;
  if (!config) return { status: "skipped", reason: "IBKR Flex is not configured" };
  const observedAt = dependencies.observedAt ?? new Date();
  const runId = randomUUID();
  await sql`
    INSERT INTO ibkr_flex_sync_run (id, account_id, query_id, status)
    VALUES (${runId}, ${config.accountId}, ${config.queryId}, 'running')
  `;
  try {
    const report = await (dependencies.fetchReport ?? fetchIbkrFlexReport)(config);
    const fallbackDate = observedAt.toISOString().slice(0, 10);
    const parsed = parseIbkrFlexStatement(report.text, {
      accountId: config.accountId,
      fallbackDate,
      baseCurrency: "USD",
    });
    if (config.requireNav && !parsed.navSnapshots.length) {
      throw new Error(
        "IBKR Flex report has no Net Asset Value rows; configure the Activity Flex Query for CSV output and include Net Asset Value",
      );
    }
    if (config.requirePositions && !parsed.positionSnapshots.length) {
      throw new Error(
        "IBKR Flex report has no Open Positions rows; add Open Positions at Summary level with Account ID, Currency, Asset Class, FX Rate to Base, Symbol, Description, Conid, Report Date, Quantity, Mark Price, Position Value, and Cost Basis Money",
      );
    }
    const imported = await importIbkrFlexStatement(sql, {
      accountId: config.accountId,
      sourceId: `query-${config.queryId}`,
      text: report.text,
      observedAt,
      fallbackDate,
    });
    const latestNavDate = parsed.navSnapshots.map((snapshot) => snapshot.date).sort().at(-1);
    const latestPositionDate = parsed.positionSnapshots.map((snapshot) => snapshot.date).sort().at(-1);
    const result = {
      referenceCode: report.referenceCode,
      duplicateStatement: imported.duplicateStatement,
      tradesInserted: imported.inserted.trades,
      cashFlowsInserted: imported.inserted.cashFlows,
      navSnapshotsInserted: imported.navSnapshotsInserted,
      positionSnapshotsInserted: imported.positionSnapshotsInserted,
      latestNavDate: latestNavDate ?? null,
      latestPositionDate: latestPositionDate ?? null,
    };
    await sql`
      UPDATE ibkr_flex_sync_run
      SET reference_code = ${report.referenceCode}, status = 'succeeded',
          raw_import_id = ${imported.rawImportId}, result = ${sql.json(result)}, finished_at = now()
      WHERE id = ${runId}
    `;
    return {
      status: "succeeded",
      runId,
      referenceCode: report.referenceCode,
      duplicateStatement: imported.duplicateStatement,
      tradesInserted: imported.inserted.trades,
      cashFlowsInserted: imported.inserted.cashFlows,
      navSnapshotsInserted: imported.navSnapshotsInserted,
      positionSnapshotsInserted: imported.positionSnapshotsInserted,
      latestNavDate,
      latestPositionDate,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown IBKR Flex sync error";
    await sql`
      UPDATE ibkr_flex_sync_run
      SET status = 'failed', failure_reason = ${message}, finished_at = now()
      WHERE id = ${runId}
    `;
    throw error;
  }
}

async function deferScheduledFlexSync(sql: Sql): Promise<void> {
  await sql`
    UPDATE scheduled_job
    SET next_run_at = now() + (interval_seconds * interval '1 second'),
        updated_at = now()
    WHERE id = 'ibkr-flex-sync'
  `;
}

export async function ensureIbkrFlexFresh(
  sql: Sql,
  dependencies: {
    config?: ReturnType<typeof ibkrFlexConfigFromEnvironment>;
    fetchReport?: typeof fetchIbkrFlexReport;
    now?: Date;
    maxAgeHours?: number;
  } = {},
): Promise<IbkrFlexFreshnessResult> {
  const config = dependencies.config === undefined ? ibkrFlexConfigFromEnvironment() : dependencies.config;
  if (!config) return { status: "skipped", reason: "IBKR Flex is not configured" };
  const now = dependencies.now ?? new Date();
  const maxAgeHours = dependencies.maxAgeHours
    ?? Number(process.env.IBKR_FLEX_STARTUP_MAX_AGE_HOURS ?? 20);
  if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0) {
    throw new Error("IBKR_FLEX_STARTUP_MAX_AGE_HOURS must be a positive number");
  }
  const [latest] = await sql<{ finished_at: string }[]>`
    SELECT finished_at::text
    FROM ibkr_flex_sync_run
    WHERE account_id = ${config.accountId}
      AND query_id = ${config.queryId}
      AND status = 'succeeded'
      AND finished_at IS NOT NULL
    ORDER BY finished_at DESC
    LIMIT 1
  `;
  const latestSuccessfulSyncAt = latest ? new Date(latest.finished_at).toISOString() : undefined;
  const isFresh = latestSuccessfulSyncAt
    ? now.valueOf() - new Date(latestSuccessfulSyncAt).valueOf() <= maxAgeHours * 60 * 60 * 1_000
    : false;
  if (isFresh) {
    await deferScheduledFlexSync(sql);
    return {
      status: "skipped",
      reason: `latest successful IBKR Flex sync is within ${maxAgeHours} hours`,
      latestSuccessfulSyncAt,
    };
  }
  const result = await runIbkrFlexSync(sql, {
    config,
    fetchReport: dependencies.fetchReport,
    observedAt: now,
  });
  await deferScheduledFlexSync(sql);
  return { ...result, latestSuccessfulSyncAt };
}

export async function loadLatestIbkrFlexSync(sql: Sql, accountId = "ibkr_8602") {
  const [row] = await sql<{
    id: string;
    query_id: string;
    status: "running" | "succeeded" | "failed";
    reference_code: string | null;
    result: Record<string, unknown> | null;
    failure_reason: string | null;
    requested_at: string;
    finished_at: string | null;
  }[]>`
    SELECT id::text, query_id, status, reference_code, result, failure_reason,
           requested_at::text, finished_at::text
    FROM ibkr_flex_sync_run
    WHERE account_id = ${accountId}
    ORDER BY requested_at DESC
    LIMIT 1
  `;
  return row ? {
    id: row.id,
    queryId: row.query_id,
    status: row.status,
    referenceCode: row.reference_code,
    result: row.result,
    failureReason: row.failure_reason,
    requestedAt: new Date(row.requested_at).toISOString(),
    finishedAt: row.finished_at ? new Date(row.finished_at).toISOString() : null,
  } : null;
}
