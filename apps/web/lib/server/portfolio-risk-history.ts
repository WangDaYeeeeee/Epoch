import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Sql } from "postgres";
import { buildHistoricalPortfolioRiskInput } from "../domain/risk-input";
import { replayLedgerDaily } from "../domain/ledger-replay";
import { parseCsv } from "./csv";
import {
  createCalculationRequest,
  executeRecordedCalculation,
  PostgresCalculationRunRepository,
} from "./calculation-run";
import { resolveDataRoot } from "./portfolio";
import { riskCodeVersion } from "./risk-code-version";

type Row = Record<string, string>;
export type RiskHistoryFrequency = "daily" | "weekly" | "monthly";
export type RiskHistoryBackfillOptions = {
  dateFrom?: string;
  dateTo?: string;
  frequency?: RiskHistoryFrequency;
  limit?: number;
};
export type RiskHistoryBackfillResult = {
  frequency: RiskHistoryFrequency;
  dateFrom: string;
  dateTo: string;
  candidateDates: number;
  requestedDates: number;
  availableRuns: number;
  skippedDates: number;
  skipped: { date: string; reason: string }[];
};

const readRows = (root: string, file: string): Row[] =>
  parseCsv(readFileSync(resolve(root, "normalized", file), "utf8"));

const isoWeekKey = (date: string): string => {
  const value = new Date(`${date}T00:00:00Z`);
  const day = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(value.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((value.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return `${value.getUTCFullYear()}-${String(week).padStart(2, "0")}`;
};

const selectFrequencyDates = (dates: string[], frequency: RiskHistoryFrequency): string[] => {
  if (frequency === "daily") return dates;
  const selected = new Map<string, string>();
  for (const date of dates) {
    const key = frequency === "monthly" ? date.slice(0, 7) : isoWeekKey(date);
    selected.set(key, date);
  }
  return [...selected.values()];
};

const frequencyKey = (date: string, frequency: RiskHistoryFrequency): string =>
  frequency === "daily" ? date : frequency === "monthly" ? date.slice(0, 7) : isoWeekKey(date);

const skipReason = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  if (/requires (60 USD OHLC bars|251 common USD close dates)/.test(message)) return "insufficient_history";
  if (/has no .* (market|FX|aligned) close/.test(message)) return "missing_market_data";
  if (/no market-risk positions/.test(message)) return "no_market_risk_positions";
  if (/positive USD portfolio NAV/.test(message)) return "invalid_nav";
  return message;
};

export function preparePortfolioRiskHistoryBackfill(
  options: RiskHistoryBackfillOptions = {},
  root = resolveDataRoot(),
) {
  if (!root) throw new Error("Private baseline data is unavailable");
  const frequency = options.frequency ?? "daily";
  const limit = Math.max(1, Math.min(500, Math.trunc(options.limit ?? 260)));
  const transactions = readRows(root, "transactions.csv");
  const performance = readRows(root, "performance.csv");
  const splits = readRows(root, "market-splits.csv");
  const bars = readRows(root, "market-bars.csv");
  const performanceByDate = new Map(performance.map((row) => [row.date, row]));
  const marketDates = new Set(
    bars.filter((row) => !row.instrument_id.startsWith("FX:")).map((row) => row.date),
  );
  const allDates = [...performanceByDate.keys()].filter((date) => marketDates.has(date)).sort();
  const dateFrom = options.dateFrom ?? allDates[0];
  const dateTo = options.dateTo ?? allDates.at(-1);
  if (!dateFrom || !dateTo || dateFrom > dateTo) throw new Error("Historical risk requires a valid date range");
  const eligibleDates = allDates.filter((date) => date >= dateFrom && date <= dateTo);
  const candidateDates = selectFrequencyDates(eligibleDates, frequency);
  const replay = replayLedgerDaily(transactions, splits, eligibleDates);
  const attemptByDate = new Map<string, { request?: ReturnType<typeof createCalculationRequest>; reason?: string }>();
  const codeVersion = riskCodeVersion();
  for (const state of replay.states) {
    try {
      const performanceRow = performanceByDate.get(state.date);
      if (!performanceRow) throw new Error("Historical risk has no matching NAV");
      const payload = buildHistoricalPortfolioRiskInput(state, Number(performanceRow.total_assets), bars, splits);
      attemptByDate.set(state.date, { request: createCalculationRequest({
        calculationType: "portfolio-risk",
        asOf: payload.asOf,
        codeVersion,
        strategyVersion: "epoch-satellite-v0.1.0",
        parameterSetVersion: "default-draft-v0.1.0",
        payload: JSON.parse(JSON.stringify(payload)) as Record<string, unknown>,
      }) });
    } catch (error) {
      attemptByDate.set(state.date, { reason: skipReason(error) });
    }
  }

  const periods = new Map<string, string[]>();
  for (const date of eligibleDates) {
    const key = frequencyKey(date, frequency);
    periods.set(key, [...(periods.get(key) ?? []), date]);
  }
  const skipped: { date: string; reason: string }[] = [];
  const available = [...periods.values()].flatMap((dates) => {
    const selected = [...dates].reverse().find((date) => attemptByDate.get(date)?.request);
    if (selected) return [{ date: selected, request: attemptByDate.get(selected)!.request! }];
    const fallbackDate = dates.at(-1)!;
    skipped.push({ date: fallbackDate, reason: attemptByDate.get(fallbackDate)?.reason ?? "unavailable" });
    return [];
  });
  const selectedAvailable = available.slice(-limit);
  const requestedDates = selectedAvailable.map((item) => item.date);
  const requests = selectedAvailable.map((item) => item.request);

  return { frequency, dateFrom, dateTo, candidateDates, requestedDates, requests, skipped };
}

export async function runPortfolioRiskHistoryBackfill(
  sql: Sql,
  options: RiskHistoryBackfillOptions = {},
): Promise<RiskHistoryBackfillResult> {
  const prepared = preparePortfolioRiskHistoryBackfill(options);
  const repository = new PostgresCalculationRunRepository(sql);
  let cursor = 0;
  let availableRuns = 0;
  const failures: { date: string; reason: string }[] = [];
  const worker = async () => {
    while (cursor < prepared.requests.length) {
      const request = prepared.requests[cursor++];
      try {
        await executeRecordedCalculation(repository, request);
        availableRuns += 1;
      } catch (error) {
        failures.push({ date: request.asOf.slice(0, 10), reason: skipReason(error) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, prepared.requests.length) }, worker));
  if (prepared.requests.length > 0 && availableRuns === 0 && failures.length > 0) {
    const reasons = [...new Set(failures.map((item) => item.reason))].slice(0, 3).join("; ");
    throw new Error(`Historical risk calculations all failed: ${reasons}`);
  }
  const skipped = [...prepared.skipped, ...failures].sort((left, right) => left.date.localeCompare(right.date));
  return {
    frequency: prepared.frequency,
    dateFrom: prepared.dateFrom,
    dateTo: prepared.dateTo,
    candidateDates: prepared.candidateDates.length,
    requestedDates: prepared.requestedDates.length,
    availableRuns,
    skippedDates: skipped.length,
    skipped,
  };
}
