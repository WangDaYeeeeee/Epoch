"use client";

import { Activity, ShieldAlert } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useState, type PointerEvent as ReactPointerEvent } from "react";
import type { PortfolioRiskSnapshot } from "@/lib/types";

type RiskInstrument = PortfolioRiskSnapshot["instruments"][number] & { name: string };
type Diagnostics = NonNullable<PortfolioRiskSnapshot["modelDiagnostics"]>;
type Forecast = Diagnostics["forecasts"][number];
type RiskCompositionDatum = {
  instrument: RiskInstrument;
  color: string;
  weightShare: number;
  riskShare: number;
  hedging: boolean;
};

const percent = (value: number) => `${(value * 100).toFixed(2)}%`;
const bp2 = (value: number) => `${(value * 10000).toFixed(2)} bp²`;
const riskPalette = ["#8f7df4", "#e56e88", "#51c9b0", "#e7b764", "#5da8e8", "#c879e8", "#77c66e", "#e28d58"];

export function effectiveHoldingCount(values: number[]): number | null {
  const magnitudes = values.map(Math.abs).filter((value) => Number.isFinite(value) && value > 0);
  const total = magnitudes.reduce((sum, value) => sum + value, 0);
  const squaredTotal = magnitudes.reduce((sum, value) => sum + value * value, 0);
  return total > 0 && squaredTotal > 0 ? total * total / squaredTotal : null;
}

export function sortRiskInstruments<T extends { riskContribution: number; weight: number }>(instruments: T[]): T[] {
  return [...instruments].sort((left, right) => {
    const contributionDifference = Math.abs(right.riskContribution) - Math.abs(left.riskContribution);
    return contributionDifference || Math.abs(right.weight) - Math.abs(left.weight);
  });
}

export function riskAmplification(weight: number, contribution: number): number | null {
  return Math.abs(weight) > 1e-9 ? Math.abs(contribution) / Math.abs(weight) : null;
}

export function buildRiskComposition(instruments: RiskInstrument[]): RiskCompositionDatum[] {
  const weightTotal = instruments.reduce((sum, instrument) => sum + Math.abs(instrument.weight), 0);
  const riskTotal = instruments.reduce((sum, instrument) => sum + Math.abs(instrument.riskContribution), 0);
  return instruments.map((instrument, index) => ({
    instrument,
    color: riskPalette[index % riskPalette.length],
    weightShare: weightTotal > 0 ? Math.abs(instrument.weight) / weightTotal : 0,
    riskShare: riskTotal > 0 ? Math.abs(instrument.riskContribution) / riskTotal : 0,
    hedging: instrument.riskContribution < 0,
  }));
}

export function instrumentVolatilitySeries(
  instrumentId: string,
  current: Pick<PortfolioRiskSnapshot, "asOf" | "instruments">,
  history: PortfolioRiskSnapshot[],
): { date: string; value: number }[] {
  const byDate = new Map<string, number>();
  for (const snapshot of [...history, current]) {
    const instrument = snapshot.instruments.find((item) => item.instrumentId === instrumentId);
    if (instrument && Number.isFinite(instrument.volatilityAnnualized)) {
      byDate.set(snapshot.asOf.slice(0, 10), instrument.volatilityAnnualized);
    }
  }
  return [...byDate].map(([date, value]) => ({ date, value })).sort((left, right) => left.date.localeCompare(right.date));
}

function symbolFor(instrumentId: string) {
  return instrumentId.split(":").at(-1) ?? instrumentId;
}

function polarSectorPath(center: number, radius: number, startAngle: number, endAngle: number) {
  const point = (angle: number) => {
    const radians = angle * Math.PI / 180;
    return {
      x: center + radius * Math.cos(radians),
      y: center + radius * Math.sin(radians),
    };
  };
  const start = point(startAngle);
  const end = point(endAngle);
  return `M ${center} ${center} L ${start.x.toFixed(3)} ${start.y.toFixed(3)} A ${radius} ${radius} 0 ${endAngle - startAngle > 180 ? 1 : 0} 1 ${end.x.toFixed(3)} ${end.y.toFixed(3)} Z`;
}

function polarAnnularSectorPath(
  center: number,
  innerRadius: number,
  outerRadius: number,
  startAngle: number,
  endAngle: number,
) {
  const point = (radius: number, angle: number) => {
    const radians = angle * Math.PI / 180;
    return {
      x: center + radius * Math.cos(radians),
      y: center + radius * Math.sin(radians),
    };
  };
  const outerStart = point(outerRadius, startAngle);
  const outerEnd = point(outerRadius, endAngle);
  const innerEnd = point(innerRadius, endAngle);
  const innerStart = point(innerRadius, startAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return [
    `M ${outerStart.x.toFixed(3)} ${outerStart.y.toFixed(3)}`,
    `A ${outerRadius.toFixed(3)} ${outerRadius.toFixed(3)} 0 ${largeArc} 1 ${outerEnd.x.toFixed(3)} ${outerEnd.y.toFixed(3)}`,
    `L ${innerEnd.x.toFixed(3)} ${innerEnd.y.toFixed(3)}`,
    `A ${innerRadius.toFixed(3)} ${innerRadius.toFixed(3)} 0 ${largeArc} 0 ${innerStart.x.toFixed(3)} ${innerStart.y.toFixed(3)}`,
    "Z",
  ].join(" ");
}

export function proportionalSectorAreaOuterRadius(
  innerRadius: number,
  areaScale: number,
  share: number,
  angleRadians: number,
) {
  if (!(areaScale > 0) || !(share > 0) || !(angleRadians > 0)) return innerRadius;
  return Math.sqrt(innerRadius ** 2 + 2 * areaScale * share / angleRadians);
}

function tailTone(forecast: Forecast) {
  const ratio = forecast.positiveSemivariance22d > 0
    ? forecast.negativeSemivariance22d / forecast.positiveSemivariance22d
    : null;
  if ((ratio != null && ratio >= 1.5) || forecast.signedJump22d < -0.0005) return "high";
  if ((ratio != null && ratio >= 1.1) || forecast.signedJump22d < 0) return "medium";
  return "low";
}

function GlobalRiskComposition({
  current,
  data,
  history,
  maximumVolatility,
}: {
  current: Pick<PortfolioRiskSnapshot, "asOf" | "instruments">;
  data: RiskCompositionDatum[];
  history: PortfolioRiskSnapshot[];
  maximumVolatility: number;
}) {
  const [hovered, setHovered] = useState<{
    instrumentId: string;
    layer: "资金权重" | "风险贡献";
    x: number;
    y: number;
  } | null>(null);
  const center = 210;
  const weightRadius = 132;
  const riskInnerRadius = weightRadius;
  const riskMaximumOuterRadius = 190;
  let angleCursor = -90;
  const angularGeometry = data.map((item) => {
    const fullStartAngle = angleCursor;
    angleCursor += item.weightShare * 360;
    const fullEndAngle = angleCursor;
    const startAngle = fullStartAngle;
    const endAngle = fullEndAngle;
    const angleRadians = Math.max(0, endAngle - startAngle) * Math.PI / 180;
    return { ...item, startAngle, endAngle, angleRadians };
  });
  const availableScales = angularGeometry.flatMap((item) => item.riskShare > 0 && item.angleRadians > 0
    ? [0.5 * item.angleRadians * (riskMaximumOuterRadius ** 2 - riskInnerRadius ** 2) / item.riskShare]
    : []);
  const areaScale = availableScales.length ? Math.min(...availableScales) : 0;
  const geometry = angularGeometry.map((item) => {
    const riskOuterRadius = proportionalSectorAreaOuterRadius(
      riskInnerRadius,
      areaScale,
      item.riskShare,
      item.angleRadians,
    );
    return {
      ...item,
      weightPath: polarSectorPath(center, weightRadius, item.startAngle, item.endAngle),
      riskPath: polarAnnularSectorPath(center, riskInnerRadius, riskOuterRadius, item.startAngle, item.endAngle),
    };
  });
  const volatilitySeries = data.map((item, index) => ({
    ...item,
    key: `instrument${index}`,
    points: instrumentVolatilitySeries(item.instrument.instrumentId, current, history),
  }));
  const mixedByDate = new Map<string, Record<string, string | number>>();
  for (const series of volatilitySeries) {
    for (const point of series.points) {
      mixedByDate.set(point.date, {
        ...mixedByDate.get(point.date),
        date: point.date,
        [series.key]: point.value,
      });
    }
  }
  const mixedVolatility = [...mixedByDate.values()].sort((left, right) => String(left.date).localeCompare(String(right.date)));
  const moveTooltip = (
    event: ReactPointerEvent<SVGPathElement>,
    item: RiskCompositionDatum,
    layer: "资金权重" | "风险贡献",
  ) => {
    const bounds = event.currentTarget.ownerSVGElement?.getBoundingClientRect();
    if (!bounds) return;
    setHovered({
      instrumentId: item.instrument.instrumentId,
      layer,
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    });
  };
  const hoveredItem = hovered
    ? data.find((item) => item.instrument.instrumentId === hovered.instrumentId)
    : undefined;

  return (
    <section className="risk-composition" aria-labelledby="risk-composition-title">
      <div className="risk-composition-head">
        <div>
          <h4 id="risk-composition-title">组合结构对照</h4>
          <p>内环扇形角度表示资金权重，外环面积表示风险贡献</p>
        </div>
        <div className="risk-ring-key">
          <span><i className="outer" />外环 · 风险贡献</span>
          <span><i className="inner" />内环 · 资金权重</span>
        </div>
      </div>
      <div className="risk-composition-body">
        <div className="risk-composition-legend">
          <div className="risk-composition-labels">
            <span>标的</span>
            <span>权重</span>
            <span>风险</span>
          </div>
          {volatilitySeries.map((item) => (
            <div className="risk-composition-item" key={item.instrument.instrumentId}>
              <div className="risk-legend-identity">
                <i style={{ background: item.color }} />
                <div>
                  <strong>{symbolFor(item.instrument.instrumentId)}</strong>
                  <small>{item.instrument.name}</small>
                </div>
              </div>
              <span>{percent(item.weightShare)}</span>
              <span className={item.hedging ? "hedging" : ""}>{percent(item.riskShare)}</span>
            </div>
          ))}
        </div>
        <figure>
          <div className="risk-area-rings">
            <svg aria-label="资金权重扇形图与风险贡献面积环" role="img" viewBox="0 0 420 420">
              <g className="risk-weight-sectors">
                {geometry.map((item) => (
                    <path
                      className={hovered?.instrumentId === item.instrument.instrumentId ? "active" : ""}
                      d={item.weightPath}
                      fill={item.color}
                      key={`${item.instrument.instrumentId}-weight`}
                      onPointerEnter={(event) => moveTooltip(event, item, "资金权重")}
                      onPointerLeave={() => setHovered(null)}
                      onPointerMove={(event) => moveTooltip(event, item, "资金权重")}
                    />
                ))}
              </g>
              <g className="risk-area-values">
                {geometry.map((item) => (
                    <path
                      className={`${item.hedging ? "hedging " : ""}${hovered?.instrumentId === item.instrument.instrumentId ? "active" : ""}`}
                      d={item.riskPath}
                      fill={item.color}
                      key={`${item.instrument.instrumentId}-risk`}
                      onPointerEnter={(event) => moveTooltip(event, item, "风险贡献")}
                      onPointerLeave={() => setHovered(null)}
                      onPointerMove={(event) => moveTooltip(event, item, "风险贡献")}
                    />
                ))}
              </g>
            </svg>
            {hovered && hoveredItem && (
              <div className="risk-sector-tooltip" style={{ left: hovered.x, top: hovered.y }}>
                <span>{hovered.layer}</span>
                <strong>{symbolFor(hoveredItem.instrument.instrumentId)}</strong>
                <small>{hoveredItem.instrument.name}</small>
                <dl>
                  <div><dt>资金</dt><dd>{percent(hoveredItem.weightShare)}</dd></div>
                  <div><dt>风险</dt><dd>{percent(hoveredItem.riskShare)}</dd></div>
                  <div><dt>放大</dt><dd>{riskAmplification(hoveredItem.weightShare, hoveredItem.riskShare)?.toFixed(2)}×</dd></div>
                  <div><dt>波动率</dt><dd>{percent(hoveredItem.instrument.volatilityAnnualized)}</dd></div>
                </dl>
              </div>
            )}
          </div>
          <figcaption>内外层连续贴合且共用扇区边界；外层半径变化表示风险贡献</figcaption>
        </figure>
        <div className="risk-volatility-mix">
          <div>
            <h5>标的波动率趋势</h5>
            <span>统一纵轴 · 年化</span>
          </div>
          {mixedVolatility.length > 1 ? (
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={mixedVolatility} margin={{ top: 10, right: 8, bottom: 0, left: -14 }}>
                <CartesianGrid stroke="rgba(118,98,238,.12)" strokeDasharray="3 4" vertical={false} />
                <XAxis dataKey="date" minTickGap={34} tick={{ fill: "#68627f", fontSize: 7 }} tickLine={false} axisLine={false} />
                <YAxis domain={[0, maximumVolatility]} tickFormatter={(value) => `${(Number(value) * 100).toFixed(0)}%`} tick={{ fill: "#68627f", fontSize: 7 }} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ background: "#100b30", border: "1px solid rgba(169,155,255,.24)", borderRadius: 8, fontSize: 8 }}
                  formatter={(value, name) => [percent(Number(value)), String(name)]}
                  labelStyle={{ color: "#8f89a4" }}
                />
                {volatilitySeries.map((item) => (
                  <Line
                    connectNulls
                    dataKey={item.key}
                    dot={false}
                    isAnimationActive={false}
                    key={item.instrument.instrumentId}
                    name={symbolFor(item.instrument.instrumentId)}
                    stroke={item.color}
                    strokeWidth={1.7}
                    type="monotone"
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          ) : <p>等待更多历史风险批次。</p>}
        </div>
      </div>
    </section>
  );
}

function TailRiskPanel({
  diagnostics,
  instruments,
}: {
  diagnostics?: Diagnostics;
  instruments: RiskInstrument[];
}) {
  const instrumentById = new Map(instruments.map((instrument) => [instrument.instrumentId, instrument]));
  const forecasts = [...(diagnostics?.forecasts ?? [])]
    .filter((forecast) => instrumentById.has(forecast.instrumentId))
    .sort((left, right) => {
      const leftScore = left.negativeSemivariance22d - left.positiveSemivariance22d - Math.min(0, left.signedJump22d);
      const rightScore = right.negativeSemivariance22d - right.positiveSemivariance22d - Math.min(0, right.signedJump22d);
      return rightScore - leftScore;
    });
  const semivarianceMaximum = Math.max(
    ...forecasts.flatMap((forecast) => [forecast.positiveSemivariance22d, forecast.negativeSemivariance22d]),
    0,
  );

  return (
    <section className="tail-risk-panel" aria-labelledby="tail-risk-title">
      <div className="tail-risk-head">
        <div>
          <ShieldAlert aria-hidden="true" size={14} />
          <div>
            <h4 id="tail-risk-title">尾部风险</h4>
            <p>下行半方差、跳跃方向与样本外模型误差</p>
          </div>
        </div>
        <span>按下行偏斜排序</span>
      </div>
      {forecasts.length ? (
        <div className="tail-risk-table">
          <div className="tail-risk-row tail-risk-labels">
            <span>标的</span><span>上下行半方差</span><span>尾部不对称</span><span>跳跃方向</span><span>OOS RMSE</span>
          </div>
          {forecasts.map((forecast) => {
            const instrument = instrumentById.get(forecast.instrumentId)!;
            const ratio = forecast.positiveSemivariance22d > 0
              ? forecast.negativeSemivariance22d / forecast.positiveSemivariance22d
              : null;
            const tone = tailTone(forecast);
            return (
              <div className="tail-risk-row" key={forecast.instrumentId}>
                <div className="tail-risk-identity">
                  <strong>{symbolFor(forecast.instrumentId)}</strong>
                  <span>{instrument.name}</span>
                </div>
                <div className="tail-semivariance">
                  <div><span>下行</span><i><b style={{ width: `${semivarianceMaximum ? forecast.negativeSemivariance22d / semivarianceMaximum * 100 : 0}%` }} /></i><strong>{bp2(forecast.negativeSemivariance22d)}</strong></div>
                  <div><span>上行</span><i><b style={{ width: `${semivarianceMaximum ? forecast.positiveSemivariance22d / semivarianceMaximum * 100 : 0}%` }} /></i><strong>{bp2(forecast.positiveSemivariance22d)}</strong></div>
                </div>
                <div className={`tail-asymmetry ${tone}`}>
                  <strong>{ratio == null ? "—" : `${ratio.toFixed(2)}×`}</strong>
                  <span>{tone === "high" ? "显著下行" : tone === "medium" ? "轻度下行" : "相对均衡"}</span>
                </div>
                <strong className={forecast.signedJump22d < 0 ? "tail-jump negative" : "tail-jump positive"}>
                  {bp2(forecast.signedJump22d)}
                </strong>
                <div className="tail-rmse">
                  <strong>{bp2(forecast.expandingWindowBacktest.rmse)}</strong>
                  <span>{forecast.expandingWindowBacktest.observations} 次回测</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : <p className="tail-risk-empty">当前标的暂无 SHAR 尾部风险诊断。</p>}
    </section>
  );
}

export function RiskInstrumentDetails({
  current,
  diagnostics,
  history,
  instruments,
}: {
  current: Pick<PortfolioRiskSnapshot, "asOf" | "instruments">;
  diagnostics?: Diagnostics;
  history: PortfolioRiskSnapshot[];
  instruments: RiskInstrument[];
}) {
  const ordered = sortRiskInstruments(instruments);
  const composition = buildRiskComposition(ordered);
  const riskEffectiveCount = effectiveHoldingCount(instruments.map((instrument) => instrument.riskContribution));
  const weightEffectiveCount = effectiveHoldingCount(instruments.map((instrument) => instrument.weight));
  const maximumVolatility = Math.max(
    ...instruments.map((instrument) => instrument.volatilityAnnualized),
    ...history.flatMap((snapshot) => snapshot.instruments.map((instrument) => instrument.volatilityAnnualized)),
    0.01,
  );
  const absoluteRiskTotal = ordered.reduce((sum, instrument) => sum + Math.abs(instrument.riskContribution), 0);
  const topRiskShare = absoluteRiskTotal > 0
    ? ordered.slice(0, 3).reduce((sum, instrument) => sum + Math.abs(instrument.riskContribution), 0) / absoluteRiskTotal
    : 0;

  return (
    <section className="risk-instrument-details">
      <div className="risk-instrument-head">
        <div>
          <h3>标的风险预算</h3>
          <p>全组合双环对照资金分配与风险分配，直接识别风险放大与对冲来源</p>
        </div>
      </div>
      <div className="risk-concentration-summary">
        <div>
          <Activity aria-hidden="true" size={14} />
          <p>
            当前 <strong>{instruments.length}</strong> 个标的形成约{" "}
            <strong>{riskEffectiveCount == null ? "—" : riskEffectiveCount.toFixed(1)}</strong> 个风险有效持仓，
            前三大风险来源占绝对风险贡献的 <strong>{percent(topRiskShare)}</strong>。
          </p>
        </div>
        <dl>
          <div><dt>风险有效持仓</dt><dd>{riskEffectiveCount == null ? "—" : riskEffectiveCount.toFixed(1)}</dd></div>
          <div><dt>权重有效持仓</dt><dd>{weightEffectiveCount == null ? "—" : weightEffectiveCount.toFixed(1)}</dd></div>
        </dl>
      </div>

      <GlobalRiskComposition current={current} data={composition} history={history} maximumVolatility={maximumVolatility} />

      <TailRiskPanel diagnostics={diagnostics} instruments={instruments} />
    </section>
  );
}
