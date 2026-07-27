import { randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { createDatabaseClient, migrateDatabase } from "./database";
import { PostgresFundHoldingsRepository } from "./fund-holdings-sync";
import { importIbkrFlexStatement } from "./ibkr-flex-import";
import { runDueJobs } from "./scheduler";
import { createCalculationRequest, PostgresCalculationRunRepository } from "./calculation-run";
import { PostgresRiskDriftAnchorRepository } from "./risk-drift-anchor";
import { persistMarketDataFreshness } from "./market-data-monitor";
import { PostgresMarketRefreshRunRepository } from "./market-refresh-run";

const databaseDescribe = process.env.DATABASE_INTEGRATION === "1" ? describe : describe.skip;

databaseDescribe("Phase 0 PostgreSQL integration", () => {
  let sql: Sql;

  beforeAll(async () => {
    sql = createDatabaseClient();
    await migrateDatabase(sql);
  });

  afterAll(async () => {
    await sql.end();
  });

  it("applies migrations idempotently and seeds immutable configuration", async () => {
    expect(await migrateDatabase(sql)).toEqual([]);
    const [migration] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM schema_migration`;
    const [strategy] = await sql<{ trading_accounts: number }[]>`SELECT count(*)::int AS trading_accounts FROM account WHERE is_read_only = true`;
    const [parameter] = await sql<{ calibration_required: boolean }[]>`
      SELECT (parameters->>'calibration_required')::boolean AS calibration_required
      FROM parameter_set WHERE id = 'default-draft-v0.1.0'
    `;
    const migrationCount = readdirSync(join(process.cwd(), "../../migrations"))
      .filter((name) => /^\d{4}_.+\.sql$/.test(name)).length;
    expect(migration.count).toBe(migrationCount);
    expect(strategy.trading_accounts).toBe(3);
    expect(parameter.calibration_required).toBe(true);
  });

  it("claims and records a due deterministic calculation job", async () => {
    await sql`UPDATE scheduled_job SET next_run_at = now() WHERE id = 'demo-ledger-recalculation'`;
    expect(await runDueJobs(sql)).toEqual([{ id: "demo-ledger-recalculation", status: "succeeded" }]);
    const [run] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM calculation_run
      WHERE calculation_type = 'demo-ledger' AND status = 'succeeded'
    `;
    const [job] = await sql<{ last_status: string }[]>`SELECT last_status FROM scheduled_job WHERE id = 'demo-ledger-recalculation'`;
    expect(run.count).toBe(1);
    expect(job.last_status).toBe("succeeded");
  });

  it("opens, accumulates, and resolves scheduled job failure alerts", async () => {
    const jobId = `integration-failing-job-${randomUUID()}`;
    try {
      await sql`
        INSERT INTO scheduled_job (id, handler, interval_seconds, next_run_at)
        VALUES (${jobId}, 'missing-integration-handler', 3600, now())
      `;
      expect(await runDueJobs(sql)).toContainEqual({ id: jobId, status: "failed" });
      await sql`UPDATE scheduled_job SET next_run_at = now() WHERE id = ${jobId}`;
      expect(await runDueJobs(sql)).toContainEqual({ id: jobId, status: "failed" });
      const [alert] = await sql<{ status: string; occurrence_count: number }[]>`
        SELECT status, occurrence_count
        FROM operational_alert
        WHERE source = ${`scheduled_job:${jobId}`} AND fingerprint = 'execution-failure'
      `;
      expect(alert).toEqual({ status: "open", occurrence_count: 2 });

      await sql`UPDATE scheduled_job SET handler = 'demo-ledger-recalculation', next_run_at = now() WHERE id = ${jobId}`;
      expect(await runDueJobs(sql)).toContainEqual({ id: jobId, status: "succeeded" });
      const [resolved] = await sql<{ status: string; resolved: boolean }[]>`
        SELECT status, resolved_at IS NOT NULL AS resolved
        FROM operational_alert
        WHERE source = ${`scheduled_job:${jobId}`} AND fingerprint = 'execution-failure'
      `;
      expect(resolved).toEqual({ status: "resolved", resolved: true });
    } finally {
      await sql`DELETE FROM operational_alert WHERE source = ${`scheduled_job:${jobId}`}`;
      await sql`DELETE FROM scheduled_job WHERE id = ${jobId}`;
    }
  });

  it("opens and resolves the independent market-data freshness warning", async () => {
    try {
      await persistMarketDataFreshness(sql, {
        status: "stale",
        latestEffectiveDate: "2026-07-16",
        expectedThroughDate: "2026-07-24",
        tradingDayLag: 6,
        observedAt: "2026-07-17T00:00:00Z",
        observationTimestampQuality: "authoritative",
        reason: "integration fixture is stale",
      });
      const [open] = await sql<{ status: string; severity: string; detail: string }[]>`
        SELECT status, severity, detail FROM operational_alert
        WHERE source = 'market_data:normalized' AND fingerprint = 'freshness'
      `;
      expect(open).toMatchObject({ status: "open", severity: "warning" });
      expect(open.detail).toContain("tradingDayLag=6");

      await persistMarketDataFreshness(sql, {
        status: "fresh",
        latestEffectiveDate: "2026-07-24",
        expectedThroughDate: "2026-07-24",
        tradingDayLag: 0,
        observedAt: "2026-07-25T00:00:00Z",
        observationTimestampQuality: "authoritative",
        reason: "integration fixture is fresh",
      });
      const [resolved] = await sql<{ status: string; resolved: boolean }[]>`
        SELECT status, resolved_at IS NOT NULL AS resolved FROM operational_alert
        WHERE source = 'market_data:normalized' AND fingerprint = 'freshness'
      `;
      expect(resolved).toEqual({ status: "resolved", resolved: true });
    } finally {
      await sql`
        DELETE FROM operational_alert
        WHERE source = 'market_data:normalized' AND fingerprint = 'freshness'
      `;
    }
  });

  it("records the immutable preflight and completion of a market refresh run", async () => {
    const repository = new PostgresMarketRefreshRunRepository(sql);
    const preflight = {
      fingerprint: randomUUID().replaceAll("-", ""),
      dateFrom: "2026-07-16",
      dateToExclusive: "2026-07-28",
      targets: [{ instrumentId: "US:GOOGL", provider: "fixture", providerSymbol: "GOOGL" }],
      disclosures: ["integration fixture"],
    };
    const started = await repository.start(preflight);
    try {
      expect(started).toMatchObject({ fingerprint: preflight.fingerprint, preflight, status: "running" });
      const completed = await repository.succeed(started.id, { observations: 7 });
      expect(completed).toMatchObject({
        id: started.id,
        status: "succeeded",
        result: { observations: 7 },
        failureReason: null,
      });
      expect(completed.finishedAt).not.toBeNull();
      await expect(repository.loadLatest()).resolves.toMatchObject({ id: started.id });
    } finally {
      await sql`DELETE FROM market_refresh_run WHERE id = ${started.id}`;
    }
  });

  it("retains a Flex statement and imports overlapping facts idempotently", async () => {
    const uniqueId = randomUUID();
    const rawRoot = mkdtempSync(join(tmpdir(), "epoch-flex-"));
    const statement = `Trades,Header,Currency,Symbol,Description,Conid,ListingExchange,TradeID,TradeDate,Quantity,TradePrice,IBCommission,Buy/Sell
Trades,Data,USD,NVDA,NVIDIA CORP,${uniqueId},NASDAQ,trade-${uniqueId},20260720,1,172.25,-1.00,BUY
Cash Transactions,Header,Currency,TransactionID,DateTime,Type,Description,Amount
Cash Transactions,Data,USD,cash-${uniqueId},20260719,Deposits/Withdrawals,Deposit,1000.00
`;
    try {
      const first = await importIbkrFlexStatement(sql, { accountId: "ibkr_8602", sourceId: uniqueId, text: statement, rawRoot });
      const second = await importIbkrFlexStatement(sql, { accountId: "ibkr_8602", sourceId: uniqueId, text: statement, rawRoot });
      expect(first.duplicateStatement).toBe(false);
      expect(first.inserted).toEqual({ instruments: 1, trades: 1, cashFlows: 1 });
      expect(second).toMatchObject({ rawImportId: first.rawImportId, duplicateStatement: true });
      expect(second.inserted).toEqual({ instruments: 0, trades: 0, cashFlows: 0 });
    } finally {
      rmSync(rawRoot, { recursive: true, force: true });
    }
  });

  it("stores fund holdings snapshots idempotently with their constituents", async () => {
    const repository = new PostgresFundHoldingsRepository(sql);
    const sourceHash = randomUUID().replaceAll("-", "");
    const snapshot = {
      fundInstrumentId: "US:INTEGRATION-ETF",
      asOf: "2026-07-17",
      observedAt: "2026-07-18T00:00:00Z",
      provider: "integration_fixture",
      sourceHash,
      holdings: [
        { constituentInstrumentId: "US:NVDA", name: "NVIDIA Corporation", weight: 0.6, shares: 10, marketValue: 100 },
        { constituentInstrumentId: "US:AVGO", name: "Broadcom Inc.", weight: 0.4 },
      ],
    };
    await repository.save(snapshot);
    await repository.save(snapshot);
    const loaded = await repository.load([snapshot.fundInstrumentId]);
    const matching = loaded.filter((candidate) => candidate.sourceHash === sourceHash);
    expect(matching).toHaveLength(1);
    expect(matching[0]).toMatchObject({
      fundInstrumentId: snapshot.fundInstrumentId,
      asOf: snapshot.asOf,
      observedAt: new Date(snapshot.observedAt).toISOString(),
      provider: snapshot.provider,
      sourceHash,
    });
    expect(matching[0].holdings).toEqual(expect.arrayContaining(snapshot.holdings.map((holding) => expect.objectContaining(holding))));
  });

  it("stores an immutable calculation input and creates its explicit drift anchor idempotently", async () => {
    const repository = new PostgresCalculationRunRepository(sql);
    await sql`
      DELETE FROM risk_drift_anchor_instrument
      WHERE anchor_id IN (
        SELECT anchor.id
        FROM risk_drift_anchor AS anchor
        JOIN calculation_run AS run ON run.id = anchor.calculation_run_id
        WHERE run.calculation_type = 'portfolio-risk-rebalance' AND run.engine_version = 'integration'
      )
    `;
    await sql`
      DELETE FROM risk_drift_anchor
      WHERE calculation_run_id IN (
        SELECT id FROM calculation_run
        WHERE calculation_type = 'portfolio-risk-rebalance' AND engine_version = 'integration'
      )
    `;
    await sql`
      DELETE FROM calculation_run
      WHERE calculation_type = 'portfolio-risk-rebalance' AND engine_version = 'integration'
    `;
    const request = createCalculationRequest({
      calculationType: "portfolio-risk-rebalance",
      asOf: "2026-07-27T00:00:00Z",
      codeVersion: randomUUID(),
      strategyVersion: "epoch-satellite-v0.1.0",
      parameterSetVersion: "default-draft-v0.1.0",
      payload: { schemaVersion: "portfolio-risk-input/1.0", marker: randomUUID() },
    });
    let calculationId: string | undefined;
    try {
      const first = await repository.claim(request);
      calculationId = first.record.id;
      const second = await repository.claim({ ...request, calculationId: randomUUID() });
      expect(first.claimed).toBe(true);
      expect(second).toMatchObject({ claimed: false, record: { id: first.record.id, input: request.payload } });

      const completed = await repository.complete(first.record.id, {
        contractVersion: "1.0",
        calculationId: first.record.id,
        calculationType: request.calculationType,
        asOf: request.asOf,
        inputHash: request.inputHash,
        engineVersion: "integration",
        modelVersion: "integration",
        status: "degraded",
        output: {
          portfolio: { volatilityAnnualized: 0.3 },
          instruments: [{ instrumentId: "US:NVDA", weight: 1, volatilityAnnualized: 0.4, riskContribution: 0.3 }],
        },
        diagnostics: { fixture: true },
        warnings: ["integration fixture"],
        durationMs: 1,
      });
      expect(completed).toMatchObject({
        status: "degraded",
        input: request.payload,
        response: {
          calculationId: first.record.id,
          inputHash: request.inputHash,
          output: { portfolio: { volatilityAnnualized: 0.3 } },
        },
      });
      await expect(repository.complete(first.record.id, completed.response!)).resolves.toEqual(completed);
      await expect(repository.loadCompletedHistory(request.calculationType, 1)).resolves.toEqual([completed]);

      const anchors = new PostgresRiskDriftAnchorRepository(sql);
      const firstAnchor = await anchors.create(completed, "integration fixture");
      const secondAnchor = await anchors.create(completed, "ignored duplicate note");
      expect(secondAnchor).toEqual(firstAnchor);
      expect(firstAnchor).toMatchObject({
        calculationRunId: completed.id,
        portfolioVolatilityAnnualized: 0.3,
        instruments: [{ instrumentId: "US:NVDA", weight: 1, volatilityAnnualized: 0.4, riskContribution: 0.3 }],
      });
      await expect(anchors.loadByRun(completed.id)).resolves.toEqual(firstAnchor);
    } finally {
      if (calculationId) {
        await sql`
          DELETE FROM risk_drift_anchor_instrument
          WHERE anchor_id IN (
            SELECT id FROM risk_drift_anchor WHERE calculation_run_id = ${calculationId}
          )
        `;
        await sql`DELETE FROM risk_drift_anchor WHERE calculation_run_id = ${calculationId}`;
        await sql`DELETE FROM calculation_run WHERE id = ${calculationId}`;
      }
    }
  });
});
