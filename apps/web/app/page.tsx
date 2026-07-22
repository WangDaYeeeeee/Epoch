import { PerformanceChart } from "@/components/performance-chart";
import type { PortfolioPayload } from "@/lib/types";
import { loadPortfolioPreferDatabase } from "@/lib/server/portfolio";

export const dynamic = "force-dynamic";

async function getPortfolio(): Promise<PortfolioPayload> {
  return loadPortfolioPreferDatabase();
}

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const percent = (value: number) => `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;

export default async function PortfolioPage() {
  const data = await getPortfolio();
  const invested = data.summary.nav - data.summary.cash;
  return (
    <main>
      <aside>
        <div className="brand">EPOCH</div>
        <nav>
          <a className="active" href="#overview">组合总览</a>
          <a href="#positions">当前持仓</a>
          <a href="#health">数据健康</a>
          <a href="#reconciliation">对账明细</a>
        </nav>
        <div className="account"><span>卫星仓账户边界</span><strong>{data.meta.account}</strong><small>只读 · {data.meta.baseCurrency}</small></div>
      </aside>
      <section className="content">
        <header>
          <div><p className="eyebrow">PORTFOLIO / OVERVIEW</p><h1>组合表现</h1><p>可信账本、净值轨迹与基准比较</p></div>
          <div className="asof"><span className="pulse" />数据截至 {data.meta.asOf}</div>
        </header>
        <div className="metrics" id="overview">
          <article><span>组合净值</span><strong className="gold">{money.format(data.summary.nav)}</strong><small>{money.format(invested)} 已投资</small></article>
          <article><span>累计收益</span><strong className="gain">{percent(data.summary.portfolioReturn)}</strong><small>当前所选历史区间</small></article>
          <article><span>.NDX 基准</span><strong>{percent(data.summary.benchmarkReturn)}</strong><small>同期累计收益</small></article>
          <article><span>超额收益</span><strong className="gain">{percent(data.summary.activeReturn)}</strong><small>组合 − 基准</small></article>
        </div>
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
            <div className="panel-head"><div><h2>数据健康</h2><p>最后可信快照</p></div><span className="status">可用</span></div>
            <div className="health-score"><span style={{ flex: "0 0 32px", minWidth: 32, minHeight: 32, lineHeight: 1 }}>✓</span><div><strong>数据连续性</strong><p>{data.health.message}</p></div></div>
            <dl><div><dt>账本守恒</dt><dd>{data.health.ledgerBalanced ? "已验证" : "待 Phase 1 对账"}</dd></div><div><dt>逐日资产收益</dt><dd>{data.health.assetReturnsReconciled ? "已验证" : "待对账"}</dd></div>{data.health.eventCoverage && <div><dt>事件归一化</dt><dd>{data.health.eventCoverage.classified}/{data.health.eventCoverage.total}</dd></div>}{data.health.valuationCoverage && <div><dt>报告估值换汇</dt><dd>{data.health.valuationCoverage.fxReconciled}/{data.health.valuationCoverage.total} · {data.health.valuationCoverage.missingFx === 0 ? "已覆盖" : `${data.health.valuationCoverage.missingFx} 待补`}</dd></div>}{data.health.marketDataRequirement && <div><dt>日频行情输入</dt><dd>{data.health.marketDataCoverage ? `${data.health.marketDataCoverage.coveredSecurities}/${data.health.marketDataCoverage.requiredSecurities} 标的 · ${data.health.marketDataCoverage.coveredFxPairs}/${data.health.marketDataCoverage.requiredFxPairs} 汇率` : `${data.health.marketDataRequirement.canonicalInstrumentIds.length} 标的 · ${data.health.marketDataRequirement.fxPairs.length} 汇率待接入`}</dd></div>}<div><dt>时间加权收益 TWR</dt><dd>{percent(data.summary.portfolioReturn)}</dd></div>{data.summary.moneyWeightedReturn !== undefined && <div><dt>资金加权收益 MWR</dt><dd>{percent(data.summary.moneyWeightedReturn)} 年化</dd></div>}{data.summary.cumulativeMoneyWeightedReturn !== undefined && <div><dt>MWR 区间累计</dt><dd>{percent(data.summary.cumulativeMoneyWeightedReturn)}</dd></div>}<div><dt>数据来源</dt><dd>{data.health.source === "database-baseline" ? "PostgreSQL 基线" : data.health.source === "private-staging" ? "本地清洗数据" : "合成数据"}</dd></div><div><dt>策略版本</dt><dd>{data.meta.strategyVersion}</dd></div></dl>
          </article>
        </div>
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
