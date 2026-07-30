import { assertIsoDate } from "./conventions";

export type MarketDataRequirement = {
  dateFrom: string;
  dateTo: string;
  rawInstrumentIds: number;
  canonicalInstrumentIds: string[];
  aliasesCollapsed: number;
  fxPairs: string[];
};

export type MarketDataFreshness = {
  status: "fresh" | "stale" | "missing";
  latestEffectiveDate: string | null;
  expectedThroughDate: string;
  tradingDayLag: number | null;
  observedAt: string | null;
  observationTimestampQuality: "authoritative" | "filesystem_fallback" | "missing";
  reason: string;
};

export type MarketBarCoverage = {
  requiredInstruments: number;
  coveredInstruments: number;
  missingInstrumentIds: string[];
  totalBars: number;
  validBars: number;
  invalidBars: number;
  duplicateBars: number;
};

const US_VENUES = new Set(["ARCX", "BATS", "XNAS", "XNYS"]);
export const CASH_EQUIVALENT_INSTRUMENTS = new Set([
  "FUND:HK0000502390",
  "FUND:HK0000584752",
  "FUND:HK0000938420",
]);

export function canonicalMarketInstrumentId(instrumentId: string): string {
  const [venue, symbol] = instrumentId.split(":", 2);
  if (US_VENUES.has(venue) && symbol) return `US:${symbol}`;
  return instrumentId;
}

export function canonicalBrokerPositionInstrumentId(position: {
  instrumentId: string;
  symbol: string;
  currency: string;
  assetClass: string;
}): string {
  if (
    position.instrumentId.startsWith("IBKR:")
    && position.currency === "USD"
    && ["stock", "fund"].includes(position.assetClass)
    && /^[A-Z0-9.-]+$/.test(position.symbol)
  ) return `US:${position.symbol}`;
  return canonicalMarketInstrumentId(position.instrumentId);
}

export function isDerivativeInstrumentId(instrumentId: string): boolean {
  return /:[A-Z0-9]+\d{6}[CP]\d+$/.test(instrumentId);
}

export function marketDataRequirement(
  transactions: Array<Record<string, string>>,
  performance: Array<Record<string, string>>,
): MarketDataRequirement {
  const rawIds = [...new Set(transactions
    .filter((row) => ["buy", "sell", "adjustment_in", "adjustment_out"].includes(row.action))
    .map((row) => row.instrument_id)
    .filter((instrumentId) => instrumentId && !instrumentId.startsWith("CASH:") && !instrumentId.startsWith("FX:") && !CASH_EQUIVALENT_INSTRUMENTS.has(instrumentId) && !isDerivativeInstrumentId(instrumentId)))].sort();
  const canonicalInstrumentIds = [...new Set(rawIds.map(canonicalMarketInstrumentId))].sort();
  const currencies = new Set(transactions.map((row) => row.currency).filter(Boolean));
  const dates = performance.map((row) => row.date).filter(Boolean).sort();
  return {
    dateFrom: dates[0] ?? "",
    dateTo: dates.at(-1) ?? "",
    rawInstrumentIds: rawIds.length,
    canonicalInstrumentIds,
    aliasesCollapsed: rawIds.length - canonicalInstrumentIds.length,
    fxPairs: [...currencies].filter((currency) => currency !== "USD").sort().map((currency) => `${currency}USD`),
  };
}

export function currentPositionMarketDataRequirement(
  positions: Array<Record<string, string>>,
): MarketDataRequirement {
  const latestDate = positions.map((row) => row.date).filter(Boolean).sort().at(-1) ?? "";
  const current = positions.filter((row) => row.date === latestDate);
  const rawIds = [...new Set(current
    .filter((row) => Number(row.quantity) !== 0)
    .map((row) => row.instrument_id)
    .filter((instrumentId) => instrumentId && !instrumentId.startsWith("CASH:") && !instrumentId.startsWith("ACCRUAL:") && !CASH_EQUIVALENT_INSTRUMENTS.has(instrumentId)))].sort();
  const canonicalInstrumentIds = [...new Set(rawIds.map(canonicalMarketInstrumentId))].sort();
  const currencies = new Set(current.filter((row) => Number(row.quantity) !== 0).map((row) => row.currency).filter(Boolean));
  return {
    dateFrom: latestDate,
    dateTo: latestDate,
    rawInstrumentIds: rawIds.length,
    canonicalInstrumentIds,
    aliasesCollapsed: rawIds.length - canonicalInstrumentIds.length,
    fxPairs: [...currencies].filter((currency) => currency !== "USD").sort().map((currency) => `${currency}USD`),
  };
}

export function evaluateMarketDataFreshness(input: {
  latestEffectiveDate: string | null;
  expectedThroughDate: string;
  tradingDayLag: number | null;
  observedAt?: string | null;
  observationTimestampQuality?: MarketDataFreshness["observationTimestampQuality"];
  maximumTradingDayLag?: number;
}): MarketDataFreshness {
  const maximumTradingDayLag = input.maximumTradingDayLag ?? 1;
  const observationTimestampQuality = input.observationTimestampQuality ?? (input.observedAt ? "authoritative" : "missing");
  if (!input.latestEffectiveDate || input.tradingDayLag == null) {
    return {
      status: "missing",
      latestEffectiveDate: input.latestEffectiveDate,
      expectedThroughDate: input.expectedThroughDate,
      tradingDayLag: input.tradingDayLag,
      observedAt: input.observedAt ?? null,
      observationTimestampQuality,
      reason: "所有必需行情与外汇序列之间没有可用的共同有效日期。",
    };
  }
  const status = input.tradingDayLag <= maximumTradingDayLag ? "fresh" : "stale";
  return {
    status,
    latestEffectiveDate: input.latestEffectiveDate,
    expectedThroughDate: input.expectedThroughDate,
    tradingDayLag: input.tradingDayLag,
    observedAt: input.observedAt ?? null,
    observationTimestampQuality,
    reason: status === "fresh"
      ? `最新共同行情日期距离预期截止日不超过 ${maximumTradingDayLag} 个交易日。`
      : `最新共同行情日期较预期截止日滞后 ${input.tradingDayLag} 个交易日。`,
  };
}

export function auditDailyMarketBars(
  rows: Array<Record<string, string>>,
  requiredInstrumentIds: string[],
): MarketBarCoverage {
  const covered = new Set<string>();
  const seen = new Set<string>();
  let validBars = 0;
  let duplicateBars = 0;
  for (const row of rows) {
    const key = `${row.date}|${row.instrument_id}`;
    if (seen.has(key)) duplicateBars += 1;
    seen.add(key);
    let valid = true;
    try { assertIsoDate(row.date); } catch { valid = false; }
    const open = Number(row.open), high = Number(row.high), low = Number(row.low), close = Number(row.close);
    if (![open, high, low, close].every((value) => Number.isFinite(value) && value > 0)) valid = false;
    if (high < Math.max(open, close) || low > Math.min(open, close) || high < low) valid = false;
    if (row.volume !== "" && (!Number.isFinite(Number(row.volume)) || Number(row.volume) < 0)) valid = false;
    if (!row.observed_at || Number.isNaN(Date.parse(row.observed_at))) valid = false;
    if (!row.instrument_id || !row.currency || !row.source) valid = false;
    if (valid) {
      validBars += 1;
      covered.add(row.instrument_id);
    }
  }
  const missingInstrumentIds = requiredInstrumentIds.filter((instrumentId) => !covered.has(instrumentId)).sort();
  return {
    requiredInstruments: requiredInstrumentIds.length,
    coveredInstruments: requiredInstrumentIds.length - missingInstrumentIds.length,
    missingInstrumentIds,
    totalBars: rows.length,
    validBars,
    invalidBars: rows.length - validBars,
    duplicateBars,
  };
}
