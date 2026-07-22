import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { resolve } from "node:path";
import type { Sql, TransactionSql } from "postgres";
import { BASELINE_FILES, loadBaselineDataset, type BaselineDataset } from "./baseline-data";

export type BaselineImportResult = {
  healthy: boolean;
  ledgerReconciled: false;
  imports: Record<string, { rawImportId: string; duplicate: boolean; rows: number }>;
};

function optionalNumber(value: string): string | null {
  return value === "" ? null : value;
}

async function registerFile(sql: Sql | TransactionSql, dataset: BaselineDataset, name: (typeof BASELINE_FILES)[number]): Promise<{ id: string; duplicate: boolean }> {
  const objectPath = resolve(dataset.root, "normalized", name);
  const sourceId = `normalized/${name}`;
  const candidateId = randomUUID();
  const inserted = await sql<{ id: string }[]>`
    INSERT INTO raw_import (id, source, source_id, content_hash, observed_at, object_path)
    VALUES (${candidateId}, 'normalized_satellite_baseline', ${sourceId}, ${dataset.hashes[name]}, ${statSync(objectPath).mtime}, ${objectPath})
    ON CONFLICT (source, source_id, content_hash) DO NOTHING
    RETURNING id
  `;
  if (inserted[0]) return { id: inserted[0].id, duplicate: false };
  const [existing] = await sql<{ id: string }[]>`
    SELECT id FROM raw_import
    WHERE source = 'normalized_satellite_baseline' AND source_id = ${sourceId} AND content_hash = ${dataset.hashes[name]}
  `;
  if (!existing) throw new Error(`Unable to resolve baseline import: ${name}`);
  return { id: existing.id, duplicate: true };
}

export async function importBaselineDataset(sql: Sql, root: string): Promise<BaselineImportResult> {
  const dataset = loadBaselineDataset(root);
  if (!dataset.healthy) {
    const failures = dataset.checks.filter((check) => check.status === "failed").map((check) => check.name);
    throw new Error(`Baseline validation failed: ${failures.join(", ")}`);
  }

  return sql.begin(async (transaction) => {
    const imports: BaselineImportResult["imports"] = {};

    const transactionFile = await registerFile(transaction, dataset, "transactions.csv");
    if (!transactionFile.duplicate) {
      for (const row of dataset.rows["transactions.csv"]) {
        await transaction`
          INSERT INTO normalized_ledger_event (
            raw_import_id, transaction_id, effective_date, account_id, instrument_id, action,
            quantity, price, currency, fees, tax, cash_amount, external_flow, source, note
          ) VALUES (
            ${transactionFile.id}, ${row.transaction_id}, ${row.date}, ${row.account_id}, ${row.instrument_id || null}, ${row.action},
            ${optionalNumber(row.quantity)}, ${optionalNumber(row.price)}, ${row.currency}, ${optionalNumber(row.fees)},
            ${optionalNumber(row.tax)}, ${optionalNumber(row.cash_amount)}, ${row.external_flow === "true"}, ${row.source}, ${row.note || null}
          )
        `;
      }
    }
    imports["transactions.csv"] = { rawImportId: transactionFile.id, duplicate: transactionFile.duplicate, rows: transactionFile.duplicate ? 0 : dataset.rows["transactions.csv"].length };

    const positionFile = await registerFile(transaction, dataset, "positions.csv");
    if (!positionFile.duplicate) {
      for (const row of dataset.rows["positions.csv"]) {
        await transaction`
          INSERT INTO reported_position_snapshot (
            raw_import_id, snapshot_date, account_id, instrument_id, ticker, name, category,
            quantity, price, market_value, currency, cost_basis, fx_to_cny, market_value_cny, source
          ) VALUES (
            ${positionFile.id}, ${row.date}, ${row.account_id}, ${row.instrument_id}, ${row.ticker}, ${row.name}, ${row.category},
            ${row.quantity}, ${row.price}, ${row.market_value}, ${row.currency}, ${optionalNumber(row.cost_basis)},
            ${optionalNumber(row.fx_to_cny)}, ${optionalNumber(row.market_value_cny)}, ${row.source}
          )
        `;
      }
    }
    imports["positions.csv"] = { rawImportId: positionFile.id, duplicate: positionFile.duplicate, rows: positionFile.duplicate ? 0 : dataset.rows["positions.csv"].length };

    const performanceFile = await registerFile(transaction, dataset, "performance.csv");
    if (!performanceFile.duplicate) {
      for (const row of dataset.rows["performance.csv"]) {
        await transaction`
          INSERT INTO reported_performance_snapshot (
            raw_import_id, snapshot_date, portfolio_id, total_assets, cash, net_external_flow,
            currency, nav, period_return, benchmark, benchmark_return, source
          ) VALUES (
            ${performanceFile.id}, ${row.date}, ${row.portfolio_id}, ${row.total_assets}, ${optionalNumber(row.cash)}, ${row.net_external_flow},
            ${row.currency}, ${row.nav}, ${optionalNumber(row.period_return)}, ${row.benchmark},
            ${optionalNumber(row.benchmark_return)}, ${row.source}
          )
        `;
      }
    }
    imports["performance.csv"] = { rawImportId: performanceFile.id, duplicate: performanceFile.duplicate, rows: performanceFile.duplicate ? 0 : dataset.rows["performance.csv"].length };

    return { healthy: dataset.healthy, ledgerReconciled: false, imports };
  });
}
