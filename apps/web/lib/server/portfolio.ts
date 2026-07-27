import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Sql } from "postgres";
import type { PortfolioPayload, PortfolioRiskSnapshot } from "@/lib/types";
import { checkIbkrReadOnlyConnection } from "../connectors/ibkr-web";
import { buildExposureSnapshot, type InstrumentClassification } from "../domain/exposure";
import { calculateRiskDrift } from "../domain/risk-drift";
import { buildOperationsSnapshot, mergeOperationItems } from "../domain/operations";
import { PostgresEventHorizonRepository } from "./event-horizon";
import { PostgresDecisionJournalRepository } from "./decision-journal";
import { discoverHeldFunds, holdingsClassifications, selectFundHoldingsSnapshot } from "../domain/fund-holdings";
import { INSTRUMENT_CLASSIFICATION_VERSION, instrumentClassifications } from "../domain/instrument-classifications";
import { calculateMoneyWeightedReturn, performanceCashFlows } from "../domain/performance";
import { marketDataRequirement } from "../domain/market-data";
import { loadBaselineDataset, reconcileEventCoverage, reconcilePerformanceReturns, reconcilePositionQuantities, reconcileReportedValuations, type EventCoverage, type PositionReconciliation, type ValuationCoverage } from "./baseline-data";
import { parseCsv } from "./csv";
import { createDatabaseClient } from "./database";
import { calculateDemoLedger } from "./demo-ledger";
import { PostgresFundHoldingsRepository } from "./fund-holdings-sync";
import { PostgresCalculationRunRepository, type CalculationRunRecord } from "./calculation-run";
import { PostgresRiskDriftAnchorRepository } from "./risk-drift-anchor";
import { PostgresOperationsRepository } from "./operations";
import { PostgresQualityMetricsRepository } from "./quality-metrics";
import { PostgresDataSourceHealthRepository } from "./data-source-health";
import { PostgresMarketSignalRepository } from "./market-signal";

type Row = Record<string, string>;
type PrivatePortfolioRows = { performance: Row[]; transactions: Row[]; positions: Row[] };
const readRows = (path: string) => parseCsv(readFileSync(path, "utf8"));
const actionNames: Record<string, string> = { buy: "买入", sell: "卖出", deposit: "入金", withdrawal: "出金", transfer_in: "转入", transfer_out: "转出", adjustment_in: "资产调增", adjustment_out: "资产调减" };

function riskSnapshot(record: CalculationRunRecord, dataStatus: "fresh" | "stale"): PortfolioPayload["risk"] {
  if (!record.response || !["succeeded", "degraded"].includes(record.response.status)) return undefined;
  const output = record.response.output as {
    portfolio?: PortfolioRiskSnapshot["portfolio"];
    instruments?: PortfolioRiskSnapshot["instruments"];
    policyGate?: PortfolioRiskSnapshot["policyGate"];
  };
  if (
    !output.portfolio || !Array.isArray(output.instruments) || !output.policyGate
    || !Number.isFinite(output.portfolio.volatilityAnnualized)
    || !Number.isFinite(output.portfolio.stressVolatilityAnnualized)
    || !Number.isFinite(output.policyGate.limitAnnualized)
  ) return undefined;
  const diagnostics = record.response.diagnostics as Partial<NonNullable<PortfolioRiskSnapshot["modelDiagnostics"]>>;
  const modelDiagnostics = (
    typeof diagnostics.semivarianceResolution === "string"
    && typeof diagnostics.ivInputStatus === "string"
    && Array.isArray(diagnostics.forecasts)
    && Array.isArray(diagnostics.historicalCrashWeeks)
    && Array.isArray(diagnostics.correlationClusters)
    && diagnostics.divergence
  ) ? diagnostics as PortfolioRiskSnapshot["modelDiagnostics"] : undefined;
  return {
    calculationId: record.id,
    asOf: record.asOf,
    inputHash: record.inputHash,
    status: record.response.status as "succeeded" | "degraded",
    modelVersion: record.response.modelVersion,
    dataStatus,
    portfolio: output.portfolio,
    instruments: output.instruments,
    policyGate: output.policyGate,
    ...(modelDiagnostics ? { modelDiagnostics } : {}),
    warnings: record.response.warnings,
  };
}

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
    ledgerBalanced: baseline.ledgerReconciled,
    reconciliationDifference: baseline.dailyLedgerValuation.maxAbsoluteDifferenceUsd,
    message: baseline.healthy
      ? `已回放 ${baseline.dailyLedgerReplay.days} 天与 ${baseline.dailyLedgerReplay.transactionEventsApplied} 条事件；${baseline.dailyLedgerValuation.accountedDays}/${baseline.dailyLedgerValuation.totalDays} 天估值已入账（${baseline.dailyLedgerValuation.valuedDays} 天独立估值，${baseline.dailyLedgerValuation.residualBridgeDays} 天残差桥接）`
      : `基线数据存在 ${baseline.checks.filter((check) => check.status === "failed").length} 项校验失败`,
    positionReconciliation: baseline.positionReconciliation,
    assetReturnsReconciled: baseline.checks.some((check) => check.name === "performance:asset-return-reconciliation" && check.status === "passed"),
    eventCoverage: reconcileEventCoverage(baseline.rows["transactions.csv"]),
    valuationCoverage: baseline.valuationCoverage,
    marketDataRequirement: baseline.marketDataRequirement,
    marketDataCoverage: baseline.marketDataCoverage,
    marketDataFreshness: baseline.marketDataFreshness,
    marketBarCoverage: baseline.marketBarCoverage,
    ledgerReplayReadiness: baseline.ledgerReplayReadiness,
    cashEndpointReconciliation: baseline.cashEndpointReconciliation,
    dailyLedgerReplay: baseline.dailyLedgerReplay,
    dailyLedgerValuation: baseline.dailyLedgerValuation,
    returnAttribution: baseline.returnAttribution,
  });
}

function buildPrivatePortfolio({ performance, transactions, positions }: PrivatePortfolioRows, health: {
  source: string;
  healthy: boolean;
  ledgerBalanced?: boolean;
  reconciliationDifference?: number;
  message: string;
  positionReconciliation?: PositionReconciliation;
  assetReturnsReconciled?: boolean;
  eventCoverage?: EventCoverage;
  valuationCoverage?: ValuationCoverage;
  marketDataRequirement?: PortfolioPayload["health"]["marketDataRequirement"];
  marketDataCoverage?: PortfolioPayload["health"]["marketDataCoverage"];
  marketDataFreshness?: PortfolioPayload["health"]["marketDataFreshness"];
  marketBarCoverage?: PortfolioPayload["health"]["marketBarCoverage"];
  ledgerReplayReadiness?: PortfolioPayload["health"]["ledgerReplayReadiness"];
  cashEndpointReconciliation?: PortfolioPayload["health"]["cashEndpointReconciliation"];
  dailyLedgerReplay?: PortfolioPayload["health"]["dailyLedgerReplay"];
  dailyLedgerValuation?: PortfolioPayload["health"]["dailyLedgerValuation"];
  returnAttribution?: PortfolioPayload["returnAttribution"];
}, additionalClassifications: InstrumentClassification[] = []): PortfolioPayload {
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
  const valueInUsd = (row: Row) => row.market_value_base
    ? Number(row.market_value_base)
    : row.currency === "USD" ? Number(row.market_value) : Number(row.market_value) * foreignToUsd;
  const portfolioReturn = latest.portfolio / first.portfolio - 1, benchmarkReturn = latest.benchmark / first.benchmark - 1;
  const moneyWeightedReturn = calculateMoneyWeightedReturn(performanceCashFlows(performance.map((row) => ({
    date: row.date, total_assets: row.total_assets, net_external_flow: row.net_external_flow,
  }))));
  const currentPositions = currentRows
    .filter((row) => !["cash", "other"].includes(row.category))
    .map((row) => ({ instrumentId: row.instrument_id, symbol: row.ticker, name: row.name, quantity: Number(row.quantity), marketValue: valueInUsd(row), currency: row.currency, assetClass: row.category }))
    .sort((left, right) => right.marketValue - left.marketValue);
  const exposure = buildExposureSnapshot(currentPositions.map((position) => ({
    instrumentId: position.instrumentId,
    marketValueUsd: position.marketValue,
    currency: position.currency,
    assetClass: position.assetClass,
  })), [...instrumentClassifications, ...additionalClassifications]);
  return {
    meta: { account: "FUTU-2189 + IBKR-8602", asOf: latest.date, baseCurrency: "USD", benchmark: ".NDX", strategyVersion: "epoch-satellite-v0.1.0", classificationVersion: INSTRUMENT_CLASSIFICATION_VERSION },
    summary: { nav: latest.nav, cash: currentRows.filter((row) => row.category === "cash").reduce((sum, row) => sum + valueInUsd(row), 0), portfolioReturn, benchmarkReturn, activeReturn: portfolioReturn - benchmarkReturn, maxDrawdown: Math.min(...series.map((point) => point.drawdown)), moneyWeightedReturn: moneyWeightedReturn?.annualized, cumulativeMoneyWeightedReturn: moneyWeightedReturn?.cumulative },
    series, events,
    positions: currentPositions,
    exposure,
    returnAttribution: health.returnAttribution,
    health: {
      status: health.healthy && health.marketDataFreshness?.status !== "stale" && health.marketDataFreshness?.status !== "missing" ? "healthy" : "warning",
      ledgerBalanced: health.ledgerBalanced ?? false,
      reconciliationDifference: health.reconciliationDifference ?? 0,
      source: health.source,
      message: health.message,
      positionReconciliation: health.positionReconciliation,
      assetReturnsReconciled: health.assetReturnsReconciled,
      eventCoverage: health.eventCoverage,
      valuationCoverage: health.valuationCoverage,
      marketDataRequirement: health.marketDataRequirement,
      marketDataCoverage: health.marketDataCoverage,
      marketDataFreshness: health.marketDataFreshness,
      marketBarCoverage: health.marketBarCoverage,
      ledgerReplayReadiness: health.ledgerReplayReadiness,
      cashEndpointReconciliation: health.cashEndpointReconciliation,
      dailyLedgerReplay: health.dailyLedgerReplay,
      dailyLedgerValuation: health.dailyLedgerValuation,
    },
  };
}

export async function loadPortfolioFromDatabase(sql: Sql): Promise<PortfolioPayload | null> {
  const payload = await sql.begin(async (transaction) => {
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
    const latestPositionDate = positions.map((row) => row.date).sort().at(-1) ?? "";
    const currentPositionRows = positions.filter((row) => row.date === latestPositionDate);
    const heldFunds = discoverHeldFunds(currentPositionRows.map((row) => ({
      instrumentId: row.instrument_id,
      assetClass: row.category,
      quantity: Number(row.quantity),
    })));
    const fundSnapshots = await new PostgresFundHoldingsRepository(sql).load(heldFunds);
    const fundSelections = new Map(heldFunds.map((fundInstrumentId) => [
      fundInstrumentId,
      selectFundHoldingsSnapshot(
        fundSnapshots.filter((snapshot) => snapshot.fundInstrumentId === fundInstrumentId),
        latestPositionDate,
        Number(process.env.ETF_HOLDINGS_MAX_AGE_DAYS ?? 90),
      ),
    ]));
    return buildPrivatePortfolio({ performance, transactions, positions }, {
      source: "database-baseline",
      healthy: true,
      ledgerBalanced: stagedBaseline?.ledgerReconciled ?? false,
      reconciliationDifference: stagedBaseline?.dailyLedgerValuation.maxAbsoluteDifferenceUsd ?? 0,
      message: `PostgreSQL 已加载 ${transactions.length} 条账本事件、${positions.length} 条持仓快照和 ${performance.length} 个连续绩效点；仓位数量 ${positionReconciliation.matched}/${positionReconciliation.comparisons} 项吻合，${positionReconciliation.differences.length} 项待解释（已处理 ${positionReconciliation.timezoneAdjustedTransactions} 笔跨时区边界交易）`,
      positionReconciliation,
      assetReturnsReconciled: performanceReconciliation.assetReturnsReconciled,
      eventCoverage,
      valuationCoverage,
      marketDataRequirement: requirement,
      marketDataCoverage: stagedBaseline?.marketDataCoverage,
      marketDataFreshness: stagedBaseline?.marketDataFreshness,
      marketBarCoverage: stagedBaseline?.marketBarCoverage,
      ledgerReplayReadiness: stagedBaseline?.ledgerReplayReadiness,
      cashEndpointReconciliation: stagedBaseline?.cashEndpointReconciliation,
      dailyLedgerReplay: stagedBaseline?.dailyLedgerReplay,
      dailyLedgerValuation: stagedBaseline?.dailyLedgerValuation,
      returnAttribution: stagedBaseline?.returnAttribution,
    }, holdingsClassifications(fundSelections, instrumentClassifications));
  });
  if (!payload) return null;
  const alertRows = await sql<{
    id: string;
    source: string;
    severity: "warning" | "error";
    title: string;
    detail: string;
    occurrence_count: number;
    last_observed_at: string;
  }[]>`
    SELECT id::text, source, severity, title, detail, occurrence_count,
           last_observed_at::text
    FROM operational_alert
    WHERE status = 'open'
    ORDER BY severity DESC, last_observed_at DESC
    LIMIT 20
  `;
  const operationalAlerts = alertRows.map((row) => ({
    id: row.id,
    source: row.source,
    severity: row.severity,
    title: row.title,
    detail: row.detail,
    occurrenceCount: row.occurrence_count,
    lastObservedAt: new Date(row.last_observed_at).toISOString(),
  }));
  const riskRepository = new PostgresCalculationRunRepository(sql);
  const eventAsOf = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const [riskRuns, scenarioRuns, driftAnchor, eventHorizon, journal, workflowItems, quality, dataSources, signalCoverage] = await Promise.all([
    riskRepository.loadCompletedHistory("portfolio-risk", 30),
    riskRepository.loadCompletedHistory("portfolio-risk-rebalance", 5),
    new PostgresRiskDriftAnchorRepository(sql).loadLatest(),
    new PostgresEventHorizonRepository(sql).load(eventAsOf),
    new PostgresDecisionJournalRepository(sql).load(20),
    new PostgresOperationsRepository(sql).loadWorkflowItems(eventAsOf),
    new PostgresQualityMetricsRepository(sql).loadDashboard(),
    new PostgresDataSourceHealthRepository(sql).load(),
    new PostgresMarketSignalRepository(sql).coverage(),
  ]);
  const dataStatus = payload.health.marketDataFreshness?.status === "fresh" ? "fresh" : "stale";
  const riskHistory = riskRuns
    .map((record) => riskSnapshot(record, dataStatus))
    .filter((snapshot): snapshot is NonNullable<typeof snapshot> => snapshot != null)
    .reverse();
  const latestRisk = riskRuns[0];
  const latestRiskSnapshot = latestRisk
    ? riskSnapshot(latestRisk, dataStatus)
    : undefined;
  const riskScenarios = scenarioRuns
    .map((record) => riskSnapshot(record, dataStatus))
    .filter((scenario): scenario is NonNullable<typeof scenario> => scenario != null);
  const riskDrift = latestRiskSnapshot && driftAnchor
    ? calculateRiskDrift({
      currentPortfolioVolatilityAnnualized: latestRiskSnapshot.portfolio.volatilityAnnualized,
      currentInstruments: latestRiskSnapshot.instruments,
      anchor: driftAnchor,
    })
    : undefined;
  return {
    ...payload,
    health: {
      ...payload.health,
      ...(operationalAlerts.length ? { operationalAlerts } : {}),
    },
    ...(latestRiskSnapshot ? { risk: latestRiskSnapshot } : {}),
    ...(riskHistory.length ? { riskHistory } : {}),
    ...(riskScenarios.length ? { riskScenarios } : {}),
    ...(riskDrift ? { riskDrift } : {}),
    eventHorizon,
    ...(journal.length ? { journal } : {}),
    quality: { ...quality, dataSources, signalCoverage } as unknown as PortfolioPayload["quality"],
    operations: mergeOperationItems(buildOperationsSnapshot({
      ...payload,
      health: {
        ...payload.health,
        ...(operationalAlerts.length ? { operationalAlerts } : {}),
      },
      ...(latestRiskSnapshot ? { risk: latestRiskSnapshot } : {}),
      ...(riskDrift ? { riskDrift } : {}),
      eventHorizon,
    }), workflowItems),
  };
}

export async function loadPortfolioPreferDatabase(): Promise<PortfolioPayload> {
  const sql = createDatabaseClient();
  let payload: PortfolioPayload;
  try {
    payload = await loadPortfolioFromDatabase(sql) ?? loadPortfolio();
  } catch {
    const fallback = loadPortfolio();
    payload = {
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
  const brokerConnection = await checkIbkrReadOnlyConnection({ baseUrl: process.env.IBKR_WEB_API_URL });
  const withBrokerConnection = {
    ...payload,
    health: {
      ...payload.health,
      brokerConnection,
    },
  };
  return {
    ...withBrokerConnection,
    operations: withBrokerConnection.operations ?? buildOperationsSnapshot(withBrokerConnection),
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
    meta: { account: "DEMO-SATELLITE-USD", asOf: latest.date, baseCurrency: "USD", benchmark: ".NDX", strategyVersion: "epoch-satellite-v0.1.0", classificationVersion: INSTRUMENT_CLASSIFICATION_VERSION },
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
      instrumentId,
      symbol: instrumentId.split(":").at(-1)!,
      name: names[instrumentId] ?? instrumentId,
      quantity,
      marketValue: quantity * (prices.get(instrumentId) ?? 0),
      currency: "USD",
      assetClass: "stock",
    })).sort((left, right) => right.marketValue - left.marketValue),
    exposure: buildExposureSnapshot(Object.entries(latest.positions).map(([instrumentId, quantity]) => ({
      instrumentId,
      marketValueUsd: quantity * (prices.get(instrumentId) ?? 0),
      currency: "USD",
      assetClass: "stock",
    })), instrumentClassifications),
    health: {
      status: calculation.health.balanced ? "healthy" : "warning",
      ledgerBalanced: calculation.health.balanced,
      reconciliationDifference: calculation.health.maxAbsoluteDifferenceCents / 100,
      source: "synthetic",
      message: `固定输入 ${calculation.inputHash.slice(0, 12)}… 已通过账本守恒检查`,
    },
  };
}
