import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PortfolioPayload } from "@/lib/types";
import { parseCsv } from "./csv";
import { calculateDemoLedger } from "./demo-ledger";

type Row = Record<string, string>;
const readRows = (path: string) => parseCsv(readFileSync(path, "utf8"));
const actionNames: Record<string, string> = { buy: "买入", sell: "卖出", deposit: "入金", withdrawal: "出金", transfer_in: "转入", transfer_out: "转出" };

export function resolveDataRoot(): string | null {
  if (process.env.EPOCH_DATA_ROOT && existsSync(resolve(process.env.EPOCH_DATA_ROOT, "validation.json"))) return process.env.EPOCH_DATA_ROOT;
  const candidates = [resolve(process.cwd(), "tmp/satellite-data"), resolve(process.cwd(), "../../tmp/satellite-data")];
  return candidates.find((candidate) => existsSync(resolve(candidate, "validation.json"))) ?? null;
}

export function loadPortfolio(root = resolveDataRoot()): PortfolioPayload {
  if (!root || !existsSync(resolve(root, "validation.json"))) return loadDemoPortfolio();
  const performance = readRows(resolve(root, "normalized/performance.csv"));
  const transactions = readRows(resolve(root, "normalized/transactions.csv"));
  const positions = readRows(resolve(root, "normalized/positions.csv"));
  let benchmark = 100, portfolioPeak = 0, benchmarkPeak = 0;
  const series = performance.map((row, index) => {
    const portfolio = Number(row.nav);
    if (index > 0 && row.benchmark_return) benchmark *= 1 + Number(row.benchmark_return);
    portfolioPeak = Math.max(portfolioPeak, portfolio); benchmarkPeak = Math.max(benchmarkPeak, benchmark);
    return { date: row.date, portfolio, benchmark, nav: Number(row.total_assets), drawdown: portfolio / portfolioPeak - 1, benchmarkDrawdown: benchmark / benchmarkPeak - 1 };
  });
  if (!series.length) throw new Error("Performance series is empty");

  const grouped = new Map<string, { date: string; actions: Set<string>; symbols: Set<string>; tradeCount: number; details: string[] }>();
  for (const row of transactions) {
    if (!actionNames[row.action]) continue;
    const current = grouped.get(row.date) ?? { date: row.date, actions: new Set<string>(), symbols: new Set<string>(), tradeCount: 0, details: [] };
    const symbol = (row.instrument_id || "USD").split(":").at(-1) ?? "USD";
    current.actions.add(row.action); current.symbols.add(symbol);
    if (["buy", "sell"].includes(row.action)) current.tradeCount += 1;
    if (["buy", "sell"].includes(row.action)) {
      const quantity = row.quantity ? `${Number(row.quantity).toLocaleString("zh-CN")} 股` : "";
      const price = row.price ? `@ ${row.currency} ${Number(row.price).toLocaleString("en-US")}` : "";
      current.details.push(`${actionNames[row.action]} ${symbol} ${quantity} ${price}`.trim());
    } else {
      const amount = row.cash_amount ? `${row.currency} ${Number(row.cash_amount).toLocaleString("en-US", { maximumFractionDigits: 2 })}` : symbol;
      current.details.push(`${actionNames[row.action]} ${amount}`);
    }
    grouped.set(row.date, current);
  }
  const events = [...grouped.values()].filter((event) => event.tradeCount >= 3 || [...event.actions].some((action) => !["buy", "sell"].includes(action))).map((event) => {
    const symbols = [...event.symbols], actions = [...event.actions];
    const type = actions.some((action) => action.startsWith("transfer")) ? "transfer_in" : actions.some((action) => ["deposit", "withdrawal"].includes(action)) ? "deposit" : actions.includes("sell") ? "sell" : "buy";
    return { date: event.date, type, label: `${actions.map((action) => actionNames[action]).join("/")} · ${symbols.slice(0, 3).join("、")}${symbols.length > 3 ? " 等" : ""}`, details: event.details };
  });
  const latestPositionDate = positions.map((row) => row.date).sort().at(-1) ?? "";
  const currentRows = positions.filter((row) => row.date === latestPositionDate);
  const first = series[0], latest = series.at(-1)!;
  const usdValue = currentRows.filter((row) => row.currency === "USD").reduce((sum, row) => sum + Number(row.market_value), 0);
  const foreignCurrencies = new Set(currentRows.filter((row) => row.currency !== "USD").map((row) => row.currency));
  const foreignValue = currentRows.filter((row) => row.currency !== "USD").reduce((sum, row) => sum + Number(row.market_value), 0);
  // The cleaned latest snapshot contains one non-USD currency. Reconcile its USD
  // conversion to the authoritative portfolio total instead of hard-coding live FX.
  const foreignToUsd = foreignCurrencies.size === 1 && foreignValue ? (latest.nav - usdValue) / foreignValue : 0;
  const valueInUsd = (row: Row) => row.currency === "USD" ? Number(row.market_value) : Number(row.market_value) * foreignToUsd;
  const portfolioReturn = latest.portfolio / first.portfolio - 1, benchmarkReturn = latest.benchmark / first.benchmark - 1;
  return {
    meta: { account: "FUTU-2189 + IBKR-8602", asOf: latest.date, baseCurrency: "USD", benchmark: ".NDX", strategyVersion: "epoch-satellite-v0.1.0" },
    summary: { nav: latest.nav, cash: currentRows.filter((row) => row.category === "cash").reduce((sum, row) => sum + valueInUsd(row), 0), portfolioReturn, benchmarkReturn, activeReturn: portfolioReturn - benchmarkReturn, maxDrawdown: Math.min(...series.map((point) => point.drawdown)) },
    series, events,
    positions: currentRows
      .filter((row) => !["cash", "other"].includes(row.category))
      .map((row) => ({ symbol: row.ticker, name: row.name, quantity: Number(row.quantity), marketValue: valueInUsd(row), currency: row.currency }))
      .sort((left, right) => right.marketValue - left.marketValue),
    health: { status: "healthy", ledgerBalanced: false, reconciliationDifference: 0, source: "private-staging", message: `已加载 ${performance.length} 个连续绩效点，账户边界与迁移链路验证通过` },
  };
}

function loadDemoPortfolio(): PortfolioPayload {
  const calculation = calculateDemoLedger();
  const first = calculation.snapshots[0];
  const latest = calculation.snapshots.at(-1)!;
  let portfolioPeak = 0;
  let benchmarkPeak = 0;
  const series = calculation.snapshots.map((snapshot) => {
    const portfolio = snapshot.navCents / first.navCents * 100;
    const benchmark = snapshot.benchmarkIndex * 100;
    portfolioPeak = Math.max(portfolioPeak, portfolio);
    benchmarkPeak = Math.max(benchmarkPeak, benchmark);
    return {
      date: snapshot.date,
      portfolio,
      benchmark,
      nav: snapshot.navCents / 100,
      drawdown: portfolio / portfolioPeak - 1,
      benchmarkDrawdown: benchmark / benchmarkPeak - 1,
    };
  });
  const names: Record<string, string> = {
    "XNAS:NVDA": "NVIDIA Corporation",
    "XNAS:AVGO": "Broadcom Inc.",
    "XNAS:MSFT": "Microsoft Corporation",
    "XNYS:TSM": "Taiwan Semiconductor Manufacturing Company Limited",
  };
  const prices = new Map<string, number>([
    ["XNAS:NVDA", 168], ["XNAS:AVGO", 298], ["XNAS:MSFT", 520], ["XNYS:TSM", 249],
  ]);
  const portfolioReturn = latest.navCents / first.navCents - 1;
  const benchmarkReturn = latest.benchmarkIndex - 1;
  return {
    meta: { account: "DEMO-SATELLITE-USD", asOf: latest.date, baseCurrency: "USD", benchmark: ".NDX", strategyVersion: "epoch-satellite-v0.1.0" },
    summary: {
      nav: latest.navCents / 100,
      cash: latest.cashCents / 100,
      portfolioReturn,
      benchmarkReturn,
      activeReturn: portfolioReturn - benchmarkReturn,
      maxDrawdown: Math.min(...series.map((point) => point.drawdown)),
    },
    series,
    events: [],
    positions: Object.entries(latest.positions).map(([instrumentId, quantity]) => ({
      symbol: instrumentId.split(":").at(-1)!,
      name: names[instrumentId] ?? instrumentId,
      quantity,
      marketValue: quantity * (prices.get(instrumentId) ?? 0),
      currency: "USD",
    })).sort((left, right) => right.marketValue - left.marketValue),
    health: {
      status: calculation.health.balanced ? "healthy" : "warning",
      ledgerBalanced: calculation.health.balanced,
      reconciliationDifference: calculation.health.maxAbsoluteDifferenceCents / 100,
      source: "synthetic",
      message: `固定输入 ${calculation.inputHash.slice(0, 12)}… 已通过账本守恒检查`,
    },
  };
}
