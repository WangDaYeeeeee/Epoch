"use client";

import { Layers3 } from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";
import type { PortfolioRiskSnapshot } from "@/lib/types";

type RiskInstrument = PortfolioRiskSnapshot["instruments"][number] & { name: string };
type Diagnostics = NonNullable<PortfolioRiskSnapshot["modelDiagnostics"]>;

const percent = (value: number) => `${(value * 100).toFixed(2)}%`;
const bp2 = (value: number) => `${(value * 10000).toFixed(2)} bp²`;
export function effectiveHoldingCount(values: number[]): number | null {
  const magnitudes = values.map(Math.abs).filter((value) => Number.isFinite(value) && value > 0);
  const total = magnitudes.reduce((sum, value) => sum + value, 0);
  const squaredTotal = magnitudes.reduce((sum, value) => sum + value * value, 0);
  return total > 0 && squaredTotal > 0 ? total * total / squaredTotal : null;
}
export function deckStackOrder(offset: number, total: number): number {
  return total + offset;
}
export function dockCardScale(distance: number | null): number {
  if (distance == null) return 0.72;
  if (distance === 0) return 1.16;
  if (Math.abs(distance) === 1) return 0.82;
  return 0.72;
}
export function dockCardShift(distance: number | null): number {
  if (distance == null || distance === 0) return 0;
  return Math.sign(distance) * 46;
}
export function dockHoverIndex(pointerX: number, containerWidth: number, total: number, spacing = 154): number {
  if (total <= 0 || containerWidth <= 0) return -1;
  const firstCenter = containerWidth / 2 - (total - 1) / 2 * spacing;
  const index = Math.round((pointerX - firstCenter) / spacing);
  if (index < 0 || index >= total) return -1;
  const cardCenter = firstCenter + index * spacing;
  return Math.abs(pointerX - cardCenter) <= spacing * 0.6 ? index : -1;
}
export function sortRiskCardsByWeight<T extends { weight: number }>(instruments: T[]): T[] {
  return [...instruments].sort((left, right) => right.weight - left.weight);
}
const meterStyle = (value: number, max: number, color: string) => ({
  "--meter-width": `${max > 0 ? Math.max(4, Math.abs(value) / max * 100) : 0}%`,
  "--meter-color": color,
}) as CSSProperties;

function toneForCapital(value: number | null) {
  if (value == null) return "";
  return value > 0.65 ? "high" : value > 0.4 ? "medium" : "low";
}

function symbolFor(instrumentId: string) {
  return instrumentId.split(":").at(-1) ?? instrumentId;
}

type RiskDeckMaxima = {
  weight: number;
  volatility: number;
  contribution: number;
  capital: number;
};

function RiskDeckCard({
  active,
  forecast,
  instrument,
  maxima,
  rank,
}: {
  active: boolean;
  forecast?: Diagnostics["forecasts"][number];
  instrument: RiskInstrument;
  maxima: RiskDeckMaxima;
  rank: number;
}) {
  return (
    <article aria-hidden="true" className={`risk-deck-card ${active ? "active" : ""}`}>
      <div className="risk-card-detail-head">
        <span>{active ? "SELECTED POSITION" : "POSITION RISK"}</span>
        <em className={toneForCapital(instrument.riskCapitalRatio)}>权重 #{rank}</em>
      </div>
      <strong>{symbolFor(instrument.instrumentId)}</strong>
      <small>{instrument.name}</small>
      <div className="risk-card-detail-score">
        <b>{percent(instrument.riskContribution)}</b>
        <span>组合风险贡献</span>
      </div>
      <div className="risk-card-metrics">
        {[
          { label: "组合权重", value: instrument.weight, max: maxima.weight, color: "#7662ee" },
          { label: "年化波动率", value: instrument.volatilityAnnualized, max: maxima.volatility, color: "#e0bd72" },
          { label: "风险贡献", value: instrument.riskContribution, max: maxima.contribution, color: "#f07a89" },
          { label: "风险资本比", value: instrument.riskCapitalRatio, max: maxima.capital, color: "#5bc59b" },
        ].map((metric) => (
          <div className="risk-card-metric" key={metric.label}>
            <span>{metric.label}</span>
            <strong>{metric.value == null ? "—" : percent(metric.value)}</strong>
            <i style={meterStyle(metric.value ?? 0, metric.max, metric.color)} />
          </div>
        ))}
      </div>
      <div className="risk-card-shar">
        <span>SHAR 尾部截面</span>
        {forecast ? (
          <div>
            <p><small>RS⁺</small><strong>{bp2(forecast.positiveSemivariance22d)}</strong></p>
            <p><small>RS⁻</small><strong>{bp2(forecast.negativeSemivariance22d)}</strong></p>
            <p><small>ΔJ</small><strong className={forecast.signedJump22d < 0 ? "negative" : "positive"}>{bp2(forecast.signedJump22d)}</strong></p>
            <p><small>OOS RMSE</small><strong>{bp2(forecast.expandingWindowBacktest.rmse)}</strong></p>
          </div>
        ) : <em>当前标的暂无 SHAR 诊断</em>}
      </div>
    </article>
  );
}

function RiskCardDeck({
  instruments,
  diagnostics,
}: {
  instruments: RiskInstrument[];
  diagnostics?: Diagnostics;
}) {
  const ordered = useMemo(
    () => sortRiskCardsByWeight(instruments),
    [instruments],
  );
  const [hoveredId, setHoveredId] = useState("");
  const activeIndex = ordered.findIndex((item) => item.instrumentId === hoveredId);
  const maxima = {
    weight: Math.max(...ordered.map((item) => Math.abs(item.weight)), 0),
    volatility: Math.max(...ordered.map((item) => item.volatilityAnnualized), 0),
    contribution: Math.max(...ordered.map((item) => Math.abs(item.riskContribution)), 0),
    capital: Math.max(...ordered.map((item) => Math.abs(item.riskCapitalRatio ?? 0)), 0),
  };
  if (!ordered.length) return <div className="risk-card-empty">暂无可展示的标的风险。</div>;

  return (
    <div
      aria-label="标的风险卡组"
      className="risk-card-deck"
      role="region"
    >
      <div className="risk-card-deck-head">
        <div>
          <Layers3 aria-hidden="true" size={14} />
          <span>风险卡组</span>
          <small>悬停查看</small>
        </div>
      </div>

      <div
        className="risk-card-stage"
        aria-label="标的风险卡片，可悬停放大查看"
        onMouseLeave={() => setHoveredId("")}
        onMouseMove={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          const pointerY = event.clientY - bounds.top;
          if (pointerY < 12 || pointerY > bounds.height - 12) {
            setHoveredId("");
            return;
          }
          const spacing = bounds.width <= 700 ? 96 : 154;
          const hoverIndex = dockHoverIndex(event.clientX - bounds.left, bounds.width, ordered.length, spacing);
          const nextHoveredId = hoverIndex < 0 ? "" : ordered[hoverIndex].instrumentId;
          setHoveredId((current) => current === nextHoveredId ? current : nextHoveredId);
        }}
      >
        <div aria-live="polite" className="risk-detail-card-rail">
          {ordered.map((instrument, index) => {
            const distance = activeIndex < 0 ? null : index - activeIndex;
            const scale = dockCardScale(distance);
            const shift = dockCardShift(distance);
            const baseOffset = (index - (ordered.length - 1) / 2) * 154;
            const mobileBaseOffset = (index - (ordered.length - 1) / 2) * 96;
            const active = index === activeIndex;
            const deckStyle = {
              "--deck-x": `${baseOffset + shift}px`,
              "--deck-mobile-x": `${mobileBaseOffset + shift * 0.65}px`,
              "--deck-z": "0px",
              "--deck-order": active ? ordered.length + 20 : deckStackOrder(index, ordered.length),
              "--deck-scale": scale,
              "--deck-mobile-scale": Math.max(0.64, scale * 0.94),
              "--deck-y": active ? "-4px" : Math.abs(distance ?? 2) === 1 ? "-3px" : "0px",
              "--deck-rotate-y": active ? "3deg" : Math.abs(distance ?? 2) === 1 ? "7deg" : "10deg",
            } as CSSProperties;
            return (
              <div className="risk-deck-card-slot" key={instrument.instrumentId}>
                <div
                  className={`risk-deck-card-visual ${active ? "active" : ""}`}
                  style={deckStyle}
                >
                  <RiskDeckCard
                    active={active}
                    forecast={diagnostics?.forecasts.find((item) => item.instrumentId === instrument.instrumentId)}
                    instrument={instrument}
                    maxima={maxima}
                    rank={index + 1}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function RiskInstrumentDetails({
  instruments,
  diagnostics,
}: {
  instruments: RiskInstrument[];
  diagnostics?: Diagnostics;
}) {
  const riskEffectiveCount = effectiveHoldingCount(instruments.map((instrument) => instrument.riskContribution));
  const weightEffectiveCount = effectiveHoldingCount(instruments.map((instrument) => instrument.weight));

  return (
    <section className="risk-instrument-details">
      <div className="risk-instrument-head">
        <div>
          <h3>标的风险明细</h3>
          <p>逐一打开每个标的的完整风险截面</p>
        </div>
      </div>
      <div className="risk-effective-holdings">
        <div className="primary" title="基于绝对风险贡献份额的逆 Herfindahl 指数">
          <span>风险有效持仓</span>
          <strong>{riskEffectiveCount == null ? "—" : riskEffectiveCount.toFixed(1)} <small>/ {instruments.length}</small></strong>
          <em>风险实际上分散到多少个等贡献标的</em>
        </div>
        <div title="基于绝对仓位权重的逆 Herfindahl 指数">
          <span>权重有效持仓</span>
          <strong>{weightEffectiveCount == null ? "—" : weightEffectiveCount.toFixed(1)}</strong>
          <em>资金权重集中度</em>
        </div>
        <div>
          <span>实际标的</span>
          <strong>{instruments.length}</strong>
          <em>当前风险计算集合</em>
        </div>
      </div>

      <RiskCardDeck instruments={instruments} diagnostics={diagnostics} />
    </section>
  );
}
