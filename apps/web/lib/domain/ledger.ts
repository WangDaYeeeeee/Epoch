import { createHash } from "node:crypto";
import { assertCurrency, assertIsoDate, type Currency } from "./conventions";

export type LedgerTrade = {
  externalId: string;
  date: string;
  instrumentId: string;
  quantity: number;
  priceCents: number;
  feeCents: number;
  currency: Currency;
};

export type LedgerCashFlow = {
  externalId: string;
  date: string;
  kind: "deposit" | "withdrawal";
  amountCents: number;
  currency: Currency;
};

export type PriceObservation = {
  date: string;
  instrumentId: string;
  closeCents: number;
  currency: Currency;
};

export type DailyLedgerSnapshot = {
  date: string;
  cashCents: number;
  marketValueCents: number;
  navCents: number;
  externalFlowCents: number;
  investmentPnlCents: number;
  reconciliationDifferenceCents: number;
  benchmarkIndex: number;
  positions: Record<string, number>;
};

export type LedgerCalculation = {
  inputHash: string;
  benchmark: string;
  currency: Currency;
  snapshots: DailyLedgerSnapshot[];
  health: { balanced: boolean; maxAbsoluteDifferenceCents: number };
};

function assertUniqueIds(items: Array<{ externalId: string }>, label: string): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.externalId)) throw new Error(`Duplicate ${label} external id: ${item.externalId}`);
    seen.add(item.externalId);
  }
}

function stableInputHash(trades: LedgerTrade[], flows: LedgerCashFlow[], prices: PriceObservation[]): string {
  const stable = [...trades.map((item) => ["trade", item]), ...flows.map((item) => ["flow", item]), ...prices.map((item) => ["price", item])]
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

export function calculateDailyLedger({ trades, flows, prices, benchmark }: {
  trades: LedgerTrade[];
  flows: LedgerCashFlow[];
  prices: PriceObservation[];
  benchmark: string;
}): LedgerCalculation {
  assertUniqueIds(trades, "trade");
  assertUniqueIds(flows, "cash flow");
  for (const item of [...trades, ...flows, ...prices]) {
    assertIsoDate(item.date);
    assertCurrency(item.currency);
    if (item.currency !== "USD") throw new Error("Phase 0 demo ledger requires USD inputs");
  }

  const dates = [...new Set(prices.map((item) => item.date))].sort();
  if (!dates.length) throw new Error("At least one price observation is required");
  const priceByDate = new Map<string, Map<string, number>>();
  for (const item of prices) {
    const daily = priceByDate.get(item.date) ?? new Map<string, number>();
    daily.set(item.instrumentId, item.closeCents);
    priceByDate.set(item.date, daily);
  }
  const benchmarkStart = priceByDate.get(dates[0])?.get(benchmark);
  if (!benchmarkStart) throw new Error(`Missing benchmark price for ${dates[0]}`);

  const positions = new Map<string, number>();
  const lastPrice = new Map<string, number>();
  let cashCents = 0;
  let previousNavCents = 0;
  const snapshots: DailyLedgerSnapshot[] = [];

  for (const date of dates) {
    const dailyPrices = priceByDate.get(date)!;
    const openingPositions = new Map(positions);
    const previousPrices = new Map(lastPrice);
    for (const [instrumentId, closeCents] of dailyPrices) lastPrice.set(instrumentId, closeCents);

    const dailyFlows = flows.filter((item) => item.date === date);
    const externalFlowCents = dailyFlows.reduce((sum, item) => sum + item.amountCents, 0);
    cashCents += externalFlowCents;

    let investmentPnlCents = 0;
    for (const [instrumentId, quantity] of openingPositions) {
      if (!quantity) continue;
      const close = lastPrice.get(instrumentId);
      const previousClose = previousPrices.get(instrumentId);
      if (close == null || previousClose == null) throw new Error(`Missing consecutive price for ${instrumentId} on ${date}`);
      investmentPnlCents += quantity * (close - previousClose);
    }

    for (const trade of trades.filter((item) => item.date === date)) {
      const close = lastPrice.get(trade.instrumentId);
      if (close == null) throw new Error(`Missing execution-date price for ${trade.instrumentId} on ${date}`);
      positions.set(trade.instrumentId, (positions.get(trade.instrumentId) ?? 0) + trade.quantity);
      cashCents -= trade.quantity * trade.priceCents + trade.feeCents;
      investmentPnlCents += trade.quantity * (close - trade.priceCents) - trade.feeCents;
    }

    let marketValueCents = 0;
    for (const [instrumentId, quantity] of positions) {
      if (!quantity) continue;
      const close = lastPrice.get(instrumentId);
      if (close == null) throw new Error(`Missing price for open position ${instrumentId} on ${date}`);
      marketValueCents += quantity * close;
    }
    const navCents = cashCents + marketValueCents;
    const expectedNavCents = previousNavCents + externalFlowCents + investmentPnlCents;
    const reconciliationDifferenceCents = navCents - expectedNavCents;
    const benchmarkClose = lastPrice.get(benchmark);
    if (!benchmarkClose) throw new Error(`Missing benchmark price for ${date}`);
    snapshots.push({
      date,
      cashCents,
      marketValueCents,
      navCents,
      externalFlowCents,
      investmentPnlCents,
      reconciliationDifferenceCents,
      benchmarkIndex: benchmarkClose / benchmarkStart,
      positions: Object.fromEntries([...positions.entries()].filter(([, quantity]) => quantity !== 0).sort(([left], [right]) => left.localeCompare(right))),
    });
    previousNavCents = navCents;
  }

  const maxAbsoluteDifferenceCents = Math.max(...snapshots.map((item) => Math.abs(item.reconciliationDifferenceCents)));
  return {
    inputHash: stableInputHash(trades, flows, prices),
    benchmark,
    currency: "USD",
    snapshots,
    health: { balanced: maxAbsoluteDifferenceCents === 0, maxAbsoluteDifferenceCents },
  };
}
