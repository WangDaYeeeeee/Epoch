import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { isTradingDay, NDX_CALENDAR, previousTradingDay } from "../domain/calendar";
import { assertCurrency, assertIsoDate, EPOCH_CONVENTIONS } from "../domain/conventions";
import { auditDailyMarketBars, CASH_EQUIVALENT_INSTRUMENTS, currentPositionMarketDataRequirement, evaluateMarketDataFreshness, isDerivativeInstrumentId, marketDataRequirement, type MarketBarCoverage, type MarketDataFreshness, type MarketDataRequirement } from "../domain/market-data";
import { ledgerReplayReadiness, reconcileCashEndpoints, replayLedgerDaily, type CashEndpointReconciliation, type LedgerReplayReadiness } from "../domain/ledger-replay";
import { valueDailyLedger } from "../domain/ledger-valuation";
import { attributePortfolioReturns, type ReturnAttribution } from "../domain/return-attribution";
import { parseCsv } from "./csv";

export const BASELINE_FILES = ["transactions.csv", "positions.csv", "performance.csv"] as const;
type BaselineFile = (typeof BASELINE_FILES)[number];
type Row = Record<string, string>;
export type PerformanceReconciliation = { datesContinuous: boolean; maxNavLinkError: number; flowWeightsComplete: boolean; maxAssetReturnError: number; assetReturnsReconciled: boolean };
export type EventCoverage = { total: number; classified: number; trades: number; cashEvents: number; dividends: number; taxes: number; fxLegs: number; transfers: number; adjustments: number };
export type ValuationCoverage = { total: number; withFx: number; fxReconciled: number; missingFx: number; maxBaseValueError: number };
export type MarketDataCoverage = {
  requiredSecurities: number; coveredSecurities: number; missingInstrumentIds: string[];
  requiredFxPairs: number; coveredFxPairs: number; priceObservations: number; splitEvents: number;
};
export type DailyLedgerReplaySummary = {
  days: number; transactionEventsApplied: number; splitEventsApplied: number;
  terminalCashAccounts: number; terminalPositionAccounts: number;
  terminalTransit: Record<string, number>;
};
export type DailyLedgerValuationSummary = {
  totalDays: number; valuedDays: number; accountedDays: number; residualBridgeDays: number; missingPriceDays: number;
  maxAbsoluteResidualBridgeUsd: number;
  maxAbsoluteDifferenceUsd: number; maxAbsoluteRelativeDifference: number; terminalDifferenceUsd: number | null;
  missingInstrumentIds: string[];
};
const ALLOWED_ACTIONS = new Set(["buy", "sell", "deposit", "withdrawal", "dividend", "fee", "interest", "tax", "transfer_in", "transfer_out", "fx_buy", "fx_sell", "adjustment_in", "adjustment_out", "other"]);
const DAILY_VALUATION_SOURCE_BASIS_TOLERANCE = 0.0075;

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
  valuationCoverage: ValuationCoverage;
  marketDataRequirement: MarketDataRequirement;
  marketDataCoverage: MarketDataCoverage;
  marketDataFreshness: MarketDataFreshness;
  marketBarCoverage: MarketBarCoverage;
  ledgerReplayReadiness: LedgerReplayReadiness;
  cashEndpointReconciliation: CashEndpointReconciliation;
  dailyLedgerReplay: DailyLedgerReplaySummary;
  dailyLedgerValuation: DailyLedgerValuationSummary;
  returnAttribution: ReturnAttribution;
  healthy: boolean;
  ledgerReconciled: boolean;
};

export function reconcileReportedValuations(rows: Row[]): ValuationCoverage {
  let withFx = 0;
  let fxReconciled = 0;
  let maxBaseValueError = 0;
  for (const row of rows) {
    if (row.fx_to_base === "" || row.market_value_base === "" || row.base_currency === "") continue;
    withFx += 1;
    const error = Math.abs(Number(row.market_value_base) - Number(row.market_value) * Number(row.fx_to_base));
    maxBaseValueError = Math.max(maxBaseValueError, error);
    if (error <= (row.base_currency === "CNY" ? 0.01 : 0.0001)) fxReconciled += 1;
  }
  return { total: rows.length, withFx, fxReconciled, missingFx: rows.length - withFx, maxBaseValueError };
}

export function loadMarketDataCoverage(root: string, requirement: MarketDataRequirement): MarketDataCoverage {
  const pricePath = resolve(root, "normalized/market-prices.csv");
  const splitPath = resolve(root, "normalized/market-splits.csv");
  const prices = existsSync(pricePath) ? parseCsv(readFileSync(pricePath, "utf8")) : [];
  const splits = existsSync(splitPath) ? parseCsv(readFileSync(splitPath, "utf8")) : [];
  const observed = new Set(prices.map((row) => row.instrument_id));
  const missingInstrumentIds = requirement.canonicalInstrumentIds.filter((instrumentId) => !observed.has(instrumentId));
  const coveredFxPairs = requirement.fxPairs.filter((pair) => observed.has(`FX:${pair}`)).length;
  return {
    requiredSecurities: requirement.canonicalInstrumentIds.length,
    coveredSecurities: requirement.canonicalInstrumentIds.length - missingInstrumentIds.length,
    missingInstrumentIds, requiredFxPairs: requirement.fxPairs.length, coveredFxPairs,
    priceObservations: prices.length, splitEvents: splits.length,
  };
}

function tradingDayLag(latestEffectiveDate: string, expectedThroughDate: string): number {
  if (latestEffectiveDate >= expectedThroughDate) return 0;
  const cursor = new Date(`${latestEffectiveDate}T12:00:00Z`);
  let lag = 0;
  while (cursor.toISOString().slice(0, 10) < expectedThroughDate) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (isTradingDay(cursor.toISOString().slice(0, 10), NDX_CALENDAR)) lag += 1;
  }
  return lag;
}

export function loadMarketDataFreshness(
  root: string,
  requirement: MarketDataRequirement,
  asOfDate = currentDateInTimeZone(EPOCH_CONVENTIONS.reportingTimezone),
): MarketDataFreshness {
  assertIsoDate(asOfDate);
  const pricePath = resolve(root, "normalized/market-prices.csv");
  const manifestPath = resolve(root, "raw/market-data/manifest.json");
  const prices = existsSync(pricePath) ? parseCsv(readFileSync(pricePath, "utf8")) : [];
  const requiredIds = [...requirement.canonicalInstrumentIds, ...requirement.fxPairs.map((pair) => `FX:${pair}`)];
  const datesById = new Map<string, Set<string>>();
  for (const row of prices) {
    if (!requiredIds.includes(row.instrument_id)) continue;
    const dates = datesById.get(row.instrument_id) ?? new Set<string>();
    dates.add(row.date);
    datesById.set(row.instrument_id, dates);
  }
  const firstDates = requiredIds[0] ? datesById.get(requiredIds[0]) : null;
  const commonDates = firstDates
    ? [...firstDates].filter((date) => requiredIds.every((instrumentId) => datesById.get(instrumentId)?.has(date)))
    : [];
  const latestEffectiveDate = commonDates.sort().at(-1) ?? null;
  const expectedThroughDate = previousTradingDay(asOfDate, NDX_CALENDAR);

  let observedAt: string | null = null;
  let observationTimestampQuality: MarketDataFreshness["observationTimestampQuality"] = "missing";
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { observed_at?: string };
    if (manifest.observed_at && !Number.isNaN(Date.parse(manifest.observed_at))) {
      observedAt = new Date(manifest.observed_at).toISOString();
      observationTimestampQuality = "authoritative";
    } else {
      observedAt = statSync(manifestPath).mtime.toISOString();
      observationTimestampQuality = "filesystem_fallback";
    }
  }
  return evaluateMarketDataFreshness({
    latestEffectiveDate,
    expectedThroughDate,
    tradingDayLag: latestEffectiveDate ? tradingDayLag(latestEffectiveDate, expectedThroughDate) : null,
    observedAt,
    observationTimestampQuality,
  });
}

export function loadMarketBarCoverage(root: string, requirement: MarketDataRequirement): MarketBarCoverage {
  const barsPath = resolve(root, "normalized/market-bars.csv");
  const bars = existsSync(barsPath) ? parseCsv(readFileSync(barsPath, "utf8")) : [];
  // Security OHLCV and FX close alignment are separate contracts. Some FX
  // providers do not publish internally consistent intraday high/low fields,
  // so FX is validated by daily close coverage and freshness instead.
  const requiredInstrumentIds = requirement.canonicalInstrumentIds;
  const required = new Set(requiredInstrumentIds);
  return auditDailyMarketBars(bars.filter((row) => required.has(row.instrument_id)), requiredInstrumentIds);
}

function currentDateInTimeZone(timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

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
  "positions.csv": ["date", "account_id", "instrument_id", "ticker", "name", "category", "quantity", "price", "market_value", "currency", "cost_basis", "fx_to_cny", "market_value_cny", "source", "base_currency", "fx_to_base", "market_value_base"],
  "performance.csv": ["date", "portfolio_id", "total_assets", "cash", "net_external_flow", "currency", "nav", "period_return", "benchmark", "benchmark_return", "source", "external_flow_weight"],
};

const NUMERIC_COLUMNS: Record<BaselineFile, string[]> = {
  "transactions.csv": ["quantity", "price", "fees", "tax", "cash_amount"],
  "positions.csv": ["quantity", "price", "market_value", "cost_basis", "fx_to_cny", "market_value_cny", "fx_to_base", "market_value_base"],
  "performance.csv": ["total_assets", "cash", "net_external_flow", "nav", "period_return", "benchmark_return", "external_flow_weight"],
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
    addCheck(checks, `${name}:actions`, rows.every((row) => ALLOWED_ACTIONS.has(row.action)), unique(rows.map((row) => row.action)).join(", "));
  }
  addCheck(checks, `${name}:dates`, validDates, "ISO calendar dates");
  addCheck(checks, `${name}:currencies`, validCurrencies, unique(rows.map((row) => row.currency)).join(", "));
  addCheck(checks, `${name}:numbers`, validNumbers, "finite numeric values");
}

export function reconcileEventCoverage(rows: Row[]): EventCoverage {
  const isPresent = (value: string | undefined) => value !== undefined && value !== "";
  const valid = (row: Row): boolean => {
    if (!ALLOWED_ACTIONS.has(row.action)) return false;
    if (["buy", "sell"].includes(row.action)) return isPresent(row.instrument_id) && isPresent(row.quantity) && isPresent(row.price) && isPresent(row.cash_amount);
    if (["adjustment_in", "adjustment_out"].includes(row.action)) return isPresent(row.instrument_id) && isPresent(row.quantity) && !isPresent(row.cash_amount);
    if (["fx_buy", "fx_sell"].includes(row.action)) return row.instrument_id?.startsWith("FX:") === true && isPresent(row.cash_amount);
    return isPresent(row.cash_amount);
  };
  return {
    total: rows.length,
    classified: rows.filter(valid).length,
    trades: rows.filter((row) => row.action === "buy" || row.action === "sell").length,
    cashEvents: rows.filter((row) => !["buy", "sell", "adjustment_in", "adjustment_out"].includes(row.action)).length,
    dividends: rows.filter((row) => row.action === "dividend").length,
    taxes: rows.filter((row) => row.action === "tax").length,
    fxLegs: rows.filter((row) => row.action === "fx_buy" || row.action === "fx_sell").length,
    transfers: rows.filter((row) => row.action === "transfer_in" || row.action === "transfer_out").length,
    adjustments: rows.filter((row) => row.action === "adjustment_in" || row.action === "adjustment_out").length,
  };
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

export function reconcilePerformanceReturns(input: Row[]): PerformanceReconciliation {
  const rows = [...input].sort((left, right) => left.date.localeCompare(right.date));
  let datesContinuous = true;
  let maxNavLinkError = 0;
  let maxAssetReturnError = 0;
  let flowWeightsComplete = true;
  for (let index = 1; index < rows.length; index += 1) {
    const previous = rows[index - 1];
    const current = rows[index];
    const dayDifference = (Date.parse(`${current.date}T00:00:00Z`) - Date.parse(`${previous.date}T00:00:00Z`)) / 86_400_000;
    if (dayDifference !== 1) datesContinuous = false;
    const periodReturn = Number(current.period_return);
    maxNavLinkError = Math.max(maxNavLinkError, Math.abs(Number(current.nav) / Number(previous.nav) - 1 - periodReturn));
    const externalFlow = Number(current.net_external_flow);
    const weight = current.external_flow_weight === "" ? (externalFlow ? Number.NaN : 0) : Number(current.external_flow_weight);
    if (!Number.isFinite(weight) || weight < 0 || weight > 1) flowWeightsComplete = false;
    else {
      const denominator = Number(previous.total_assets) + weight * externalFlow;
      const reconstructedReturn = (Number(current.total_assets) - Number(previous.total_assets) - externalFlow) / denominator;
      maxAssetReturnError = Math.max(maxAssetReturnError, Math.abs(reconstructedReturn - periodReturn));
    }
  }
  return { datesContinuous, maxNavLinkError, flowWeightsComplete, maxAssetReturnError, assetReturnsReconciled: flowWeightsComplete && maxAssetReturnError <= 5e-5 };
}

function validatePerformanceChain(dataset: BaselineDataset): void {
  const rows = [...dataset.rows["performance.csv"]].sort((left, right) => left.date.localeCompare(right.date));
  const result = reconcilePerformanceReturns(rows);
  addCheck(dataset.checks, "performance:calendar-continuity", result.datesContinuous, `${rows.length} consecutive calendar days`);
  addCheck(dataset.checks, "performance:nav-chain", result.maxNavLinkError <= 1e-8, `maximum link error ${result.maxNavLinkError.toExponential(2)}`);
  addCheck(dataset.checks, "performance:cash-flow-weights", result.flowWeightsComplete, "explicit Modified Dietz weights in [0, 1] for every non-zero external flow");
  // The oldest Futu source reports daily return to four decimal places, so the
  // reconciliation tolerance is half of one source unit (0.005 percentage point).
  addCheck(dataset.checks, "performance:asset-return-reconciliation", result.assetReturnsReconciled, `maximum Modified Dietz return error ${result.maxAssetReturnError.toExponential(2)} (source tolerance 5.00e-5)`);
}

export function reconcilePositionQuantities(transactions: Row[], positions: Row[]): PositionReconciliation {
  const accounts = unique(positions.map((row) => row.account_id));
  const result: PositionReconciliation = { intervals: 0, comparisons: 0, matched: 0, timezoneAdjustedTransactions: 0, differences: [] };
  const isSecurity = (row: Row) => row.category !== "cash" && row.category !== "other" && !CASH_EQUIVALENT_INSTRUMENTS.has(row.instrument_id) && !isDerivativeInstrumentId(row.instrument_id);
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
        if (!["buy", "sell", "adjustment_in", "adjustment_out"].includes(row.action) || CASH_EQUIVALENT_INSTRUMENTS.has(row.instrument_id) || isDerivativeInstrumentId(row.instrument_id)) continue;
        const direction = row.action === "buy" || row.action === "adjustment_in" ? 1 : -1;
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
  const valuationCoverage = reconcileReportedValuations(rows["positions.csv"]);
  const marketRequirement = marketDataRequirement(rows["transactions.csv"], rows["performance.csv"]);
  const marketCoverage = loadMarketDataCoverage(root, marketRequirement);
  const currentMarketRequirement = currentPositionMarketDataRequirement(rows["positions.csv"]);
  const marketFreshness = loadMarketDataFreshness(root, currentMarketRequirement);
  const marketBarCoverage = loadMarketBarCoverage(root, currentMarketRequirement);
  const splitPath = resolve(root, "normalized/market-splits.csv");
  const pricePath = resolve(root, "normalized/market-prices.csv");
  const splits = existsSync(splitPath) ? parseCsv(readFileSync(splitPath, "utf8")) : [];
  const prices = existsSync(pricePath) ? parseCsv(readFileSync(pricePath, "utf8")) : [];
  const replayReadiness = ledgerReplayReadiness(rows["transactions.csv"], splits);
  const cashEndpointReconciliation = reconcileCashEndpoints(rows["transactions.csv"], rows["positions.csv"]);
  const dailyReplay = replayLedgerDaily(rows["transactions.csv"], splits, rows["performance.csv"].map((row) => row.date));
  const dailyValuation = valueDailyLedger(dailyReplay.states, prices, rows["transactions.csv"], rows["performance.csv"]);
  const returnAttribution = attributePortfolioReturns({
    states: dailyReplay.states,
    prices,
    transactions: rows["transactions.csv"],
    performance: rows["performance.csv"],
    splits,
    residualReasonsByDate: Object.fromEntries(
      dailyValuation.points.map((point) => [point.date, point.missingInstrumentIds]),
    ),
  });
  const terminalState = dailyReplay.states.at(-1);
  const dailyLedgerReplay: DailyLedgerReplaySummary = {
    days: dailyReplay.days, transactionEventsApplied: dailyReplay.transactionEventsApplied,
    splitEventsApplied: dailyReplay.splitEventsApplied,
    terminalCashAccounts: Object.keys(terminalState?.cash ?? {}).length,
    terminalPositionAccounts: Object.values(terminalState?.quantities ?? {}).filter((quantity) => Math.abs(quantity) > 1e-8).length,
    terminalTransit: Object.fromEntries(Object.entries(terminalState?.transit ?? {}).filter(([, amount]) => Math.abs(amount) > 1e-8)),
  };
  const dailyLedgerValuation: DailyLedgerValuationSummary = {
    totalDays: dailyValuation.totalDays,
    valuedDays: dailyValuation.valuedDays,
    accountedDays: dailyValuation.accountedDays,
    residualBridgeDays: dailyValuation.residualBridgeDays,
    missingPriceDays: dailyValuation.missingPriceDays,
    maxAbsoluteResidualBridgeUsd: dailyValuation.maxAbsoluteResidualBridgeUsd,
    maxAbsoluteDifferenceUsd: dailyValuation.maxAbsoluteDifferenceUsd,
    maxAbsoluteRelativeDifference: dailyValuation.maxAbsoluteRelativeDifference,
    terminalDifferenceUsd: dailyValuation.terminalDifferenceUsd,
    missingInstrumentIds: dailyValuation.missingInstrumentIds,
  };
  const dataset: BaselineDataset = { root, manifest, rows, hashes, checks, positionReconciliation, valuationCoverage, marketDataRequirement: marketRequirement, marketDataCoverage: marketCoverage, marketDataFreshness: marketFreshness, marketBarCoverage, ledgerReplayReadiness: replayReadiness, cashEndpointReconciliation, dailyLedgerReplay, dailyLedgerValuation, returnAttribution, healthy: false, ledgerReconciled: false };
  validateKeys(rows, checks);
  validateScope(dataset);
  validatePerformanceChain(dataset);
  const eventCoverage = reconcileEventCoverage(rows["transactions.csv"]);
  addCheck(dataset.checks, "ledger:event-contracts", eventCoverage.classified === eventCoverage.total, `${eventCoverage.classified}/${eventCoverage.total} events satisfy their type contract`);
  dataset.checks.push({
    name: "market-data:daily-coverage",
    status: marketCoverage.missingInstrumentIds.length || marketCoverage.coveredFxPairs !== marketCoverage.requiredFxPairs ? "pending" : "passed",
    detail: `${marketCoverage.coveredSecurities}/${marketCoverage.requiredSecurities} canonical securities and ${marketCoverage.coveredFxPairs}/${marketCoverage.requiredFxPairs} FX pairs covered by ${marketCoverage.priceObservations} observations; missing ${marketCoverage.missingInstrumentIds.join(", ") || "none"}`,
  });
  dataset.checks.push({
    name: "market-data:freshness",
    status: marketFreshness.status === "fresh" ? "passed" : "pending",
    detail: `${marketFreshness.status}; latest common effective date ${marketFreshness.latestEffectiveDate ?? "missing"}, expected through ${marketFreshness.expectedThroughDate}, observed at ${marketFreshness.observedAt ?? "missing"} (${marketFreshness.observationTimestampQuality})`,
  });
  dataset.checks.push({
    name: "market-data:ohlcv",
    status: marketBarCoverage.coveredInstruments === marketBarCoverage.requiredInstruments
      && marketBarCoverage.invalidBars === 0 && marketBarCoverage.duplicateBars === 0 ? "passed" : "pending",
    detail: `${marketBarCoverage.coveredInstruments}/${marketBarCoverage.requiredInstruments} current instruments covered by ${marketBarCoverage.validBars} valid bars; ${marketBarCoverage.invalidBars} invalid, ${marketBarCoverage.duplicateBars} duplicate; missing ${marketBarCoverage.missingInstrumentIds.join(", ") || "none"}`,
  });
  addCheck(dataset.checks, "ledger:daily-state-replay", dailyReplay.days === rows["performance.csv"].length && dailyReplay.transactionEventsApplied === rows["transactions.csv"].length && dailyReplay.splitEventsApplied === marketCoverage.splitEvents, `${dailyReplay.days} daily states; ${dailyReplay.transactionEventsApplied}/${rows["transactions.csv"].length} transactions and ${dailyReplay.splitEventsApplied}/${marketCoverage.splitEvents} splits applied`);
  dataset.checks.push({
    name: "ledger:daily-valuation",
    status: dailyValuation.accountedDays === dailyValuation.totalDays ? "passed" : "pending",
    detail: `${dailyValuation.accountedDays}/${dailyValuation.totalDays} days accounted; ${dailyValuation.valuedDays} independently valued and ${dailyValuation.residualBridgeDays} residual-backed for ${dailyValuation.missingInstrumentIds.join(", ") || "no instruments"}`,
  });
  addCheck(dataset.checks, "ledger:replay-input-classification", replayReadiness.classified === replayReadiness.total, `${replayReadiness.classified}/${replayReadiness.total} events mapped to replay inputs; ${replayReadiness.positionImpactingSplits}/${replayReadiness.splitEvents} split events impact open positions`);
  dataset.checks.push({
    name: "ledger:cash-endpoint-reconciliation",
    status: cashEndpointReconciliation.differences.length ? "pending" : "passed",
    detail: `${cashEndpointReconciliation.matched}/${cashEndpointReconciliation.endpoints} latest account-currency cash endpoints matched; ${cashEndpointReconciliation.differences.length} differences require source classification`,
  });
  dataset.ledgerReconciled = dailyValuation.accountedDays === dailyValuation.totalDays
    && dailyValuation.maxAbsoluteRelativeDifference <= DAILY_VALUATION_SOURCE_BASIS_TOLERANCE
    && cashEndpointReconciliation.differences.length === 0
    && positionReconciliation.differences.length === 0
    && eventCoverage.classified === eventCoverage.total;
  dataset.checks.push({
    name: "ledger:full-reconciliation",
    status: dataset.ledgerReconciled ? "passed" : "pending",
    detail: dataset.ledgerReconciled
      ? `qualified reconciliation: ${dailyValuation.valuedDays} independent days within ${(dailyValuation.maxAbsoluteRelativeDifference * 100).toFixed(3)}% maximum source-basis difference; ${dailyValuation.residualBridgeDays} explicitly residual-backed days`
      : `daily valuation exceeds the ${(DAILY_VALUATION_SOURCE_BASIS_TOLERANCE * 100).toFixed(2)}% source-basis tolerance or has unresolved ledger differences`,
  });
  addCheck(dataset.checks, "positions:reported-base-valuations", valuationCoverage.fxReconciled === valuationCoverage.withFx, `${valuationCoverage.fxReconciled}/${valuationCoverage.withFx} available base-currency valuations reconcile within source precision`);
  dataset.checks.push({ name: "positions:fx-coverage", status: valuationCoverage.missingFx ? "pending" : "passed", detail: `${valuationCoverage.withFx}/${valuationCoverage.total} rows carry explicit broker base-currency FX; ${valuationCoverage.missingFx} rows missing` });
  dataset.checks.push({
    name: "ledger:position-quantity-reconciliation",
    status: positionReconciliation.differences.length ? "pending" : "passed",
    detail: `${positionReconciliation.matched}/${positionReconciliation.comparisons} quantities matched after ${positionReconciliation.timezoneAdjustedTransactions} timezone-boundary alignments; ${positionReconciliation.differences.length} differences require classification`,
  });
  dataset.healthy = checks.every((check) => check.status !== "failed");
  return dataset;
}
