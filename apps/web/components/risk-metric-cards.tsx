"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Area, AreaChart, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { RiskDriftCard, type NamedRiskDriftInstrument } from "@/components/risk-drift-card";
import { TimeRangeScrubber } from "@/components/time-range-scrubber";
import type { RiskDriftSnapshot } from "@/lib/domain/risk-drift";
import type { PortfolioRiskSnapshot } from "@/lib/types";

type MetricKey = "volatility" | "stress" | "cvar";
type MetricDefinition = {
  key: MetricKey;
  label: string;
  value: (point: PortfolioRiskSnapshot) => number | null;
};

const definitions: MetricDefinition[] = [
  { key: "volatility", label: "组合 σₚ", value: (point) => point.portfolio.volatilityAnnualized },
  { key: "stress", label: "Stress σₚ", value: (point) => point.portfolio.stressVolatilityAnnualized },
  { key: "cvar", label: "历史 CVaR", value: (point) => point.portfolio.historicalCvarLoss },
];
type RiskTone = "green" | "yellow" | "red" | "neutral";
const toneColors: Record<RiskTone, string> = {
  green: "#5bc59b",
  yellow: "#e0bd72",
  red: "#f07a89",
  neutral: "#a99bff",
};
const metricTone = (key: MetricKey, value: number | null, risk: PortfolioRiskSnapshot): RiskTone => {
  if (value == null) return "neutral";
  if (key === "volatility") {
    const ratio = value / risk.policyGate.limitAnnualized;
    return ratio > 1 ? "red" : ratio > 0.8 ? "yellow" : "green";
  }
  if (key === "stress") {
    const ratio = value / risk.policyGate.limitAnnualized;
    return ratio > 1.25 ? "red" : ratio > 1 ? "yellow" : "green";
  }
  return value > 0.05 ? "red" : value > 0.03 ? "yellow" : "green";
};
const formatPercent = (value: number) => `${(value * 100).toFixed(2)}%`;
const defaultRange = (points: { date: string }[]) => {
  if (!points.length) return { startIndex: 0, endIndex: 0 };
  const latest = new Date(`${points.at(-1)!.date}T00:00:00Z`);
  latest.setUTCFullYear(latest.getUTCFullYear() - 1);
  const cutoff = latest.toISOString().slice(0, 10);
  const startIndex = points.findIndex((point) => point.date >= cutoff);
  return {
    startIndex: startIndex < 0 ? 0 : startIndex,
    endIndex: points.length - 1,
  };
};

export function RiskMetricCards({
  risk,
  history,
  performance,
  drift,
  driftInstruments,
}: {
  risk: PortfolioRiskSnapshot;
  history: PortfolioRiskSnapshot[];
  performance: { date: string; portfolio: number }[];
  drift?: RiskDriftSnapshot;
  driftInstruments: NamedRiskDriftInstrument[];
}) {
  const [selected, setSelected] = useState<MetricKey | null>(null);
  const [range, setRange] = useState({ startIndex: 0, endIndex: 0 });
  const selectedDefinition = definitions.find((item) => item.key === selected);
  const selectedValue = selectedDefinition ? selectedDefinition.value(risk) : null;
  const selectedTone = selectedDefinition ? metricTone(selectedDefinition.key, selectedValue, risk) : "neutral";
  const selectedColor = toneColors[selectedTone];
  const closeModal = () => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    setSelected(null);
  };

  useEffect(() => {
    if (!selected) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        setSelected(null);
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [selected]);

  const historyFor = (definition: MetricDefinition) => history.flatMap((point, index) => {
    const value = definition.value(point);
    return value == null ? [] : [{
      id: point.calculationId,
      date: point.asOf.slice(0, 10),
      sequence: index + 1,
      value,
    }];
  });
  const selectedPoints = selectedDefinition ? historyFor(selectedDefinition) : [];
  const visiblePoints = selectedPoints.slice(range.startIndex, range.endIndex + 1);
  const visibleRangeLabel = visiblePoints.length
    ? `${visiblePoints[0].date} — ${visiblePoints.at(-1)!.date}`
    : "暂无可用区间";
  const combinedData = useMemo(() => {
    if (!visiblePoints.length) return [];
    const dateFrom = visiblePoints[0].date;
    const dateTo = visiblePoints.at(-1)!.date;
    const performanceWindow = performance.filter((point) => point.date >= dateFrom && point.date <= dateTo);
    const performanceBase = performanceWindow[0]?.portfolio;
    const byDate = new Map<string, { date: string; portfolioReturn?: number; riskValue?: number }>();
    for (const point of performanceWindow) {
      byDate.set(point.date, {
        date: point.date,
        portfolioReturn: performanceBase ? point.portfolio / performanceBase - 1 : undefined,
      });
    }
    for (const point of visiblePoints) {
      byDate.set(point.date, { ...byDate.get(point.date), date: point.date, riskValue: point.value });
    }
    return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
  }, [performance, visiblePoints]);

  return <>
    <div className="risk-metrics">
      {definitions.map((definition) => {
        const value = definition.value(risk);
        const tone = metricTone(definition.key, value, risk);
        const color = toneColors[tone];
        const points = historyFor(definition);
        const description = definition.key === "volatility"
          ? `持仓权重 × 60 日 OHLC · 卡口余量 ${formatPercent(risk.policyGate.limitAnnualized - risk.policyGate.observedAnnualized)}`
          : definition.key === "stress"
            ? "相关系数非对角统一设为 0.90"
            : `${(risk.portfolio.cvarConfidence * 100).toFixed(0)}% 置信度 · 损失口径`;
        return (
          <button
            className={`risk-metric-card ${definition.key} tone-${tone}`}
            key={definition.key}
            type="button"
            onClick={() => {
              setRange(defaultRange(points));
              setSelected(definition.key);
            }}
          >
            <div className="risk-metric-head">
              <span>{definition.label}</span>
              <em>点击查看详情</em>
            </div>
            <div className="risk-metric-copy">
              <strong>{value == null ? "不可用" : formatPercent(value)}</strong>
              <small>{description}</small>
            </div>
            <div className="risk-sparkline" aria-hidden="true">
              {points.length > 1 ? (
                <ResponsiveContainer width="100%" height={62}>
                  <AreaChart data={points}>
                    <defs>
                      <linearGradient id={`spark-${definition.key}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={color} stopOpacity={0.3} />
                        <stop offset="100%" stopColor={color} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke={color}
                      strokeWidth={1.6}
                      fill={`url(#spark-${definition.key})`}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : <span>暂无历史趋势</span>}
            </div>
          </button>
        );
      })}
      <RiskDriftCard drift={drift} instruments={driftInstruments} />
    </div>
    {selectedDefinition && createPortal((
      <div
        className="risk-detail-backdrop"
        role="presentation"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeModal();
        }}
      >
        <section aria-labelledby="risk-detail-title" aria-modal="true" className="risk-detail-modal" role="dialog">
          <div className="risk-detail-head">
            <div>
              <span>RISK HISTORY</span>
              <h3 id="risk-detail-title">{selectedDefinition.label} 趋势</h3>
              <p>默认最近 1 年 · 当前 {visiblePoints.length} 点 / 全部 {selectedPoints.length} 点</p>
            </div>
            <div className="risk-detail-current">
              <small>当前</small>
              <strong>{formatPercent(selectedDefinition.value(risk) ?? 0)}</strong>
            </div>
            <button aria-label="关闭风险趋势浮窗" type="button" onClick={closeModal}>×</button>
          </div>
          <div className="risk-detail-range">
            <span>{visibleRangeLabel}</span>
            <div className="risk-detail-series-key">
              <small><i style={{ background: selectedColor }} />{selectedDefinition.label}</small>
              <small><i className="portfolio" />组合净值区间表现</small>
            </div>
          </div>
          <div className="risk-detail-chart">
            <ResponsiveContainer width="100%" height={330}>
              <ComposedChart data={combinedData} margin={{ top: 22, right: 4, bottom: 8, left: 0 }}>
                <defs>
                  <linearGradient id={`risk-area-shadow-${selectedDefinition.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={selectedColor} stopOpacity="0.18" />
                    <stop offset="58%" stopColor={selectedColor} stopOpacity="0.03" />
                    <stop offset="100%" stopColor={selectedColor} stopOpacity="0" />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(169,155,255,.12)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#7f7999" }} tickLine={false} axisLine={false} minTickGap={28} />
                <YAxis yAxisId="portfolio" domain={["auto", "auto"]} tickFormatter={(value) => `${Number(value) >= 0 ? "+" : ""}${(Number(value) * 100).toFixed(1)}%`} tick={{ fontSize: 9, fill: "#7662ee" }} tickLine={false} axisLine={false} width={48} />
                <YAxis yAxisId="risk" orientation="right" domain={["auto", "auto"]} tickFormatter={(value) => `${(Number(value) * 100).toFixed(1)}%`} tick={{ fontSize: 9, fill: selectedColor }} tickLine={false} axisLine={false} width={48} />
                <Tooltip
                  contentStyle={{
                    background: "rgba(15,10,40,.9)",
                    border: "1px solid rgba(207,199,255,.16)",
                    borderRadius: 10,
                    boxShadow: "0 14px 34px rgba(0,0,0,.38), inset 0 1px 0 rgba(255,255,255,.06)",
                    backdropFilter: "blur(18px) saturate(115%)",
                    padding: "8px 10px",
                    fontSize: 9,
                  }}
                  formatter={(value, name) => [
                    `${Number(value) >= 0 && name === "组合净值区间表现" ? "+" : ""}${formatPercent(Number(value))}`,
                    name,
                  ]}
                />
                {selectedDefinition.key === "volatility" && (
                  <ReferenceLine yAxisId="risk" y={risk.policyGate.limitAnnualized} stroke="#f07a89" strokeDasharray="6 5" label={{ value: "45% 卡口", fill: "#f07a89", fontSize: 9 }} />
                )}
                <Line
                  yAxisId="portfolio"
                  type="monotone"
                  dataKey="portfolioReturn"
                  name="组合净值区间表现"
                  stroke="#7662ee"
                  strokeWidth={1.4}
                  strokeDasharray="6 5"
                  dot={false}
                  animationDuration={750}
                  animationEasing="ease-out"
                />
                <Area
                  yAxisId="risk"
                  type="monotone"
                  dataKey="riskValue"
                  name={selectedDefinition.label}
                  stroke={selectedColor}
                  strokeWidth={2.8}
                  fill={`url(#risk-area-shadow-${selectedDefinition.key})`}
                  fillOpacity={1}
                  baseValue="dataMin"
                  dot={false}
                  connectNulls
                  activeDot={{
                    r: 4.8,
                    fill: selectedColor,
                    stroke: "#090716",
                    strokeWidth: 2,
                  }}
                  animationDuration={750}
                  animationEasing="ease-out"
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <TimeRangeScrubber
            data={selectedPoints.map((point) => ({ date: point.date, preview: point.value }))}
            range={range}
            onChange={setRange}
            accent={selectedColor}
          />
          <p className="risk-detail-note">每个风险点均来自当日真实持仓；组合净值按当前所选窗口起点重新归一化。</p>
        </section>
      </div>
    ), document.body)}
  </>;
}
