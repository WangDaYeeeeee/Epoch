export type MarketDataRequirement = {
  dateFrom: string;
  dateTo: string;
  rawInstrumentIds: number;
  canonicalInstrumentIds: string[];
  aliasesCollapsed: number;
  fxPairs: string[];
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
