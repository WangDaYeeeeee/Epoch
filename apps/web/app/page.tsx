import { PerformanceChart } from "@/components/performance-chart";
import { MarketRefreshControl } from "@/components/market-refresh-control";
import { RebalanceRiskForm, RiskAnchorForm } from "@/components/risk-actions";
import { WorkflowConsole } from "@/components/workflow-console";
import type { PortfolioPayload } from "@/lib/types";
import { loadPortfolioPreferDatabase } from "@/lib/server/portfolio";

export const dynamic = "force-dynamic";

async function getPortfolio(): Promise<PortfolioPayload> {
  return loadPortfolioPreferDatabase();
}

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const percent = (value: number) => `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
const riskPercent = (value: number) => `${(value * 100).toFixed(2)}%`;

export default async function PortfolioPage() {
  const data = await getPortfolio();
  const invested = data.summary.nav - data.summary.cash;
  return (
    <main>
      <aside>
        <div className="brand">EPOCH</div>
        <nav>
          <a className="active" href="#operations">今日工作台</a>
          <a href="#events">事件视界</a>
          <a href="#journal">决策日志</a>
          <a href="#workflow">工作流录入</a>
          <a href="#overview">组合总览</a>
          <a href="#risk">风险监控</a>
          <a href="#positions">当前持仓</a>
          <a href="#exposure">持仓穿透</a>
          <a href="#health">数据健康</a>
          <a href="#quality">长期质量</a>
          <a href="#reconciliation">对账明细</a>
        </nav>
        <div className="account"><span>卫星仓账户边界</span><strong>{data.meta.account}</strong><small>只读 · {data.meta.baseCurrency}</small></div>
      </aside>
      <section className="content">
        <header>
          <div><p className="eyebrow">PORTFOLIO / OVERVIEW</p><h1>组合表现</h1><p>可信账本、净值轨迹与基准比较</p></div>
          <div className="asof"><span className="pulse" />数据截至 {data.meta.asOf}</div>
        </header>
        {data.operations && (
          <article className="panel operations-panel" id="operations">
            <div className="panel-head">
              <div><h2>今日工作台</h2><p>确定性信号生成 · 不含 Agent 判断 · 不自动交易</p></div>
              <span className={`operations-status ${data.operations.status}`}>
                {data.operations.status === "clear" ? "无待办" : data.operations.status === "critical" ? "存在关键事项" : "需要关注"}
              </span>
            </div>
            <div className="operations-summary">
              <div><strong>{data.operations.counts.critical}</strong><span>关键</span></div>
              <div><strong>{data.operations.counts.action}</strong><span>待处理</span></div>
              <div><strong>{data.operations.counts.review}</strong><span>待复核</span></div>
            </div>
            {data.operations.items.length ? (
              <div className="operations-list">
                {data.operations.items.map((item) => (
                  <div className={`operation-item ${item.priority}`} key={item.id}>
                    <span>{({
                      risk: "风险", data: "数据", event: "事件", coverage: "覆盖",
                      refill: "回补", governance: "治理", review: "复盘", approval: "确认",
                    } as const)[item.category]}</span>
                    <div><strong>{item.title}</strong><p>{item.detail}</p></div>
                    <small>{item.evidence}</small>
                  </div>
                ))}
              </div>
            ) : <p className="operations-clear">当前数据、风险卡口与覆盖检查均无待处理事项。</p>}
          </article>
        )}
        {data.eventHorizon && (
          <article className="panel event-horizon-panel" id="events">
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
          <article className="panel journal-panel" id="journal">
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
        <WorkflowConsole strategyVersion={data.meta.strategyVersion} />
        <div className="metrics" id="overview">
          <article><span>组合净值</span><strong className="gold">{money.format(data.summary.nav)}</strong><small>{money.format(invested)} 已投资</small></article>
          <article><span>累计收益</span><strong className="gain">{percent(data.summary.portfolioReturn)}</strong><small>当前所选历史区间</small></article>
          <article><span>.NDX 基准</span><strong>{percent(data.summary.benchmarkReturn)}</strong><small>同期累计收益</small></article>
          <article><span>超额收益</span><strong className="gain">{percent(data.summary.activeReturn)}</strong><small>组合 − 基准</small></article>
        </div>
        {data.quality && (
          <article className="panel risk-panel" id="quality">
            <div className="panel-head">
              <div><h2>长期质量</h2><p>预测误差、命题复核、决策覆盖与外部数据能力</p></div>
              <span className={`reconciliation-status ${data.quality.dataSources.some((source) => source.required && source.health_status !== "success") ? "pending" : "passed"}`}>
                {data.quality.dataSources.filter((source) => source.required && source.health_status !== "success").length
                  ? "必需数据需关注" : "必需数据正常"}
              </span>
            </div>
            <div className="risk-metrics">
              <div><span>预测评估</span><strong>{data.quality.forecast.observations}</strong><small>截至 {data.quality.forecast.latest_realized_as_of ?? "暂无"}</small></div>
              <div><span>方差 MAE</span><strong>{data.quality.forecast.mae == null ? "—" : (data.quality.forecast.mae * 10000).toFixed(2)}</strong><small>bp² 日频口径</small></div>
              <div><span>方差 RMSE</span><strong>{data.quality.forecast.rmse == null ? "—" : (data.quality.forecast.rmse * 10000).toFixed(2)}</strong><small>bp² 日频口径</small></div>
              <div><span>未决命题</span><strong>{data.quality.unresolvedClaims.length}</strong><small>{data.quality.unresolvedClaims.filter((claim) => claim.age_days > 90).length} 个超过 90 天</small></div>
              <div><span>已完成事件预案</span><strong>{data.quality.playbookCoverage.covered_events}/{data.quality.playbookCoverage.completed_events}</strong><small>事件前预案就绪</small></div>
              <div><span>人工决定</span><strong>{data.quality.decisionQuality.decisions}</strong><small>{data.quality.decisionQuality.executed} 个已记录执行</small></div>
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
            <p className="exposure-note">Alpaca 实际回放已暂缓；未配置的分钟线和期权信号不会进入风险模型。</p>
          </article>
        )}
        {data.risk && (
          <article className="panel risk-panel" id="risk">
            <div className="panel-head">
              <div><h2>组合风险</h2><p>截至 {data.risk.asOf.slice(0, 10)} · {data.risk.modelVersion}</p></div>
              <span className={`reconciliation-status ${data.risk.policyGate.passed ? "passed" : "pending"}`}>
                45% 卡口 · {data.risk.policyGate.passed ? "通过" : "越界"}
              </span>
            </div>
            <div className="risk-metrics">
              <div><span>组合 σₚ</span><strong>{riskPercent(data.risk.portfolio.volatilityAnnualized)}</strong><small>余量 {riskPercent(data.risk.policyGate.limitAnnualized - data.risk.policyGate.observedAnnualized)}</small></div>
              <div><span>Stress σₚ</span><strong>{riskPercent(data.risk.portfolio.stressVolatilityAnnualized)}</strong><small>ρ 非对角统一为 0.90 · 仅呈现</small></div>
              <div><span>历史 CVaR</span><strong>{data.risk.portfolio.historicalCvarLoss == null ? "不可用" : riskPercent(data.risk.portfolio.historicalCvarLoss)}</strong><small>{(data.risk.portfolio.cvarConfidence * 100).toFixed(0)}% 置信度 · 损失口径</small></div>
              <div><span>运行状态</span><strong>{data.risk.status === "degraded" ? "降级估计器" : "完整模型"}</strong><small>{data.risk.dataStatus === "stale" ? "行情已过期" : "行情新鲜"}</small></div>
            </div>
            <div className="risk-table">
              {[...data.risk.instruments].sort((left, right) => right.riskContribution - left.riskContribution).map((item) => (
                <div className="risk-row" key={item.instrumentId}>
                  <strong>{item.instrumentId}</strong>
                  <span>权重 {riskPercent(item.weight)}</span>
                  <span>σᵢ {riskPercent(item.volatilityAnnualized)}</span>
                  <span>RC {riskPercent(item.riskContribution)}</span>
                  <span>RC/w {item.riskCapitalRatio == null ? "—" : riskPercent(item.riskCapitalRatio)}</span>
                </div>
              ))}
            </div>
            {data.risk.modelDiagnostics && (
              <section className="risk-model-diagnostics">
                <div className="risk-history-head">
                  <h3>SHAR 预测与尾部监控</h3>
                  <small>{data.risk.modelDiagnostics.semivarianceResolution} · IV {data.risk.modelDiagnostics.ivInputStatus}</small>
                </div>
                <div className="risk-table">
                  {data.risk.modelDiagnostics.forecasts.map((forecast) => (
                    <div className="risk-row" key={forecast.instrumentId}>
                      <strong>{forecast.instrumentId}</strong>
                      <span>RS⁺ {(forecast.positiveSemivariance22d * 10000).toFixed(2)}bp²</span>
                      <span>RS⁻ {(forecast.negativeSemivariance22d * 10000).toFixed(2)}bp²</span>
                      <span>ΔJ {(forecast.signedJump22d * 10000).toFixed(2)}bp²</span>
                      <span>OOS RMSE {(forecast.expandingWindowBacktest.rmse * 10000).toFixed(2)}bp²</span>
                    </div>
                  ))}
                </div>
                <div className="risk-monitor-grid">
                  <div><span>相关性聚类</span><strong>{data.risk.modelDiagnostics.correlationClusters.map((cluster) => cluster.join(" + ")).join(" · ")}</strong></div>
                  <div><span>最差历史 5 日窗口</span><strong>{data.risk.modelDiagnostics.historicalCrashWeeks.map((week) => `${week.endDate} ${percent(week.return)}`).join(" · ")}</strong></div>
                  <div><span>D_w / D_r</span><strong>{data.riskDrift
                    ? `${riskPercent(data.riskDrift.divergence.weight)} / ${data.riskDrift.divergence.riskContribution == null ? "—" : riskPercent(data.riskDrift.divergence.riskContribution)}`
                    : "待已执行目标锚点"}</strong></div>
                </div>
              </section>
            )}
            <div className="risk-actions">
              <RebalanceRiskForm initialWeights={data.risk.instruments.map((item) => ({
                instrumentId: item.instrumentId,
                weight: item.weight,
              }))} />
              <RiskAnchorForm options={[
                {
                  calculationId: data.risk.calculationId,
                  label: `当前真实组合 · ${data.risk.asOf.slice(0, 10)} · ${data.risk.calculationId.slice(0, 8)}`,
                },
                ...(data.riskScenarios ?? []).map((scenario) => ({
                  calculationId: scenario.calculationId,
                  label: `调仓测算 · ${scenario.asOf.slice(0, 10)} · ${scenario.calculationId.slice(0, 8)}`,
                })),
              ]} />
            </div>
            {(data.riskHistory?.length ?? 0) > 0 && (
              <section className="risk-history">
                <div className="risk-history-head">
                  <h3>真实风险运行趋势</h3>
                  <small>最近 {data.riskHistory!.length} 次 · 不含调仓意向</small>
                </div>
                <div className="risk-history-list">
                  {data.riskHistory!.map((point, index) => {
                    const previous = data.riskHistory![index - 1];
                    const delta = previous
                      ? point.portfolio.volatilityAnnualized - previous.portfolio.volatilityAnnualized
                      : null;
                    const width = Math.min(100, point.portfolio.volatilityAnnualized / point.policyGate.limitAnnualized * 100);
                    return (
                      <div className="risk-history-row" key={point.calculationId}>
                        <time>{point.asOf.slice(0, 10)}</time>
                        <div className="risk-history-bar"><i style={{ width: `${width}%` }} /></div>
                        <strong>{riskPercent(point.portfolio.volatilityAnnualized)}</strong>
                        <span>{delta == null ? "基线" : `Δ ${percent(delta)}`}</span>
                        <span>Stress {riskPercent(point.portfolio.stressVolatilityAnnualized)}</span>
                        <span>CVaR {point.portfolio.historicalCvarLoss == null ? "—" : riskPercent(point.portfolio.historicalCvarLoss)}</span>
                      </div>
                    );
                  })}
                </div>
                <p className="exposure-note">每个点均来自已完成的真实组合风险运行；45% 标线仅对应现行唯一硬卡口。</p>
              </section>
            )}
            {(data.riskScenarios?.length ?? 0) > 0 && (
              <section className="risk-scenarios">
                <h3>最近调仓意向测算</h3>
                {data.riskScenarios!.map((scenario) => (
                  <div className="risk-scenario" key={scenario.calculationId}>
                    <div>
                      <strong>{scenario.calculationId.slice(0, 8)}</strong>
                      <small>{scenario.instruments.map((item) => `${item.instrumentId.split(":").at(-1)} ${(item.weight * 100).toFixed(0)}%`).join(" · ")}</small>
                    </div>
                    <span>σₚ {riskPercent(scenario.portfolio.volatilityAnnualized)}</span>
                    <span className={scenario.portfolio.volatilityAnnualized <= data.risk!.portfolio.volatilityAnnualized ? "gain" : ""}>
                      较当前 {percent(scenario.portfolio.volatilityAnnualized - data.risk!.portfolio.volatilityAnnualized)}
                    </span>
                    <span>Stress {riskPercent(scenario.portfolio.stressVolatilityAnnualized)}</span>
                    <span>{scenario.policyGate.passed ? "卡口通过" : "卡口越界"}</span>
                  </div>
                ))}
                <p className="exposure-note">历史意向仅用于比较和审计，不代表已采用或已执行。</p>
              </section>
            )}
            <section className="risk-drift">
              <h3>波动率漂移锚点</h3>
              {data.riskDrift ? (
                <>
                  <div className={`risk-drift-summary ${data.riskDrift.portfolio.level}`}>
                    <span>σₚ / σₚ⁰</span>
                    <strong>{data.riskDrift.portfolio.ratio == null ? "—" : `${data.riskDrift.portfolio.ratio.toFixed(2)}×`}</strong>
                    <small>锚点 {data.riskDrift.effectiveAt.slice(0, 10)}</small>
                    <small>D_w {riskPercent(data.riskDrift.divergence.weight)}</small>
                    <small>D_r {data.riskDrift.divergence.riskContribution == null ? "历史锚点不可用" : riskPercent(data.riskDrift.divergence.riskContribution)}</small>
                  </div>
                  <div className="risk-table">
                    {data.riskDrift.instruments.map((item) => (
                      <div className={`risk-row drift-${item.level}`} key={item.instrumentId}>
                        <strong>{item.instrumentId}</strong>
                        <span>σᵢ⁰ {riskPercent(item.anchorVolatilityAnnualized)}</span>
                        <span>当前 {item.currentVolatilityAnnualized == null ? "已退出/缺失" : riskPercent(item.currentVolatilityAnnualized)}</span>
                        <span>倍数 {item.ratio == null ? "—" : `${item.ratio.toFixed(2)}×`}</span>
                        <span>{item.level === "strong" ? "强提示" : item.level === "highlight" ? "提示" : "正常"}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="exposure-note">尚未由用户确认调仓锚点；系统不会自动把测算场景当成已执行组合。</p>
              )}
            </section>
            <p className="exposure-note">当前结果使用 60 日 Garman–Klass 降级口径。{data.risk.dataStatus === "stale" ? "行情不是最新状态，不作为新的正式交易结论。" : ""}</p>
          </article>
        )}
        <article className="panel chart-panel">
          <div className="panel-head"><div><h2>累计表现</h2><p>起始日归一化为 0%</p></div><div className="legend"><span className="portfolio">组合</span><span className="benchmark">.NDX</span></div></div>
          <PerformanceChart data={data.series} events={data.events ?? []} />
        </article>
        <div className="lower-grid">
          <article className="panel" id="positions">
            <div className="panel-head"><div><h2>当前持仓</h2><p>{data.positions.length} 个证券 · 市值口径</p></div></div>
            <div className="positions">
              {data.positions.map((position) => (
                <div className="position" key={position.symbol}><div><strong>{position.symbol}</strong><small>{position.name ?? position.symbol} · {position.quantity} 股 · {position.currency}</small></div><div className="position-value"><strong>{money.format(position.marketValue)}</strong><small>{((position.marketValue / invested) * 100).toFixed(1)}%</small></div></div>
              ))}
            </div>
          </article>
          <article className="panel health" id="health">
            <div className="panel-head"><div><h2>数据健康</h2><p>最后可信快照</p></div><span className={`status ${data.health.status === "healthy" ? "" : "warning"}`}>{data.health.status === "healthy" ? "可用" : "需关注"}</span></div>
            <div className="health-score"><span style={{ flex: "0 0 32px", minWidth: 32, minHeight: 32, lineHeight: 1 }}>✓</span><div><strong>数据连续性</strong><p>{data.health.message}</p></div></div>
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
        <article className="panel exposure-panel" id="exposure">
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
          <article className="panel attribution-panel">
            <div className="panel-head">
              <div><h2>收益归因</h2><p>{data.returnAttribution.dateFrom} 至 {data.returnAttribution.dateTo} · USD 损益贡献</p></div>
              <span className={Math.abs(data.returnAttribution.residualPnlUsd) < 1 ? "reconciliation-status passed" : "reconciliation-status pending"}>
                残差 {money.format(data.returnAttribution.residualPnlUsd)}
              </span>
            </div>
            <div className="attribution-grid">
              {data.returnAttribution.securities.slice(0, 8).map((item) => (
                <div className="exposure-row" key={item.instrumentId}>
                  <span>{item.instrumentId}</span>
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
          <article className="panel reconciliation" id="reconciliation">
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
                      <td><strong>{difference.instrumentId.split(":").at(-1)}</strong><small>{difference.accountId}</small></td>
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
