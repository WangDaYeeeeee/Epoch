import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { createDatabaseClient, migrateDatabase } from "./database";
import { importIbkrFlexStatement } from "./ibkr-flex-import";
import { runDueJobs } from "./scheduler";

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
    expect(migration.count).toBe(4);
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
});
