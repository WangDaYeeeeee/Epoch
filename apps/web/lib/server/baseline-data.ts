import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertCurrency, assertIsoDate } from "../domain/conventions";
import { parseCsv } from "./csv";

export const BASELINE_FILES = ["transactions.csv", "positions.csv", "performance.csv"] as const;
type BaselineFile = (typeof BASELINE_FILES)[number];
type Row = Record<string, string>;

type ValidationEntry = {
  selected_rows: number;
  values: Record<string, number>;
  date_min: string;
  date_max: string;
};

type ValidationManifest = {
  scope: { accounts: string[]; portfolio: string };
  normalized: Record<BaselineFile, ValidationEntry>;
};

export type BaselineCheck = {
  name: string;
  status: "passed" | "failed" | "pending";
  detail: string;
};

export type BaselineDataset = {
  root: string;
  manifest: ValidationManifest;
  rows: Record<BaselineFile, Row[]>;
  hashes: Record<BaselineFile, string>;
  checks: BaselineCheck[];
  positionReconciliation: PositionReconciliation;
  healthy: boolean;
  ledgerReconciled: false;
};

export type PositionDifference = {
  accountId: string;
  fromDate: string;
  toDate: string;
  instrumentId: string;
  expectedQuantity: number;
  reportedQuantity: number;
  difference: number;
};

export type PositionReconciliation = {
  intervals: number;
  comparisons: number;
  matched: number;
  timezoneAdjustedTransactions: number;
  differences: PositionDifference[];
};

const REQUIRED_COLUMNS: Record<BaselineFile, string[]> = {
  "transactions.csv": ["transaction_id", "date", "account_id", "instrument_id", "action", "quantity", "price", "currency", "fees", "tax", "cash_amount", "external_flow", "source", "note"],
  "positions.csv": ["date", "account_id", "instrument_id", "ticker", "name", "category", "quantity", "price", "market_value", "currency", "cost_basis", "fx_to_cny", "market_value_cny", "source"],
  "performance.csv": ["date", "portfolio_id", "total_assets", "cash", "net_external_flow", "currency", "nav", "period_return", "benchmark", "benchmark_return", "source"],
};

const NUMERIC_COLUMNS: Record<BaselineFile, string[]> = {
  "transactions.csv": ["quantity", "price", "fees", "tax", "cash_amount"],
  "positions.csv": ["quantity", "price", "market_value", "cost_basis", "fx_to_cny", "market_value_cny"],
  "performance.csv": ["total_assets", "cash", "net_external_flow", "nav", "period_return", "benchmark_return"],
};

function addCheck(checks: BaselineCheck[], name: string, passed: boolean, detail: string): void {
  checks.push({ name, status: passed ? "passed" : "failed", detail });
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function sameValues(left: string[], right: string[]): boolean {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function dateRange(rows: Row[]): [string, string] {
  const dates = rows.map((row) => row.date).sort();
  return [dates[0] ?? "", dates.at(-1) ?? ""];
}

function validateRows(name: BaselineFile, rows: Row[], manifest: ValidationEntry, checks: BaselineCheck[]): void {
  const columns = rows[0] ? Object.keys(rows[0]) : [];
  addCheck(checks, `${name}:schema`, sameValues(columns, REQUIRED_COLUMNS[name]), `required columns: ${REQUIRED_COLUMNS[name].length}`);
  addCheck(checks, `${name}:row-count`, rows.length === manifest.selected_rows, `${rows.length} rows`);
  const [minimum, maximum] = dateRange(rows);
  addCheck(checks, `${name}:date-range`, minimum === manifest.date_min && maximum === manifest.date_max, `${minimum} to ${maximum}`);

  let validDates = true;
  let validCurrencies = true;
  let validNumbers = true;
  for (const row of rows) {
    try { assertIsoDate(row.date); } catch { validDates = false; }
    try { assertCurrency(row.currency); } catch { validCurrencies = false; }
    for (const column of NUMERIC_COLUMNS[name]) {
      if (row[column] !== "" && !Number.isFinite(Number(row[column]))) validNumbers = false;
    }
  }
  if (name === "transactions.csv") {
    const validExternalFlow = rows.every((row) => row.external_flow === "true" || row.external_flow === "false");
    addCheck(checks, `${name}:external-flow-flags`, validExternalFlow, "boolean portfolio-flow classification");
  }
  addCheck(checks, `${name}:dates`, validDates, "ISO calendar dates");
  addCheck(checks, `${name}:currencies`, validCurrencies, unique(rows.map((row) => row.currency)).join(", "));
  addCheck(checks, `${name}:numbers`, validNumbers, "finite numeric values");
}

function validateKeys(rows: Record<BaselineFile, Row[]>, checks: BaselineCheck[]): void {
  const transactionIds = rows["transactions.csv"].map((row) => row.transaction_id);
  addCheck(checks, "transactions.csv:unique-ids", unique(transactionIds).length === transactionIds.length, `${transactionIds.length} transaction ids`);

  const positionKeys = rows["positions.csv"].map((row) => `${row.date}|${row.account_id}|${row.instrument_id}`);
  addCheck(checks, "positions.csv:unique-keys", unique(positionKeys).length === positionKeys.length, `${positionKeys.length} position keys`);

  const performanceKeys = rows["performance.csv"].map((row) => `${row.date}|${row.portfolio_id}`);
  addCheck(checks, "performance.csv:unique-keys", unique(performanceKeys).length === performanceKeys.length, `${performanceKeys.length} performance keys`);
}

function validateScope(dataset: BaselineDataset): void {
  const accounts = unique([
    ...dataset.rows["transactions.csv"].map((row) => row.account_id),
    ...dataset.rows["positions.csv"].map((row) => row.account_id),
  ]);
  addCheck(dataset.checks, "scope:accounts", sameValues(accounts, dataset.manifest.scope.accounts), accounts.join(", "));
  const portfolios = unique(dataset.rows["performance.csv"].map((row) => row.portfolio_id));
  addCheck(dataset.checks, "scope:portfolio", portfolios.length === 1 && portfolios[0] === dataset.manifest.scope.portfolio, portfolios.join(", "));
}

function validatePerformanceChain(dataset: BaselineDataset): void {
  const rows = [...dataset.rows["performance.csv"]].sort((left, right) => left.date.localeCompare(right.date));
  let datesContinuous = true;
  let maxNavLinkError = 0;
  for (let index = 1; index < rows.length; index += 1) {
    const previous = rows[index - 1];
    const current = rows[index];
    const dayDifference = (Date.parse(`${current.date}T00:00:00Z`) - Date.parse(`${previous.date}T00:00:00Z`)) / 86_400_000;
    if (dayDifference !== 1) datesContinuous = false;
    const periodReturn = Number(current.period_return);
    maxNavLinkError = Math.max(maxNavLinkError, Math.abs(Number(current.nav) / Number(previous.nav) - 1 - periodReturn));
  }
  addCheck(dataset.checks, "performance:calendar-continuity", datesContinuous, `${rows.length} consecutive calendar days`);
  addCheck(dataset.checks, "performance:nav-chain", maxNavLinkError <= 1e-8, `maximum link error ${maxNavLinkError.toExponential(2)}`);
  dataset.checks.push({ name: "performance:asset-return-reconciliation", status: "pending", detail: "requires source-specific cash-flow timing conventions" });
  dataset.checks.push({ name: "ledger:full-reconciliation", status: "pending", detail: "requires daily prices, FX, and corporate-action normalization" });
}

export function reconcilePositionQuantities(transactions: Row[], positions: Row[]): PositionReconciliation {
  const accounts = unique(positions.map((row) => row.account_id));
  const result: PositionReconciliation = { intervals: 0, comparisons: 0, matched: 0, timezoneAdjustedTransactions: 0, differences: [] };
  const isSecurity = (row: Row) => row.category !== "cash" && row.category !== "other";
  const reconciliationDate = (row: Row): string => {
    const statementDate = row.source.match(/_statement_(\d{4}-\d{2}-\d{2})\.pdf/)?.[1];
    if (!statementDate || !row.instrument_id.startsWith("US:")) return row.date;
    const difference = (Date.parse(`${row.date}T00:00:00Z`) - Date.parse(`${statementDate}T00:00:00Z`)) / 86_400_000;
    if (difference !== 1) return row.date;
    result.timezoneAdjustedTransactions += 1;
    return statementDate;
  };
  const datedTransactions = transactions.map((row) => ({ row, reconciliationDate: reconciliationDate(row) }));
  for (const accountId of accounts) {
    const dates = unique(positions.filter((row) => row.account_id === accountId).map((row) => row.date));
    for (let index = 1; index < dates.length; index += 1) {
      result.intervals += 1;
      const fromDate = dates[index - 1];
      const toDate = dates[index];
      const expected = new Map(
        positions.filter((row) => row.account_id === accountId && row.date === fromDate && isSecurity(row))
          .map((row) => [row.instrument_id, Number(row.quantity)]),
      );
      for (const item of datedTransactions) {
        const row = item.row;
        if (row.account_id !== accountId || item.reconciliationDate <= fromDate || item.reconciliationDate > toDate || !row.instrument_id) continue;
        if (row.action !== "buy" && row.action !== "sell") continue;
        const direction = row.action === "buy" ? 1 : -1;
        expected.set(row.instrument_id, (expected.get(row.instrument_id) ?? 0) + direction * Number(row.quantity));
      }
      const reported = new Map(
        positions.filter((row) => row.account_id === accountId && row.date === toDate && isSecurity(row))
          .map((row) => [row.instrument_id, Number(row.quantity)]),
      );
      for (const instrumentId of new Set([...expected.keys(), ...reported.keys()])) {
        const expectedQuantity = expected.get(instrumentId) ?? 0;
        const reportedQuantity = reported.get(instrumentId) ?? 0;
        if (Math.abs(expectedQuantity) < 1e-8 && Math.abs(reportedQuantity) < 1e-8) continue;
        result.comparisons += 1;
        const difference = reportedQuantity - expectedQuantity;
        if (Math.abs(difference) < 1e-8) result.matched += 1;
        else result.differences.push({ accountId, fromDate, toDate, instrumentId, expectedQuantity, reportedQuantity, difference });
      }
    }
  }
  return result;
}

export function loadBaselineDataset(root: string): BaselineDataset {
  const manifest = JSON.parse(readFileSync(resolve(root, "validation.json"), "utf8")) as ValidationManifest;
  const rows = {} as Record<BaselineFile, Row[]>;
  const hashes = {} as Record<BaselineFile, string>;
  const checks: BaselineCheck[] = [];
  for (const name of BASELINE_FILES) {
    const content = readFileSync(resolve(root, "normalized", name), "utf8");
    rows[name] = parseCsv(content);
    hashes[name] = createHash("sha256").update(content).digest("hex");
    validateRows(name, rows[name], manifest.normalized[name], checks);
  }
  const positionReconciliation = reconcilePositionQuantities(rows["transactions.csv"], rows["positions.csv"]);
  const dataset: BaselineDataset = { root, manifest, rows, hashes, checks, positionReconciliation, healthy: false, ledgerReconciled: false };
  validateKeys(rows, checks);
  validateScope(dataset);
  validatePerformanceChain(dataset);
  dataset.checks.push({
    name: "ledger:position-quantity-reconciliation",
    status: positionReconciliation.differences.length ? "pending" : "passed",
    detail: `${positionReconciliation.matched}/${positionReconciliation.comparisons} quantities matched after ${positionReconciliation.timezoneAdjustedTransactions} timezone-boundary alignments; ${positionReconciliation.differences.length} differences require classification`,
  });
  dataset.healthy = checks.every((check) => check.status !== "failed");
  return dataset;
}
