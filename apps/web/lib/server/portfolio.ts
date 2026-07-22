import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Sql } from "postgres";
import type { PortfolioPayload } from "@/lib/types";
import { calculateMoneyWeightedReturn, performanceCashFlows } from "../domain/performance";
import { marketDataRequirement } from "../domain/market-data";
import { loadBaselineDataset, reconcileEventCoverage, reconcilePerformanceReturns, reconcilePositionQuantities, reconcileReportedValuations, type EventCoverage, type PositionReconciliation, type ValuationCoverage } from "./baseline-data";
import { parseCsv } from "./csv";
import { createDatabaseClient } from "./database";
import { calculateDemoLedger } from "./demo-ledger";

type Row = Record<string, string>;
type PrivatePortfolioRows = { performance: Row[]; transactions: Row[]; positions: Row[] };
const readRows = (path: string) => parseCsv(readFileSync(path, "utf8"));
const actionNames: Record<string, string> = { buy: "买入", sell: "卖出", deposit: "入金", withdrawal: "出金", transfer_in: "转入", transfer_out: "转出", adjustment_in: "资产调增", adjustment_out: "资产调减" };

export function resolveDataRoot(): string | null {
  if (process.env.EPOCH_DATA_ROOT && existsSync(resolve(process.env.EPOCH_DATA_ROOT, "validation.json"))) return process.env.EPOCH_DATA_ROOT;
  const candidates = [resolve(process.cwd(), "tmp/satellite-data"), resolve(process.cwd(), "../../tmp/satellite-data")];
  return candidates.find((candidate) => existsSync(resolve(candidate, "validation.json"))) ?? null;
}

export function loadPortfolio(root = resolveDataRoot()): PortfolioPayload {
  if (!root || !existsSync(resolve(root, "validation.json"))) return loadDemoPortfolio();
  const baseline = loadBaselineDataset(root);
  return buildPrivatePortfolio({
    performance: readRows(resolve(root, "normalized/performance.csv")),
    transactions: readRows(resolve(root, "normalized/transactions.csv")),
    positions: readRows(resolve(root, "normalized/positions.csv")),
  }, {
    source: "private-staging",
    healthy: baseline.healthy,
    message: baseline.healthy
      ? `已验证 ${baseline.rows["performance.csv"].length} 个连续绩效点与完整净值链；逐日账本对账待价格、汇率与公司行动补齐`
      : `基线数据存在 ${baseline.checks.filter((check) => check.status === "failed").length} 项校验失败`,
    positionReconciliation: baseline.positionReconciliation,
    assetReturnsReconciled: baseline.checks.some((check) => check.name === "performance:asset-return-reconciliation" && check.status === "passed"),
    eventCoverage: reconcileEventCoverage(baseline.rows["transactions.csv"]),
    valuationCoverage: baseline.valuationCoverage,
    marketDataRequirement: baseline.marketDataRequirement,
    marketDataCoverage: baseline.marketDataCoverage,
    ledgerReplayReadiness: baseline.ledgerReplayReadiness,
    cashEndpointReconciliation: baseline.cashEndpointReconciliation,
  });
}

function buildPrivatePortfolio({ performance, transactions, positions }: PrivatePortfolioRows, health: {
  source: string;
  healthy: boolean;
  message: string;
  positionReconciliation?: PositionReconciliation;
  assetReturnsReconciled?: boolean;
  eventCoverage?: EventCoverage;
  valuationCoverage?: ValuationCoverage;
  marketDataRequirement?: PortfolioPayload["health"]["marketDataRequirement"];
  marketDataCoverage?: PortfolioPayload["health"]["marketDataCoverage"];
  ledgerReplayReadiness?: PortfolioPayload["health"]["ledgerReplayReadiness"];
  cashEndpointReconciliation?: PortfolioPayload["health"]["cashEndpointReconciliation"];
}): PortfolioPayload {
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
  const moneyWeightedReturn = calculateMoneyWeightedReturn(performanceCashFlows(performance.map((row) => ({
    date: row.date, total_assets: row.total_assets, net_external_flow: row.net_external_flow,
  }))));
  return {
    meta: { account: "FUTU-2189 + IBKR-8602", asOf: latest.date, baseCurrency: "USD", benchmark: ".NDX", strategyVersion: "epoch-satellite-v0.1.0" },
    summary: { nav: latest.nav, cash: currentRows.filter((row) => row.category === "cash").reduce((sum, row) => sum + valueInUsd(row), 0), portfolioReturn, benchmarkReturn, activeReturn: portfolioReturn - benchmarkReturn, maxDrawdown: Math.min(...series.map((point) => point.drawdown)), moneyWeightedReturn: moneyWeightedReturn?.annualized, cumulativeMoneyWeightedReturn: moneyWeightedReturn?.cumulative },
    series, events,
    positions: currentRows
      .filter((row) => !["cash", "other"].includes(row.category))
      .map((row) => ({ symbol: row.ticker, name: row.name, quantity: Number(row.quantity), marketValue: valueInUsd(row), currency: row.currency }))
      .sort((left, right) => right.marketValue - left.marketValue),
    health: {
      status: health.healthy ? "healthy" : "warning",
      ledgerBalanced: false,
      reconciliationDifference: 0,
      source: health.source,
      message: health.message,
      positionReconciliation: health.positionReconciliation,
      assetReturnsReconciled: health.assetReturnsReconciled,
      eventCoverage: health.eventCoverage,
      valuationCoverage: health.valuationCoverage,
      marketDataRequirement: health.marketDataRequirement,
      marketDataCoverage: health.marketDataCoverage,
      ledgerReplayReadiness: health.ledgerReplayReadiness,
      cashEndpointReconciliation: health.cashEndpointReconciliation,
    },
  };
}

export async function loadPortfolioFromDatabase(sql: Sql): Promise<PortfolioPayload | null> {
  return sql.begin(async (transaction) => {
    const performance = await transaction<Row[]>`
      SELECT snapshot_date::text AS date, portfolio_id, total_assets::text, COALESCE(cash::text, '') AS cash,
             net_external_flow::text, currency, nav::text, COALESCE(period_return::text, '') AS period_return,
             benchmark, COALESCE(benchmark_return::text, '') AS benchmark_return, source,
             COALESCE(external_flow_weight::text, '') AS external_flow_weight
      FROM reported_performance_snapshot
      WHERE raw_import_id = (
        SELECT id FROM raw_import
        WHERE source = 'normalized_satellite_baseline' AND source_id = 'normalized/performance.csv'
        ORDER BY recorded_at DESC, id DESC LIMIT 1
      )
      ORDER BY snapshot_date
    `;
    if (!performance.length) return null;
    const transactions = await transaction<Row[]>`
      SELECT transaction_id, effective_date::text AS date, account_id, COALESCE(instrument_id, '') AS instrument_id,
             action, COALESCE(quantity::text, '') AS quantity, COALESCE(price::text, '') AS price, currency,
             COALESCE(fees::text, '') AS fees, COALESCE(tax::text, '') AS tax,
             COALESCE(cash_amount::text, '') AS cash_amount, external_flow::text, source, COALESCE(note, '') AS note
      FROM normalized_ledger_event
      WHERE raw_import_id = (
        SELECT id FROM raw_import
        WHERE source = 'normalized_satellite_baseline' AND source_id = 'normalized/transactions.csv'
        ORDER BY recorded_at DESC, id DESC LIMIT 1
      )
      ORDER BY effective_date, transaction_id
    `;
    const positions = await transaction<Row[]>`
      SELECT snapshot_date::text AS date, account_id, instrument_id, ticker, name, category,
             quantity::text, price::text, market_value::text, currency, COALESCE(cost_basis::text, '') AS cost_basis,
             COALESCE(fx_to_cny::text, '') AS fx_to_cny, COALESCE(market_value_cny::text, '') AS market_value_cny,
             COALESCE(base_currency, '') AS base_currency, COALESCE(fx_to_base::text, '') AS fx_to_base,
             COALESCE(market_value_base::text, '') AS market_value_base, source
      FROM reported_position_snapshot
      WHERE raw_import_id = (
        SELECT id FROM raw_import
        WHERE source = 'normalized_satellite_baseline' AND source_id = 'normalized/positions.csv'
        ORDER BY recorded_at DESC, id DESC LIMIT 1
      )
      ORDER BY snapshot_date, account_id, instrument_id
    `;
    const positionReconciliation = reconcilePositionQuantities(transactions, positions);
    const performanceReconciliation = reconcilePerformanceReturns(performance);
    const eventCoverage = reconcileEventCoverage(transactions);
    const valuationCoverage = reconcileReportedValuations(positions);
    const requirement = marketDataRequirement(transactions, performance);
    const dataRoot = resolveDataRoot();
    const stagedBaseline = dataRoot ? loadBaselineDataset(dataRoot) : null;
    return buildPrivatePortfolio({ performance, transactions, positions }, {
      source: "database-baseline",
      healthy: true,
      message: `PostgreSQL 已加载 ${transactions.length} 条账本事件、${positions.length} 条持仓快照和 ${performance.length} 个连续绩效点；仓位数量 ${positionReconciliation.matched}/${positionReconciliation.comparisons} 项吻合，${positionReconciliation.differences.length} 项待解释（已处理 ${positionReconciliation.timezoneAdjustedTransactions} 笔跨时区边界交易）`,
      positionReconciliation,
      assetReturnsReconciled: performanceReconciliation.assetReturnsReconciled,
      eventCoverage,
      valuationCoverage,
      marketDataRequirement: requirement,
      marketDataCoverage: stagedBaseline?.marketDataCoverage,
      ledgerReplayReadiness: stagedBaseline?.ledgerReplayReadiness,
      cashEndpointReconciliation: stagedBaseline?.cashEndpointReconciliation,
    });
  });
}

export async function loadPortfolioPreferDatabase(): Promise<PortfolioPayload> {
  const sql = createDatabaseClient();
  try {
    return await loadPortfolioFromDatabase(sql) ?? loadPortfolio();
  } catch {
    const fallback = loadPortfolio();
    return {
      ...fallback,
      health: {
        ...fallback.health,
        status: "warning",
        message: `PostgreSQL 暂不可用，已降级读取${fallback.health.source === "private-staging" ? "本地清洗基线" : "合成数据"}；${fallback.health.message}`,
      },
    };
  } finally {
    await sql.end();
  }
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
