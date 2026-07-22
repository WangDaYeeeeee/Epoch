import type { DailyLedgerState } from "./ledger-replay";
import { CASH_EQUIVALENT_INSTRUMENTS, canonicalMarketInstrumentId, isDerivativeInstrumentId } from "./market-data";

type Row = Record<string, string>;

export type DailyLedgerValuationPoint = {
  date: string;
  knownValueUsd: number;
  ledgerValueUsd: number | null;
  accountedValueUsd: number;
  reportedValueUsd: number;
  differenceUsd: number | null;
  residualBridgeUsd: number | null;
  valuationMethod: "independent" | "residual_bridge";
  missingInstrumentIds: string[];
};

export type DailyLedgerValuation = {
  totalDays: number;
  valuedDays: number;
  accountedDays: number;
  residualBridgeDays: number;
  missingPriceDays: number;
  maxAbsoluteResidualBridgeUsd: number;
  maxAbsoluteDifferenceUsd: number;
  maxAbsoluteRelativeDifference: number;
  terminalDifferenceUsd: number | null;
  missingInstrumentIds: string[];
  points: DailyLedgerValuationPoint[];
};

function suffix(key: string): string {
  return key.slice(key.indexOf("|") + 1);
}

export function valueDailyLedger(
  states: DailyLedgerState[],
  prices: Row[],
  transactions: Row[],
  performance: Row[],
): DailyLedgerValuation {
  const observations = new Map<string, Map<string, number>>();
  const currencies = new Map<string, string>();
  for (const row of prices) {
    const daily = observations.get(row.date) ?? new Map<string, number>();
    daily.set(row.instrument_id, Number(row.close));
    observations.set(row.date, daily);
    currencies.set(row.instrument_id, row.currency);
  }
  // An execution price is a defensible seed before the first daily close is
  // available. Market observations take precedence when both exist.
  for (const row of transactions) {
    if (!row.instrument_id || row.price === "" || !Number.isFinite(Number(row.price))) continue;
    const instrumentId = canonicalMarketInstrumentId(row.instrument_id);
    const daily = observations.get(row.date) ?? new Map<string, number>();
    if (!daily.has(instrumentId)) daily.set(instrumentId, Number(row.price));
    observations.set(row.date, daily);
    if (row.currency) currencies.set(instrumentId, row.currency);
  }

  const reported = new Map(performance.map((row) => [row.date, Number(row.total_assets)]));
  const latest = new Map<string, number>();
  const points: DailyLedgerValuationPoint[] = [];
  const allMissing = new Set<string>();
  let maxAbsoluteDifferenceUsd = 0;
  let maxAbsoluteRelativeDifference = 0;
  let maxAbsoluteResidualBridgeUsd = 0;
  let previousReportedValueUsd: number | undefined;

  for (const state of states) {
    const day = new Date(`${state.date}T00:00:00Z`).getUTCDay();
    const isWeekend = day === 0 || day === 6;
    if (!isWeekend) {
      for (const [instrumentId, close] of observations.get(state.date) ?? []) latest.set(instrumentId, close);
    }
    const fx = (currency: string): number | undefined => currency === "USD" ? 1 : latest.get(`FX:${currency}USD`);
    const missing = new Set<string>();
    let ledgerValueUsd = 0;

    for (const [key, amount] of Object.entries(state.cash)) {
      const currency = suffix(key);
      const rate = fx(currency);
      if (rate == null) missing.add(`FX:${currency}USD`);
      else ledgerValueUsd += amount * rate;
    }
    for (const [key, amount] of Object.entries(state.transit)) {
      if (Math.abs(amount) < 1e-8) continue;
      if (key.startsWith("subaccount:")) {
        missing.add(key.slice(0, key.indexOf("|")).toUpperCase());
        continue;
      }
      const currency = suffix(key);
      const rate = fx(currency);
      if (rate == null) missing.add(`FX:${currency}USD`);
      else ledgerValueUsd += amount * rate;
    }
    for (const [key, amount] of Object.entries(state.cashEquivalents)) {
      if (Math.abs(amount) < 1e-8) continue;
      const instrumentId = suffix(key);
      const currency = currencies.get(instrumentId);
      const rate = currency ? fx(currency) : undefined;
      if (!currency) missing.add(instrumentId);
      else if (rate == null) missing.add(`FX:${currency}USD`);
      else {
        const quantity = state.quantities[key] ?? 0;
        const close = latest.get(instrumentId);
        // Use NAV where the fund publishes one; retain book value as the
        // explicit fallback for cash-like funds without a historical feed.
        ledgerValueUsd += (close == null ? amount : quantity * close) * rate;
      }
    }
    for (const [key, quantity] of Object.entries(state.quantities)) {
      if (Math.abs(quantity) < 1e-8) continue;
      const instrumentId = suffix(key);
      if (CASH_EQUIVALENT_INSTRUMENTS.has(instrumentId)) continue;
      if (isDerivativeInstrumentId(instrumentId)) {
        missing.add(instrumentId);
        continue;
      }
      const close = latest.get(instrumentId);
      const currency = currencies.get(instrumentId);
      const rate = currency ? fx(currency) : undefined;
      if (close == null || !currency) missing.add(instrumentId);
      else if (rate == null) missing.add(`FX:${currency}USD`);
      else ledgerValueUsd += quantity * close * rate;
    }

    const reportedValueUsd = reported.get(state.date) ?? 0;
    if (isWeekend && previousReportedValueUsd != null && Math.abs(reportedValueUsd - previousReportedValueUsd) > 0.005) {
      missing.add("REPORTING_SNAPSHOT_TIMING");
    }
    const complete = missing.size === 0;
    const differenceUsd = complete ? ledgerValueUsd - reportedValueUsd : null;
    const residualBridgeUsd = complete ? null : reportedValueUsd - ledgerValueUsd;
    if (differenceUsd != null) {
      maxAbsoluteDifferenceUsd = Math.max(maxAbsoluteDifferenceUsd, Math.abs(differenceUsd));
      if (Math.abs(reportedValueUsd) > 1e-8) maxAbsoluteRelativeDifference = Math.max(maxAbsoluteRelativeDifference, Math.abs(differenceUsd / reportedValueUsd));
    }
    if (residualBridgeUsd != null) maxAbsoluteResidualBridgeUsd = Math.max(maxAbsoluteResidualBridgeUsd, Math.abs(residualBridgeUsd));
    for (const instrumentId of missing) allMissing.add(instrumentId);
    points.push({
      date: state.date,
      knownValueUsd: ledgerValueUsd,
      ledgerValueUsd: complete ? ledgerValueUsd : null,
      accountedValueUsd: complete ? ledgerValueUsd : ledgerValueUsd + (residualBridgeUsd ?? 0),
      reportedValueUsd,
      differenceUsd,
      residualBridgeUsd,
      valuationMethod: complete ? "independent" : "residual_bridge",
      missingInstrumentIds: [...missing].sort(),
    });
    previousReportedValueUsd = reportedValueUsd;
  }

  const valuedDays = points.filter((point) => point.differenceUsd != null).length;
  return {
    totalDays: points.length,
    valuedDays,
    accountedDays: points.length,
    residualBridgeDays: points.length - valuedDays,
    missingPriceDays: points.length - valuedDays,
    maxAbsoluteResidualBridgeUsd,
    maxAbsoluteDifferenceUsd,
    maxAbsoluteRelativeDifference,
    terminalDifferenceUsd: points.at(-1)?.differenceUsd ?? null,
    missingInstrumentIds: [...allMissing].sort(),
    points,
  };
}
