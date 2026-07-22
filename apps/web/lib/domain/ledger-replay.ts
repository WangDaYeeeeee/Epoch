import { CASH_EQUIVALENT_INSTRUMENTS, canonicalMarketInstrumentId, isDerivativeInstrumentId } from "./market-data";

type Row = Record<string, string>;

export type DailyLedgerState = {
  date: string;
  cash: Record<string, number>;
  transit: Record<string, number>;
  cashEquivalents: Record<string, number>;
  quantities: Record<string, number>;
};

export type DailyLedgerReplay = {
  days: number;
  transactionEventsApplied: number;
  splitEventsApplied: number;
  states: DailyLedgerState[];
};

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

function effectiveLedgerDate(row: Row): string {
  if (row.source?.startsWith("ibkr_activity:") && ["buy", "sell"].includes(row.action)) {
    const date = new Date(`${row.date}T00:00:00Z`);
    // IBKR records Sunday-evening overnight executions under the US calendar
    // date, while Portfolio Analyst recognizes them on Monday's session.
    if (date.getUTCDay() === 0) {
      date.setUTCDate(date.getUTCDate() + 1);
      return date.toISOString().slice(0, 10);
    }
  }
  const statementDate = row.source?.match(/_statement_(\d{4}-\d{2}-\d{2})\.pdf/)?.[1];
  if (!statementDate || !row.instrument_id?.startsWith("US:")) return row.date;
  const dayDifference = (Date.parse(`${row.date}T00:00:00Z`) - Date.parse(`${statementDate}T00:00:00Z`)) / 86_400_000;
  return dayDifference === 1 ? statementDate : row.date;
}

export function replayLedgerDaily(transactions: Row[], splits: Row[], dates: string[]): DailyLedgerReplay {
  const cash = new Map<string, number>();
  const transit = new Map<string, number>();
  const cashEquivalents = new Map<string, number>();
  const quantities = new Map<string, number>();
  const subaccountId = (row: Row): string | undefined => row.note?.match(/INTER-ACCOUNT TRANSFER (?:TO|FROM) (\d+)/i)?.[1];
  const finalSubaccountRows = new Map<string, Row>();
  for (const row of transactions) {
    const id = subaccountId(row);
    if (!id || row.external_flow !== "false") continue;
    const key = `${id}|${row.currency}`;
    const current = finalSubaccountRows.get(key);
    if (!current || effectiveLedgerDate(row) > effectiveLedgerDate(current) || (effectiveLedgerDate(row) === effectiveLedgerDate(current) && row.transaction_id > current.transaction_id)) {
      finalSubaccountRows.set(key, row);
    }
  }
  const events = [
    ...transactions.map((row) => ({ kind: "transaction" as const, date: effectiveLedgerDate(row), row })),
    ...splits.map((row) => ({ kind: "split" as const, date: row.date, row })),
  ].sort((left, right) => left.date.localeCompare(right.date) || (left.kind === "split" ? -1 : 1));
  let cursor = 0;
  let transactionEventsApplied = 0;
  let splitEventsApplied = 0;
  const states: DailyLedgerState[] = [];
  for (const date of [...new Set(dates)].sort()) {
    while (cursor < events.length && events[cursor].date <= date) {
      const event = events[cursor++];
      const row = event.row;
      if (event.kind === "split") {
        const instrumentId = canonicalMarketInstrumentId(row.instrument_id);
        const ratio = Number(row.numerator) / Number(row.denominator);
        for (const [key, quantity] of quantities) {
          if (key.endsWith(`|${instrumentId}`)) quantities.set(key, quantity * ratio);
        }
        splitEventsApplied += 1;
        continue;
      }
      if (row.cash_amount !== "") {
        const key = `${row.account_id}|${row.currency}`;
        cash.set(key, (cash.get(key) ?? 0) + Number(row.cash_amount));
        const tracksPairedTransit = row.external_flow === "false" && /transit|migration/i.test(row.note ?? "");
        const tracksSubaccount = row.external_flow === "false" && /inter-account transfer/i.test(row.note ?? "");
        const tracksIpoApplication = row.external_flow === "false" && /IPO Application Amount/i.test(row.note ?? "");
        const closesIpoApplication = row.external_flow === "false" && /IPO Refund Amount/i.test(row.note ?? "");
        const bankTransitKey = `bank|${row.currency}`;
        const counterpartySubaccount = subaccountId(row);
        const subaccountTransitKey = `subaccount:${counterpartySubaccount ?? "unknown"}|${row.currency}`;
        const ipoTransitKey = `ipo|${row.currency}`;
        if (tracksPairedTransit && Number(row.cash_amount) < 0) {
          transit.set(bankTransitKey, (transit.get(bankTransitKey) ?? 0) - Number(row.cash_amount));
        } else if (tracksPairedTransit && row.action === "transfer_in") {
          // Each normalized arrival closes the currently outstanding tranche;
          // any shortfall is the transfer fee already reflected in cash.
          transit.set(bankTransitKey, 0);
        } else if (tracksSubaccount && Number(row.cash_amount) < 0) {
          transit.set(subaccountTransitKey, (transit.get(subaccountTransitKey) ?? 0) - Number(row.cash_amount));
        } else if (tracksSubaccount && row.action === "transfer_in") {
          const finalRow = counterpartySubaccount ? finalSubaccountRows.get(`${counterpartySubaccount}|${row.currency}`) : undefined;
          // A final return closes the child account. Any residual versus its
          // cash transfers is P&L generated inside that account, not an asset
          // that remains in transit.
          transit.set(subaccountTransitKey, finalRow === row ? 0 : (transit.get(subaccountTransitKey) ?? 0) - Number(row.cash_amount));
        } else if (tracksIpoApplication && Number(row.cash_amount) < 0) {
          transit.set(ipoTransitKey, (transit.get(ipoTransitKey) ?? 0) - Number(row.cash_amount));
        } else if (closesIpoApplication && Number(row.cash_amount) > 0) {
          transit.set(ipoTransitKey, 0);
        }
      }
      if (["buy", "sell", "adjustment_in", "adjustment_out"].includes(row.action) && row.quantity !== "") {
        const instrumentId = canonicalMarketInstrumentId(row.instrument_id);
        const key = `${row.account_id}|${instrumentId}`;
        if (CASH_EQUIVALENT_INSTRUMENTS.has(instrumentId) && (row.action === "buy" || row.action === "sell")) {
          const currentQuantity = quantities.get(key) ?? 0;
          const currentBookValue = cashEquivalents.get(key) ?? 0;
          if (row.action === "buy") cashEquivalents.set(key, currentBookValue - Number(row.cash_amount));
          else {
            const removedBookValue = currentQuantity > 1e-8
              ? currentBookValue * Math.min(1, Number(row.quantity) / currentQuantity)
              : Number(row.cash_amount);
            cashEquivalents.set(key, currentBookValue - removedBookValue);
          }
        }
        const direction = row.action === "buy" || row.action === "adjustment_in" ? 1 : -1;
        quantities.set(key, (quantities.get(key) ?? 0) + direction * Number(row.quantity));
      }
      transactionEventsApplied += 1;
    }
    states.push({ date, cash: Object.fromEntries(cash), transit: Object.fromEntries(transit), cashEquivalents: Object.fromEntries(cashEquivalents), quantities: Object.fromEntries(quantities) });
  }
  return { days: states.length, transactionEventsApplied, splitEventsApplied, states };
}

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
        const cashDate = effectiveLedgerDate(row);
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
