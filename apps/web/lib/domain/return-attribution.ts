import type { DailyLedgerState } from "./ledger-replay";
import { canonicalMarketInstrumentId } from "./market-data";

type Row = Record<string, string>;

export type ReturnAttribution = {
  dateFrom: string;
  dateTo: string;
  beginningNavUsd: number;
  portfolioPnlUsd: number;
  explainedPnlUsd: number;
  residualPnlUsd: number;
  explainedRatio: number;
  securities: {
    instrumentId: string;
    pnlUsd: number;
  }[];
  cashIncomePnlUsd: number;
  residuals: {
    reason: string;
    pnlUsd: number;
    days: number;
  }[];
  largestResidualDays: {
    date: string;
    reason: string;
    pnlUsd: number;
    actions: string[];
  }[];
};

const suffix = (key: string): string => key.slice(key.indexOf("|") + 1);

const quantities = (state: DailyLedgerState): Map<string, number> => {
  const result = new Map<string, number>();
  for (const [key, quantity] of Object.entries(state.quantities)) {
    const instrumentId = canonicalMarketInstrumentId(suffix(key));
    result.set(instrumentId, (result.get(instrumentId) ?? 0) + quantity);
  }
  return result;
};

const cashBalances = (state: DailyLedgerState): Map<string, number> => {
  const result = new Map<string, number>();
  for (const [key, amount] of Object.entries(state.cash)) {
    const currency = suffix(key);
    result.set(currency, (result.get(currency) ?? 0) + amount);
  }
  for (const [key, amount] of Object.entries(state.transit)) {
    if (key.startsWith("subaccount:")) continue;
    const currency = suffix(key);
    result.set(currency, (result.get(currency) ?? 0) + amount);
  }
  return result;
};

export function attributePortfolioReturns(input: {
  states: DailyLedgerState[];
  prices: Row[];
  transactions: Row[];
  performance: Row[];
  splits: Row[];
  residualReasonsByDate?: Record<string, string[]>;
}): ReturnAttribution {
  const performance = new Map(input.performance.map((row) => [row.date, row]));
  const pricesByDate = new Map<string, Row[]>();
  const currencyByInstrument = new Map<string, string>();
  for (const row of input.prices) {
    const instrumentId = canonicalMarketInstrumentId(row.instrument_id);
    const daily = pricesByDate.get(row.date) ?? [];
    daily.push({ ...row, instrument_id: instrumentId });
    pricesByDate.set(row.date, daily);
    currencyByInstrument.set(instrumentId, row.currency);
  }
  const splitHistory = new Map<string, { date: string; ratio: number }[]>();
  for (const row of input.splits) {
    const instrumentId = canonicalMarketInstrumentId(row.instrument_id);
    const history = splitHistory.get(instrumentId) ?? [];
    history.push({ date: row.date, ratio: Number(row.numerator) / Number(row.denominator) });
    splitHistory.set(instrumentId, history);
  }
  const futureSplitMultiplier = (instrumentId: string, date: string): number =>
    (splitHistory.get(instrumentId) ?? [])
      .filter((split) => split.date > date)
      .reduce((product, split) => product * split.ratio, 1);
  // A priced non-trade adjustment (for example an IPO allotment) establishes
  // a defensible cost anchor before the instrument has its first market close.
  // Do not seed ordinary buys/sells here: an execution price is not a close.
  for (const row of input.transactions) {
    if (!["adjustment_in", "adjustment_out"].includes(row.action) || !row.instrument_id || !row.price) continue;
    const instrumentId = canonicalMarketInstrumentId(row.instrument_id);
    const daily = pricesByDate.get(row.date) ?? [];
    if (daily.some((price) => price.instrument_id === instrumentId)) continue;
    daily.push({
      date: row.date,
      instrument_id: instrumentId,
      close: String(Number(row.price) / futureSplitMultiplier(instrumentId, row.date)),
      currency: row.currency,
    });
    pricesByDate.set(row.date, daily);
    currencyByInstrument.set(instrumentId, row.currency);
  }
  const transactionsByDate = new Map<string, Row[]>();
  for (const row of input.transactions) {
    const daily = transactionsByDate.get(row.date) ?? [];
    daily.push(row);
    transactionsByDate.set(row.date, daily);
  }

  const latestPrice = new Map<string, number>();
  const previousPrice = new Map<string, number>();
  const securityPnl = new Map<string, number>();
  let portfolioPnlUsd = 0;
  let cashIncomePnlUsd = 0;
  let explainedPnlUsd = 0;
  const residuals = new Map<string, { pnlUsd: number; days: number }>();
  const residualDays: ReturnAttribution["largestResidualDays"] = [];

  for (let index = 0; index < input.states.length; index += 1) {
    const state = input.states[index];
    for (const [instrumentId, close] of latestPrice) previousPrice.set(instrumentId, close);
    for (const row of pricesByDate.get(state.date) ?? []) latestPrice.set(row.instrument_id, Number(row.close));
    if (index === 0) continue;
    const currentPerformance = performance.get(state.date);
    const previousPerformance = performance.get(input.states[index - 1].date);
    if (!currentPerformance || !previousPerformance) continue;
    const dailyPortfolioPnl = Number(currentPerformance.total_assets)
      - Number(previousPerformance.total_assets)
      - Number(currentPerformance.net_external_flow);
    portfolioPnlUsd += dailyPortfolioPnl;
    const previousQuantities = quantities(input.states[index - 1]);
    let dailyExplained = 0;

    for (const [currency, amount] of cashBalances(input.states[index - 1])) {
      if (currency === "USD") continue;
      const currentFx = latestPrice.get(`FX:${currency}USD`);
      const priorFx = previousPrice.get(`FX:${currency}USD`);
      if (currentFx == null || priorFx == null) continue;
      const pnl = amount * (currentFx - priorFx);
      const instrumentId = `CASH:${currency}`;
      securityPnl.set(instrumentId, (securityPnl.get(instrumentId) ?? 0) + pnl);
      dailyExplained += pnl;
    }

    for (const [instrumentId, rawQuantity] of previousQuantities) {
      const currency = currencyByInstrument.get(instrumentId);
      const currentClose = latestPrice.get(instrumentId);
      const priorClose = previousPrice.get(instrumentId);
      if (!currency || currentClose == null || priorClose == null) continue;
      const currentFx = currency === "USD" ? 1 : latestPrice.get(`FX:${currency}USD`);
      const priorFx = currency === "USD" ? 1 : previousPrice.get(`FX:${currency}USD`);
      if (currentFx == null || priorFx == null) continue;
      // Yahoo's stored historical closes are adjusted into the latest share
      // units. Convert the historical ledger quantity into those same units
      // using splits that occur after the opening state.
      const adjustedQuantity = rawQuantity * futureSplitMultiplier(instrumentId, input.states[index - 1].date);
      const pnl = adjustedQuantity * (currentClose * currentFx - priorClose * priorFx);
      securityPnl.set(instrumentId, (securityPnl.get(instrumentId) ?? 0) + pnl);
      dailyExplained += pnl;
    }

    const dailyTransactions = transactionsByDate.get(state.date) ?? [];
    const closeFreeRoundTrips = new Map<string, number>();
    const tradesByInstrument = new Map<string, Row[]>();
    for (const row of dailyTransactions) {
      if (!["buy", "sell"].includes(row.action) || !row.instrument_id || !row.quantity) continue;
      const instrumentId = canonicalMarketInstrumentId(row.instrument_id);
      if (latestPrice.has(instrumentId)) continue;
      const trades = tradesByInstrument.get(instrumentId) ?? [];
      trades.push(row);
      tradesByInstrument.set(instrumentId, trades);
    }
    for (const [instrumentId, trades] of tradesByInstrument) {
      const netQuantity = trades.reduce(
        (sum, row) => sum + (row.action === "buy" ? 1 : -1) * Number(row.quantity),
        0,
      );
      const hasFxForEveryTrade = trades.every(
        (row) => row.currency === "USD" || latestPrice.has(`FX:${row.currency}USD`),
      );
      if (Math.abs(netQuantity) > 1e-8 || !hasFxForEveryTrade || trades.some((row) => row.cash_amount === "")) continue;
      const pnl = trades.reduce((sum, row) => {
        const fx = row.currency === "USD" ? 1 : latestPrice.get(`FX:${row.currency}USD`);
        return fx == null ? sum : sum + Number(row.cash_amount) * fx;
      }, 0);
      closeFreeRoundTrips.set(instrumentId, pnl);
      securityPnl.set(instrumentId, (securityPnl.get(instrumentId) ?? 0) + pnl);
      dailyExplained += pnl;
    }

    for (const row of dailyTransactions) {
      const currency = row.currency;
      const fx = currency === "USD" ? 1 : latestPrice.get(`FX:${currency}USD`);
      if (fx == null) continue;
      if (["buy", "sell"].includes(row.action) && row.instrument_id && row.quantity && row.price) {
        const instrumentId = canonicalMarketInstrumentId(row.instrument_id);
        if (closeFreeRoundTrips.has(instrumentId)) continue;
        const close = latestPrice.get(instrumentId);
        if (close != null) {
          const splitMultiplier = futureSplitMultiplier(instrumentId, state.date);
          const adjustedQuantity = Number(row.quantity) * splitMultiplier;
          const adjustedExecutionPrice = Number(row.price) / splitMultiplier;
          const direction = row.action === "buy" ? 1 : -1;
          const pnl = direction * adjustedQuantity * (close - adjustedExecutionPrice) * fx
            - Math.abs(Number(row.fees || 0)) * fx - Math.abs(Number(row.tax || 0)) * fx;
          securityPnl.set(instrumentId, (securityPnl.get(instrumentId) ?? 0) + pnl);
          dailyExplained += pnl;
        }
      } else if (["dividend", "interest", "fee", "tax"].includes(row.action) && row.cash_amount) {
        const pnl = Number(row.cash_amount) * fx;
        cashIncomePnlUsd += pnl;
        dailyExplained += pnl;
      }
    }
    explainedPnlUsd += dailyExplained;
    const dailyResidual = dailyPortfolioPnl - dailyExplained;
    const reasons = input.residualReasonsByDate?.[state.date]?.filter(Boolean).sort() ?? [];
    const reason = reasons.length ? reasons.join(" + ") : "UNEXPLAINED_MODEL_RESIDUAL";
    const bucket = residuals.get(reason) ?? { pnlUsd: 0, days: 0 };
    bucket.pnlUsd += dailyResidual;
    bucket.days += 1;
    residuals.set(reason, bucket);
    residualDays.push({
      date: state.date,
      reason,
      pnlUsd: dailyResidual,
      actions: [...new Set((transactionsByDate.get(state.date) ?? []).map((row) => row.action))].sort(),
    });
  }

  const firstPerformance = input.performance[0];
  const beginningNavUsd = Number(firstPerformance?.total_assets ?? 0);
  const residualPnlUsd = portfolioPnlUsd - explainedPnlUsd;
  return {
    dateFrom: input.states[0]?.date ?? "",
    dateTo: input.states.at(-1)?.date ?? "",
    beginningNavUsd,
    portfolioPnlUsd,
    explainedPnlUsd,
    residualPnlUsd,
    explainedRatio: Math.abs(portfolioPnlUsd) > 1e-8
      ? Math.max(0, 1 - Math.abs(residualPnlUsd) / Math.abs(portfolioPnlUsd))
      : Math.abs(residualPnlUsd) <= 1e-8 ? 1 : 0,
    securities: [...securityPnl.entries()]
      .map(([instrumentId, pnlUsd]) => ({ instrumentId, pnlUsd }))
      .sort((left, right) => Math.abs(right.pnlUsd) - Math.abs(left.pnlUsd) || left.instrumentId.localeCompare(right.instrumentId)),
    cashIncomePnlUsd,
    residuals: [...residuals.entries()]
      .map(([reason, value]) => ({ reason, ...value }))
      .sort((left, right) => Math.abs(right.pnlUsd) - Math.abs(left.pnlUsd) || left.reason.localeCompare(right.reason)),
    largestResidualDays: residualDays
      .sort((left, right) => Math.abs(right.pnlUsd) - Math.abs(left.pnlUsd) || left.date.localeCompare(right.date))
      .slice(0, 10),
  };
}
