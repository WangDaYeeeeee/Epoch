import { PerformanceChart } from "@/components/performance-chart";
import { MarketRefreshControl } from "@/components/market-refresh-control";
import { HistoricalRiskBackfillControl, TargetWeightAnchorForm } from "@/components/risk-actions";
import { RiskMetricCards } from "@/components/risk-metric-cards";
import { RiskInstrumentDetails } from "@/components/risk-instrument-details";
import { RiskGuide } from "@/components/risk-guide";
import { WorkflowConsole } from "@/components/workflow-console";
import { ResearchMemorySearch } from "@/components/research-memory-search";
import { BriefcaseBusiness, Check, Home, Search, Settings } from "lucide-react";
import type { PortfolioPayload } from "@/lib/types";
import { loadPortfolioPreferDatabase } from "@/lib/server/portfolio";
import { instrumentClassifications } from "@/lib/domain/instrument-classifications";
import { CASH_EQUIVALENT_INSTRUMENTS, canonicalMarketInstrumentId, isDerivativeInstrumentId } from "@/lib/domain/market-data";

export const dynamic = "force-dynamic";

async function getPortfolio(): Promise<PortfolioPayload> {
  return loadPortfolioPreferDatabase();
}

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const percent = (value: number) => `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
const instrumentNameFallbacks = new Map([
  ["US:SOXX", "iShares Semiconductor ETF"],
]);

export type DashboardView = "workbench" | "portfolio" | "research" | "system";

export async function PortfolioDashboard({ view }: { view: DashboardView }) {
  const data = await getPortfolio();
  const instrumentNames = new Map([
    ...instrumentClassifications.flatMap((item) => item.issuer ? [[item.instrumentId, item.issuer.name] as const] : []),
    ...data.positions.map((item) => [item.instrumentId, item.name ?? item.symbol] as const),
  ]);
  const instrumentName = (instrumentId: string) =>
    instrumentNames.get(instrumentId) || instrumentNameFallbacks.get(instrumentId) || "名称待补充";
  const currentRiskPositionMap = new Map<string, { instrumentId: string; name: string; marketValue: number }>();
  for (const position of data.positions) {
    const instrumentId = canonicalMarketInstrumentId(position.instrumentId);
    if (
      CASH_EQUIVALENT_INSTRUMENTS.has(instrumentId)
      || isDerivativeInstrumentId(instrumentId)
      || Math.abs(position.marketValue) <= 1e-9
    ) continue;
    const existing = currentRiskPositionMap.get(instrumentId);
    currentRiskPositionMap.set(instrumentId, {
      instrumentId,
      name: position.name ?? existing?.name ?? instrumentName(instrumentId),
      marketValue: (existing?.marketValue ?? 0) + position.marketValue,
    });
  }
  const currentRiskPositions = [...currentRiskPositionMap.values()].sort((left, right) => right.marketValue - left.marketValue);
  const invested = data.summary.nav - data.summary.cash;
  const tradingDaySeries = data.series.filter((point, index) =>
    index === 0 || point.benchmark !== data.series[index - 1].benchmark);
  const dailyReturnExtremes = tradingDaySeries.slice(1).map((point, index) => ({
    date: point.date,
    return: point.portfolio / tradingDaySeries[index].portfolio - 1,
  }));
  const bestDailyReturns = [...dailyReturnExtremes].sort((left, right) => right.return - left.return).slice(0, 5);
  const worstDailyReturns = [...dailyReturnExtremes].sort((left, right) => left.return - right.return).slice(0, 5);
  const page = {
    workbench: { eyebrow: "WORKBENCH", title: "工作台", description: "今日待办、风险卡口与事件视界" },
    portfolio: { eyebrow: "PORTFOLIO", title: "组合", description: "持仓、绩效、归因与敞口穿透" },
    research: { eyebrow: "RESEARCH", title: "研究", description: "研究记忆、决策日志与结构化复盘" },
    system: { eyebrow: "SYSTEM", title: "系统", description: "数据健康、模型质量与账本对账" },
  }[view];
  return (
    <main className={`dashboard dashboard-${view}`}>
      <aside>
        <div className="brand">
          <b>EPOCH</b>
        </div>
        <nav>
          <a className={view === "workbench" ? "active" : ""} href="/"><i aria-hidden="true"><Home /></i><span>工作台</span></a>
          <a className={view === "portfolio" ? "active" : ""} href="/portfolio"><i aria-hidden="true"><BriefcaseBusiness /></i><span>组合</span></a>
          <a className={view === "research" ? "active" : ""} href="/research"><i aria-hidden="true"><Search /></i><span>研究</span></a>
          <a className={view === "system" ? "active" : ""} href="/system"><i aria-hidden="true"><Settings /></i><span>系统</span></a>
        </nav>
        <div className="account"><span>卫星仓账户边界</span><strong>{data.meta.account}</strong><small>只读 · {data.meta.baseCurrency}</small></div>
      </aside>
      <section className="content">
        <header>
          <div><p className="eyebrow">{page.eyebrow}</p><h1>{page.title}</h1><p>{page.description}</p></div>
          <div className="asof"><span className="pulse" /><span className="asof-label">数据截至 {data.meta.asOf}</span></div>
        </header>
        {data.operations && (
          <article className="panel operations-panel view-section view-workbench" id="operations">
            <div className="panel-head">
              <div><h2>今日工作台</h2><p>确定性信号生成 · 不含 Agent 判断 · 不自动交易</p></div>
              <span className={`operations-status ${data.operations.status}`}>
                {data.operations.status === "clear" ? "无待办" : data.operations.status === "critical" ? "存在关键事项" : "需要关注"}
              </span>
            </div>
            <div className="operations-summary">
              <div className="critical"><span>关键事项</span><strong>{data.operations.counts.critical}</strong><small>立即检查风险与数据</small></div>
              <div className="action"><span>待处理</span><strong>{data.operations.counts.action}</strong><small>近期需要完成动作</small></div>
              <div className="review"><span>待复核</span><strong>{data.operations.counts.review}</strong><small>进入人工判断队列</small></div>
            </div>
            {data.operations.items.length ? (
              <div className="operations-list">
                {(["critical", "action", "review"] as const).map((priority) => {
                  const items = data.operations!.items.filter((item) => item.priority === priority);
                  return (
                    <div className={`operation-column ${priority}`} key={priority}>
                      {items.length ? items.map((item) => (
                        <div className={`operation-item ${item.priority}`} key={item.id}>
                          <span className="operation-category">{({
                            risk: "风险", data: "数据", event: "事件", coverage: "覆盖",
                            refill: "回补", governance: "治理", review: "复盘", approval: "确认",
                          } as const)[item.category]}</span>
                          <div><strong>{item.title}</strong><p>{item.detail}</p></div>
                          <small>{item.evidence}</small>
                        </div>
                      )) : (
                        <p className="operation-column-empty">
                          {priority === "critical" ? "当前无关键事项" : priority === "action" ? "当前无待处理事项" : "当前无待复核事项"}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : <p className="operations-clear">当前数据、风险卡口与覆盖检查均无待处理事项。</p>}
          </article>
        )}
        {data.eventHorizon && (
          <article className="panel event-horizon-panel view-section view-workbench" id="events">
            <div className="panel-head">
              <div><h2>事件视界</h2><p>近区为未来 {data.eventHorizon.nearWindowTradingDays} 个交易日</p></div>
              <span className={data.eventHorizon.missingPlaybookCount ? "reconciliation-status pending" : "reconciliation-status passed"}>
                {data.eventHorizon.missingPlaybookCount ? `${data.eventHorizon.missingPlaybookCount} 个缺失预案` : "近区预案完整"}
              </span>
            </div>
            {data.eventHorizon.items.length ? (
              <div className="event-horizon-list">
                {data.eventHorizon.items.map((event) => (
                  <div className={`event-horizon-item ${event.needsPlaybook ? "missing" : ""}`} key={event.id}>
                    <time>{event.scheduledDate}</time>
                    <div><strong>{event.title}</strong><p>{event.instrumentId ?? "组合级"} · {event.eventType}</p></div>
                    <span>{event.zone === "past" ? "已过" : event.tradingDaysAway === 0 ? "今日" : `${event.tradingDaysAway} 个交易日`}</span>
                    <small>{event.playbookStatus === "ready" ? "预案就绪" : event.playbookStatus === "draft" ? "预案草稿" : "缺少预案"}</small>
                  </div>
                ))}
              </div>
            ) : <p className="operations-clear">当前没有已登记的计划事件。</p>}
          </article>
        )}
        {(data.journal?.length ?? 0) > 0 && (
          <article className="panel journal-panel view-section view-research" id="journal">
            <div className="panel-head">
              <div><h2>决策日志</h2><p>调仓测算 → Policy Gate → 所有者决定 → 外部执行</p></div>
              <span className="reconciliation-status passed">{data.journal!.length} 条记录</span>
            </div>
            <div className="journal-list">
              {data.journal!.map((entry) => (
                <div className={`journal-item ${entry.outcome}`} key={entry.id}>
                  <time>{entry.decidedAt.slice(0, 16).replace("T", " ")}</time>
                  <div><strong>{entry.rationale}</strong><p>{entry.triggerType} · CalculationRun {entry.calculationRunId.slice(0, 8)}</p></div>
                  <span>{entry.outcome === "confirmed" ? "已确认" : entry.outcome === "modified" ? "修改后确认" : "已拒绝"}</span>
                  <small>{entry.execution ? `已执行 · ${entry.execution.brokerReference}` : "未记录执行"}</small>
                </div>
              ))}
            </div>
          </article>
        )}
        {data.quality && (
          <article className="panel risk-panel view-section view-research" id="research-quality">
            <div className="panel-head">
              <div><h2>判断与复盘</h2><p>命题复核、事件前预案与人工决定闭环</p></div>
              <span className={`reconciliation-status ${data.quality.unresolvedClaims.some((claim) => claim.age_days > 90) ? "pending" : "passed"}`}>
                {data.quality.unresolvedClaims.some((claim) => claim.age_days > 90) ? "存在超期命题" : "复核状态正常"}
              </span>
            </div>
            <div className="risk-metrics">
              <div><span>未决命题</span><strong>{data.quality.unresolvedClaims.length}</strong><small>{data.quality.unresolvedClaims.filter((claim) => claim.age_days > 90).length} 个超过 90 天</small></div>
              <div><span>已完成事件预案</span><strong>{data.quality.playbookCoverage.covered_events}/{data.quality.playbookCoverage.completed_events}</strong><small>事件前预案就绪</small></div>
              <div><span>人工决定</span><strong>{data.quality.decisionQuality.decisions}</strong><small>{data.quality.decisionQuality.executed} 个已记录执行</small></div>
            </div>
            {data.quality.unresolvedClaims.length > 0 && (
              <div className="operations-list">
                {data.quality.unresolvedClaims.slice(0, 5).map((claim) => (
                  <div className={`operation-item ${claim.age_days > 90 ? "action" : "review"}`} key={claim.id}>
                    <span>命题</span>
                    <div><strong>{claim.statement}</strong><p>{claim.kind} · 置信度 {(claim.confidence * 100).toFixed(0)}%</p></div>
                    <small>{claim.age_days} 天未复核</small>
                  </div>
                ))}
              </div>
            )}
          </article>
        )}
        <div className="view-section view-research"><WorkflowConsole strategyVersion={data.meta.strategyVersion} /></div>
        <div className="view-section view-research"><ResearchMemorySearch /></div>
        <div className="metrics view-section view-portfolio" id="overview">
          <article><span>组合净值</span><strong className="gold">{money.format(data.summary.nav)}</strong><small>{money.format(invested)} 已投资</small></article>
          <article><span>累计收益</span><strong className="gain">{percent(data.summary.portfolioReturn)}</strong><small>当前所选历史区间</small></article>
          <article><span>.NDX 基准</span><strong>{percent(data.summary.benchmarkReturn)}</strong><small>同期累计收益</small></article>
          <article><span>超额收益</span><strong className="gain">{percent(data.summary.activeReturn)}</strong><small>组合 − 基准</small></article>
        </div>
        {data.quality && (
          <article className="panel risk-panel view-section view-system" id="quality">
            <div className="panel-head">
              <div><h2>模型与数据质量</h2><p>预测误差、数据源状态与外部信号覆盖</p></div>
              <span className={`reconciliation-status ${data.quality.dataSources.some((source) => source.required && source.health_status !== "success") ? "pending" : "passed"}`}>
                {data.quality.dataSources.filter((source) => source.required && source.health_status !== "success").length
                  ? "必需数据需关注" : "必需数据正常"}
              </span>
            </div>
            <div className="risk-metrics">
              <div><span>预测评估</span><strong>{data.quality.forecast.observations}</strong><small>截至 {data.quality.forecast.latest_realized_as_of ?? "暂无"}</small></div>
              <div><span>方差 MAE</span><strong>{data.quality.forecast.mae == null ? "—" : (data.quality.forecast.mae * 10000).toFixed(2)}</strong><small>bp² 日频口径</small></div>
              <div><span>方差 RMSE</span><strong>{data.quality.forecast.rmse == null ? "—" : (data.quality.forecast.rmse * 10000).toFixed(2)}</strong><small>bp² 日频口径</small></div>
            </div>
            <div className="risk-table">
              {data.quality.dataSources.map((source) => (
                <div className="risk-row" key={source.id}>
                  <strong>{source.id}</strong>
                  <span>{source.provider}</span>
                  <span>{source.required ? "必需" : "可选"}</span>
                  <span>{source.health_status}</span>
                  <span>{source.effective_at?.slice(0, 10) ?? source.configured_status}</span>
                </div>
              ))}
            </div>
            <div className="risk-monitor-grid">
              <div><span>分钟行情</span><strong>{data.quality.signalCoverage.intraday.observations} 条 · {data.quality.signalCoverage.intraday.instruments} 标的</strong></div>
              <div><span>严格 RS± / ΔJ</span><strong>{data.quality.signalCoverage.semivariance.observations} 标的日 · {data.quality.signalCoverage.semivariance.return_observations ?? 0} 个收益观测</strong></div>
              <div><span>IV / put skew</span><strong>{data.quality.signalCoverage.options.observations} 条 · {data.quality.signalCoverage.options.instruments} 标的</strong></div>
            </div>
            <p className="exposure-note">Alpaca 实际回放已暂缓；未配置的分钟线和期权信号不会进入风险模型。</p>
          </article>
        )}
        {data.risk && (
          <article className="panel risk-panel view-section view-workbench" id="risk">
            <div className="panel-head">
              <div>
                <div className="risk-panel-title"><h2>组合风险</h2><RiskGuide /></div>
                <p>截至 {data.risk.asOf.slice(0, 10)} · {data.risk.modelVersion}</p>
              </div>
              <span className={`reconciliation-status ${data.risk.policyGate.passed ? "passed" : "pending"}`}>
                45% 卡口 · {data.risk.policyGate.passed ? "通过" : "越界"}
              </span>
            </div>
            <div className="risk-provenance">
              <span><i className="batch" />批次计算</span>
              <span><i className={data.risk.dataStatus} />行情{data.risk.dataStatus === "fresh" ? "新鲜" : "已过期"}</span>
              <span>CalculationRun {data.risk.calculationId.slice(0, 8)}</span>
              <small>页面展示最近一次已完成结果，不是盘中实时风险流。</small>
            </div>
            <div className="risk-actions">
              <TargetWeightAnchorForm initialWeights={currentRiskPositions.map((item) => ({
                instrumentId: item.instrumentId,
                name: item.name,
                weight: data.riskDrift?.instruments.find((anchor) => anchor.instrumentId === item.instrumentId)?.anchorWeight
                  ?? item.marketValue / data.summary.nav,
              }))} anchorInstrumentIds={data.riskDrift?.instruments.map((item) => item.instrumentId)} />
              <HistoricalRiskBackfillControl />
            </div>
            <RiskMetricCards
              risk={data.risk}
              history={data.riskHistory ?? []}
              performance={data.series}
              drift={data.riskDrift}
              driftInstruments={(data.riskDrift?.instruments ?? []).map((item) => ({
                ...item,
                name: instrumentName(item.instrumentId),
              }))}
            />
            <RiskInstrumentDetails
              instruments={data.risk.instruments.map((item) => ({ ...item, name: instrumentName(item.instrumentId) }))}
              diagnostics={data.risk.modelDiagnostics}
            />
            <p className="exposure-note">当前结果使用 SHAR 日频半方差近似、250 日样本相关性；IV 输入暂不可用，模型处于降级状态。{data.risk.dataStatus === "stale" ? "行情不是最新状态，不作为新的正式交易结论。" : ""}</p>
          </article>
        )}
        <article className="panel chart-panel view-section view-portfolio">
          <div className="panel-head"><div><h2>累计表现</h2><p>起始日归一化为 0%</p></div><div className="legend"><span className="portfolio">组合</span><span className="benchmark">.NDX</span></div></div>
          <PerformanceChart data={data.series} events={data.events ?? []} />
        </article>
        <div className="lower-grid view-section view-portfolio view-system">
          <article className="panel portfolio-only" id="positions">
            <div className="panel-head"><div><h2>当前持仓</h2><p>{data.positions.length} 个证券 · 市值口径</p></div></div>
            <div className="positions">
              {data.positions.map((position) => (
                <div className="position" key={position.symbol}><div><strong>{position.symbol}</strong><small>{position.name ?? position.symbol} · {position.quantity} 股 · {position.currency}</small></div><div className="position-value"><strong>{money.format(position.marketValue)}</strong><small>{((position.marketValue / invested) * 100).toFixed(1)}%</small></div></div>
              ))}
            </div>
          </article>
          <article className="panel portfolio-only performance-extremes-panel">
            <div className="panel-head"><div><h2>历史单日极值</h2><p>组合净值 · 完整历史</p></div></div>
            <div className="performance-extremes-grid">
              <section className="best">
                <div><h3>涨幅最高</h3><small>Top 5</small></div>
                <div className="performance-extreme-list">
                  {bestDailyReturns.map((item) => (
                    <div key={item.date}>
                      <time>{item.date}</time>
                      <strong>{percent(item.return)}</strong>
                    </div>
                  ))}
                </div>
              </section>
              <section className="worst">
                <div><h3>跌幅最大</h3><small>Top 5</small></div>
                <div className="performance-extreme-list">
                  {worstDailyReturns.map((item) => (
                    <div key={item.date}>
                      <time>{item.date}</time>
                      <strong>{percent(item.return)}</strong>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </article>
          <article className="panel health system-only" id="health">
            <div className="panel-head"><div><h2>数据健康</h2><p>最后可信快照</p></div><span className={`status ${data.health.status === "healthy" ? "" : "warning"}`}>{data.health.status === "healthy" ? "可用" : "需关注"}</span></div>
            <div className="health-score"><span style={{ flex: "0 0 32px", minWidth: 32, minHeight: 32, lineHeight: 1 }}><Check aria-hidden="true" size={17} strokeWidth={2.4} /></span><div><strong>数据连续性</strong><p>{data.health.message}</p></div></div>
            {(data.health.operationalAlerts?.length ?? 0) > 0 && (
              <div className="operational-alerts">
                {data.health.operationalAlerts!.map((alert) => (
                  <div className={`operational-alert ${alert.severity}`} key={alert.id}>
                    <strong>{alert.title}</strong>
                    <span>{alert.detail}</span>
                    <small>{alert.occurrenceCount} 次 · 最近 {alert.lastObservedAt.slice(0, 16).replace("T", " ")}</small>
                  </div>
                ))}
              </div>
            )}
            <MarketRefreshControl />
            <dl><div><dt>账本守恒</dt><dd>{data.health.ledgerBalanced ? "已验证" : "待 Phase 1 对账"}</dd></div><div><dt>逐日资产收益</dt><dd>{data.health.assetReturnsReconciled ? "已验证" : "待对账"}</dd></div>{data.health.dailyLedgerValuation && <div><dt>逐日账本估值</dt><dd>{data.health.dailyLedgerValuation.valuedDays} 独立 · {data.health.dailyLedgerValuation.residualBridgeDays} 残差 · {data.health.dailyLedgerValuation.accountedDays}/{data.health.dailyLedgerValuation.totalDays} 已入账</dd></div>}{data.health.eventCoverage && <div><dt>事件归一化</dt><dd>{data.health.eventCoverage.classified}/{data.health.eventCoverage.total}</dd></div>}{data.health.valuationCoverage && <div><dt>报告估值换汇</dt><dd>{data.health.valuationCoverage.fxReconciled}/{data.health.valuationCoverage.total} · {data.health.valuationCoverage.missingFx === 0 ? "已覆盖" : `${data.health.valuationCoverage.missingFx} 待补`}</dd></div>}{data.health.marketDataRequirement && <div><dt>日频行情输入</dt><dd>{data.health.marketDataCoverage ? `${data.health.marketDataCoverage.coveredSecurities}/${data.health.marketDataCoverage.requiredSecurities} 标的 · ${data.health.marketDataCoverage.coveredFxPairs}/${data.health.marketDataCoverage.requiredFxPairs} 汇率` : `${data.health.marketDataRequirement.canonicalInstrumentIds.length} 标的 · ${data.health.marketDataRequirement.fxPairs.length} 汇率待接入`}</dd></div>}{data.health.marketDataFreshness && <div><dt>日频行情时效</dt><dd>{data.health.marketDataFreshness.status === "fresh" ? "新鲜" : data.health.marketDataFreshness.status === "stale" ? "已过期" : "缺失"} · 截至 {data.health.marketDataFreshness.latestEffectiveDate ?? "未知"}{data.health.marketDataFreshness.tradingDayLag != null ? ` · ${data.health.marketDataFreshness.tradingDayLag} 交易日` : ""}</dd></div>}{data.health.marketBarCoverage && <div><dt>OHLCV 输入</dt><dd>{data.health.marketBarCoverage.coveredInstruments}/{data.health.marketBarCoverage.requiredInstruments} 当前标的 · {data.health.marketBarCoverage.invalidBars} 无效</dd></div>}{data.health.brokerConnection && <div><dt>IBKR 只读连接</dt><dd>{data.health.brokerConnection.status === "connected" ? "已连接" : data.health.brokerConnection.status === "not_configured" ? "未配置" : data.health.brokerConnection.status === "authentication_required" ? "待认证" : "不可用"} · {data.health.brokerConnection.capability}</dd></div>}<div><dt>时间加权收益 TWR</dt><dd>{percent(data.summary.portfolioReturn)}</dd></div>{data.summary.moneyWeightedReturn !== undefined && <div><dt>资金加权收益 MWR</dt><dd>{percent(data.summary.moneyWeightedReturn)} 年化</dd></div>}{data.summary.cumulativeMoneyWeightedReturn !== undefined && <div><dt>MWR 区间累计</dt><dd>{percent(data.summary.cumulativeMoneyWeightedReturn)}</dd></div>}<div><dt>数据来源</dt><dd>{data.health.source === "database-baseline" ? "PostgreSQL 基线" : data.health.source === "private-staging" ? "本地清洗数据" : "合成数据"}</dd></div><div><dt>策略版本</dt><dd>{data.meta.strategyVersion}</dd></div></dl>
          </article>
        </div>
        <article className="panel exposure-panel view-section view-portfolio" id="exposure">
          <div className="panel-head">
            <div><h2>持仓穿透</h2><p>总市值敞口 · 分类版本 {data.meta.classificationVersion}</p></div>
            <span className={data.exposure.issuerCoverage.ratio === 1 ? "reconciliation-status passed" : "reconciliation-status pending"}>
              发行人覆盖 {(data.exposure.issuerCoverage.ratio * 100).toFixed(1)}%
            </span>
          </div>
          <div className="exposure-grid">
            <section>
              <h3>发行人</h3>
              {data.exposure.issuers.slice(0, 6).map((bucket) => (
                <div className="exposure-row" key={bucket.id}><span>{bucket.name}</span><strong>{(bucket.weight * 100).toFixed(1)}%</strong></div>
              ))}
            </section>
            <section>
              <h3>币种</h3>
              {data.exposure.currencies.map((bucket) => (
                <div className="exposure-row" key={bucket.id}><span>{bucket.name}</span><strong>{(bucket.weight * 100).toFixed(1)}%</strong></div>
              ))}
            </section>
            <section>
              <h3>资产类别</h3>
              {data.exposure.assetClasses.map((bucket) => (
                <div className="exposure-row" key={bucket.id}><span>{bucket.name}</span><strong>{(bucket.weight * 100).toFixed(1)}%</strong></div>
              ))}
            </section>
            <section>
              <h3>行业 · 覆盖 {(data.exposure.dimensionCoverage.industry.ratio * 100).toFixed(1)}%</h3>
              {data.exposure.industries.slice(0, 6).map((bucket) => (
                <div className="exposure-row" key={bucket.id}><span>{bucket.name}</span><strong>{(bucket.weight * 100).toFixed(1)}%</strong></div>
              ))}
            </section>
            <section>
              <h3>地域 · 覆盖 {(data.exposure.dimensionCoverage.region.ratio * 100).toFixed(1)}%</h3>
              {data.exposure.regions.slice(0, 6).map((bucket) => (
                <div className="exposure-row" key={bucket.id}><span>{bucket.name}</span><strong>{(bucket.weight * 100).toFixed(1)}%</strong></div>
              ))}
            </section>
            <section>
              <h3>主题 · 覆盖 {(data.exposure.dimensionCoverage.theme.ratio * 100).toFixed(1)}%</h3>
              {data.exposure.themes.slice(0, 6).map((bucket) => (
                <div className="exposure-row" key={bucket.id}><span>{bucket.name}</span><strong>{(bucket.weight * 100).toFixed(1)}%</strong></div>
              ))}
            </section>
          </div>
          <p className="exposure-note">主题为多标签口径，各主题占比可以重叠，合计可能超过 100%。</p>
          {data.exposure.issuerCoverage.missingInstrumentIds.length > 0 && (
            <p className="exposure-note">待接入底层持仓：{data.exposure.issuerCoverage.missingInstrumentIds.join("、")}。未穿透部分保留为“待穿透”，不归入基金管理人。</p>
          )}
          {data.exposure.holdingOverlaps.length > 0 && (
            <section className="overlap-section">
              <h3>共同发行人重叠</h3>
              {data.exposure.holdingOverlaps.map((overlap) => (
                <div className="overlap-item" key={overlap.issuerId}>
                  <div className="exposure-row"><span>{overlap.issuerName}</span><strong>{(overlap.weight * 100).toFixed(1)}%</strong></div>
                  <small>{overlap.sources.map((source) => `${source.instrumentId} ${(source.marketValueUsd / overlap.marketValueUsd * 100).toFixed(0)}%`).join(" · ")}</small>
                </div>
              ))}
            </section>
          )}
        </article>
        {data.returnAttribution && (
          <article className="panel attribution-panel view-section view-portfolio">
            <div className="panel-head">
              <div><h2>收益归因</h2><p>{data.returnAttribution.dateFrom} 至 {data.returnAttribution.dateTo} · USD 损益贡献</p></div>
              <span className={Math.abs(data.returnAttribution.residualPnlUsd) < 1 ? "reconciliation-status passed" : "reconciliation-status pending"}>
                残差 {money.format(data.returnAttribution.residualPnlUsd)}
              </span>
            </div>
            <div className="attribution-grid">
              {data.returnAttribution.securities.slice(0, 8).map((item) => (
                <div className="exposure-row" key={item.instrumentId}>
                  <span className="exposure-instrument"><b>{item.instrumentId}</b><small>{instrumentName(item.instrumentId)}</small></span>
                  <strong>{money.format(item.pnlUsd)}</strong>
                </div>
              ))}
              <div className="exposure-row"><span>股息、利息与费用</span><strong>{money.format(data.returnAttribution.cashIncomePnlUsd)}</strong></div>
              {data.returnAttribution.residuals.map((item) => (
                <div className="exposure-row" key={item.reason}>
                  <span>残差 · {item.reason === "UNEXPLAINED_MODEL_RESIDUAL" ? "模型未解释" : item.reason}（{item.days} 天）</span>
                  <strong>{money.format(item.pnlUsd)}</strong>
                </div>
              ))}
            </div>
            <h3>最大单日残差</h3>
            <div className="attribution-grid">
              {data.returnAttribution.largestResidualDays.slice(0, 5).map((item) => (
                <div className="exposure-row" key={item.date}>
                  <span>{item.date} · {item.actions.join("、") || "无账本事件"}</span>
                  <strong>{money.format(item.pnlUsd)}</strong>
                </div>
              ))}
            </div>
            <p className="exposure-note">损益闭合比例 {(data.returnAttribution.explainedRatio * 100).toFixed(1)}%。贡献按期初仓位价格变化、当日成交价差及费用计算；残差按当天缺失的估值证据归组，组合原因不作武断均摊。</p>
          </article>
        )}
        {data.health.positionReconciliation && (
          <article className="panel reconciliation view-section view-system" id="reconciliation">
            <div className="panel-head">
              <div><h2>仓位数量对账</h2><p>相邻券商报告快照 + 区间内已归一化交易</p></div>
              <span className={data.health.positionReconciliation.differences.length ? "reconciliation-status pending" : "reconciliation-status passed"}>
                {data.health.positionReconciliation.differences.length ? `${data.health.positionReconciliation.differences.length} 项待解释` : "全部吻合"}
              </span>
            </div>
            <div className="reconciliation-summary">
              <div><span>报告区间</span><strong>{data.health.positionReconciliation.intervals}</strong></div>
              <div><span>数量比较</span><strong>{data.health.positionReconciliation.comparisons}</strong></div>
              <div><span>已吻合</span><strong>{data.health.positionReconciliation.matched}</strong></div>
              <div><span>跨时区调整</span><strong>{data.health.positionReconciliation.timezoneAdjustedTransactions}</strong></div>
            </div>
            {data.health.positionReconciliation.differences.length > 0 && (
              <div className="reconciliation-table-wrap">
                <table className="reconciliation-table">
                  <thead><tr><th>账户 / 证券</th><th>报告区间</th><th>推算数量</th><th>报告数量</th><th>差异</th><th>状态</th></tr></thead>
                  <tbody>{data.health.positionReconciliation.differences.map((difference) => (
                    <tr key={`${difference.accountId}:${difference.toDate}:${difference.instrumentId}`}>
                      <td><strong>{difference.instrumentId.split(":").at(-1)}</strong><small>{instrumentName(difference.instrumentId)} · {difference.accountId}</small></td>
                      <td>{difference.fromDate}<small>至 {difference.toDate}</small></td>
                      <td>{difference.expectedQuantity.toLocaleString("zh-CN")}</td>
                      <td>{difference.reportedQuantity.toLocaleString("zh-CN")}</td>
                      <td className="difference">{difference.difference > 0 ? "+" : ""}{difference.difference.toLocaleString("zh-CN")}</td>
                      <td><span className="review-badge">待回查月结单</span></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </article>
        )}
        <footer>Epoch 不具备真实下单能力 · 所有交易均在券商端手工执行</footer>
      </section>
    </main>
  );
}
