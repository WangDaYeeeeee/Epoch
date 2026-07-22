import { CASH_EQUIVALENT_INSTRUMENTS, canonicalMarketInstrumentId, isDerivativeInstrumentId } from "./market-data";

type Row = Record<string, string>;

export type LedgerReplayReadiness = {
  total: number;
  classified: number;
  marketTrades: number;
  derivativeTrades: number;
  cashEquivalentTrades: number;
  cashEvents: number;
  fxLegs: number;
  transfers: number;
  adjustments: number;
  splitEvents: number;
  positionImpactingSplits: number;
};

export type CashEndpointDifference = {
  accountId: string;
  currency: string;
  date: string;
  replayed: number;
  reported: number;
  difference: number;
};

export type CashEndpointReconciliation = {
  endpoints: number;
  matched: number;
  differences: CashEndpointDifference[];
};

export function reconcileCashEndpoints(transactions: Row[], positions: Row[]): CashEndpointReconciliation {
  const latest = new Map<string, Row>();
  for (const row of positions) {
    if (!row.instrument_id?.startsWith("CASH:")) continue;
    const key = `${row.account_id}|${row.currency}`;
    if (!latest.has(key) || row.date > latest.get(key)!.date) latest.set(key, row);
  }

  const differences: CashEndpointDifference[] = [];
  let matched = 0;
  for (const [key, position] of latest) {
    const [accountId, currency] = key.split("|");
    const replayed = transactions
      .filter((row) => {
        const statementDate = row.source?.match(/_statement_(\d{4}-\d{2}-\d{2})\.pdf/)?.[1];
        const cashDate = statementDate && row.instrument_id?.startsWith("US:")
          && (Date.parse(`${row.date}T00:00:00Z`) - Date.parse(`${statementDate}T00:00:00Z`)) / 86_400_000 === 1
          ? statementDate : row.date;
        return row.account_id === accountId && row.currency === currency && cashDate <= position.date && row.cash_amount !== "";
      })
      .reduce((sum, row) => sum + Number(row.cash_amount), 0);
    const reported = Number(position.quantity);
    const difference = reported - replayed;
    // Futu reports cash to cents while several source trade amounts are
    // reconstructed from independently rounded line items. Five cents keeps
    // those source-precision differences separate from genuine missing cash.
    if (Math.abs(difference) <= 0.05) matched += 1;
    else differences.push({ accountId, currency, date: position.date, replayed, reported, difference });
  }
  return { endpoints: latest.size, matched, differences };
}

export function ledgerReplayReadiness(transactions: Row[], splits: Row[]): LedgerReplayReadiness {
  const result: LedgerReplayReadiness = {
    total: transactions.length, classified: 0, marketTrades: 0, derivativeTrades: 0, cashEquivalentTrades: 0,
    cashEvents: 0, fxLegs: 0, transfers: 0, adjustments: 0,
    splitEvents: splits.length, positionImpactingSplits: 0,
  };
  for (const row of transactions) {
    if (row.action === "buy" || row.action === "sell") {
      if (CASH_EQUIVALENT_INSTRUMENTS.has(row.instrument_id)) result.cashEquivalentTrades += 1;
      else if (isDerivativeInstrumentId(row.instrument_id)) result.derivativeTrades += 1;
      else result.marketTrades += 1;
    } else if (row.action === "fx_buy" || row.action === "fx_sell") result.fxLegs += 1;
    else if (row.action === "transfer_in" || row.action === "transfer_out") result.transfers += 1;
    else if (row.action === "adjustment_in" || row.action === "adjustment_out") result.adjustments += 1;
    else result.cashEvents += 1;
    result.classified += 1;
  }

  const quantities = new Map<string, number>();
  const datedEvents = [
    ...transactions.map((row) => ({ kind: "transaction" as const, date: row.date, row })),
    ...splits.map((row) => ({ kind: "split" as const, date: row.date, row })),
  ].sort((left, right) => left.date.localeCompare(right.date) || (left.kind === "split" ? -1 : 1));
  for (const event of datedEvents) {
    const row = event.row;
    if (event.kind === "split") {
      const instrumentId = canonicalMarketInstrumentId(row.instrument_id);
      const affected = [...quantities.entries()].filter(([key, quantity]) => key.endsWith(`|${instrumentId}`) && Math.abs(quantity) > 1e-8);
      if (affected.length) result.positionImpactingSplits += 1;
      const ratio = Number(row.numerator) / Number(row.denominator);
      for (const [key, quantity] of affected) quantities.set(key, quantity * ratio);
      continue;
    }
    if (!["buy", "sell", "adjustment_in", "adjustment_out"].includes(row.action)) continue;
    const instrumentId = canonicalMarketInstrumentId(row.instrument_id);
    if (!instrumentId || CASH_EQUIVALENT_INSTRUMENTS.has(instrumentId) || isDerivativeInstrumentId(instrumentId)) continue;
    const key = `${row.account_id}|${instrumentId}`;
    const direction = row.action === "buy" || row.action === "adjustment_in" ? 1 : -1;
    quantities.set(key, (quantities.get(key) ?? 0) + direction * Number(row.quantity));
  }
  return result;
}
