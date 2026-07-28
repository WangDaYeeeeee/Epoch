"use client";

import { useEffect, useState } from "react";
import type { RiskDriftSnapshot } from "@/lib/domain/risk-drift";

export type NamedRiskDriftInstrument = RiskDriftSnapshot["instruments"][number] & { name: string };

const percent = (value: number) => `${(value * 100).toFixed(2)}%`;
const ratio = (value: number | null) => value == null ? "—" : `${value.toFixed(2)}×`;

export function RiskDriftCard({
  drift,
  instruments,
}: {
  drift?: RiskDriftSnapshot;
  instruments: NamedRiskDriftInstrument[];
}) {
  const [open, setOpen] = useState(false);
  const closeModal = () => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeModal();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  if (!drift) {
    return (
      <section className="risk-metric-card risk-drift-metric-card unavailable">
        <div className="risk-metric-head"><span>基准仓位漂移</span></div>
        <div className="risk-metric-copy">
          <strong>尚未设置</strong>
          <small>请先录入基准目标仓位</small>
        </div>
      </section>
    );
  }

  return <>
    <button
      className={`risk-metric-card risk-drift-metric-card tone-${drift.portfolio.level === "normal" ? "green" : drift.portfolio.level === "highlight" ? "yellow" : "red"}`}
      type="button"
      onClick={() => setOpen(true)}
    >
      <div className="risk-metric-head">
        <span>基准仓位漂移</span>
        <em>点击查看详情</em>
      </div>
      <div className="risk-metric-copy">
        <strong>{ratio(drift.portfolio.ratio)}</strong>
        <small>σₚ / σₚ⁰ · 锚点 {drift.effectiveAt.slice(0, 10)}</small>
      </div>
      <div className="risk-drift-mini-stats">
        <span>D<sub>w</sub></span>
        <b>{percent(drift.divergence.weight)}</b>
        <span>D<sub>r</sub></span>
        <b>{drift.divergence.riskContribution == null ? "—" : percent(drift.divergence.riskContribution)}</b>
      </div>
    </button>
    {open && (
      <div
        className="risk-detail-backdrop"
        role="presentation"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeModal();
        }}
      >
        <section aria-labelledby="risk-drift-modal-title" aria-modal="true" className="risk-detail-modal risk-drift-modal" role="dialog">
          <div className="risk-detail-head">
            <div>
              <span>BASELINE DRIFT</span>
              <h3 id="risk-drift-modal-title">基准仓位漂移详情</h3>
              <p>锚点 {drift.effectiveAt.slice(0, 10)} · 当前风险相对基准目标仓位</p>
            </div>
            <div className="risk-detail-current">
              <small>σₚ / σₚ⁰</small>
              <strong>{ratio(drift.portfolio.ratio)}</strong>
            </div>
            <button aria-label="关闭基准仓位漂移浮窗" type="button" onClick={closeModal}>×</button>
          </div>
          <div className="risk-drift-modal-summary">
            <div><span>锚点组合波动率</span><strong>{percent(drift.portfolio.anchorVolatilityAnnualized)}</strong></div>
            <div><span>当前组合波动率</span><strong>{percent(drift.portfolio.currentVolatilityAnnualized)}</strong></div>
            <div><span>权重偏离 D<sub>w</sub></span><strong>{percent(drift.divergence.weight)}</strong></div>
            <div><span>风险贡献偏离 D<sub>r</sub></span><strong>{drift.divergence.riskContribution == null ? "—" : percent(drift.divergence.riskContribution)}</strong></div>
          </div>
          <div className="risk-drift-detail-table">
            <div className="risk-drift-detail-row head">
              <span>标的</span><span>目标仓位</span><span>当前仓位</span><span>锚点波动率</span><span>当前波动率</span><span>波动倍数</span>
            </div>
            {instruments.map((item) => (
              <div className={`risk-drift-detail-row drift-${item.level}`} key={item.instrumentId}>
                <strong className="instrument-identity">
                  <span>{item.instrumentId}</span>
                  <small>{item.name}</small>
                </strong>
                <span>{percent(item.anchorWeight)}</span>
                <span>{item.currentWeight == null ? "已退出" : percent(item.currentWeight)}</span>
                <span>{percent(item.anchorVolatilityAnnualized)}</span>
                <span>{item.currentVolatilityAnnualized == null ? "—" : percent(item.currentVolatilityAnnualized)}</span>
                <span>{ratio(item.ratio)}</span>
              </div>
            ))}
          </div>
          <p className="risk-detail-note">
            波动倍数 = 当前 60 日年化波动率 ÷ 锚点 60 日年化波动率。锚点与当前结果使用相同行情窗口时，单标的倍数为 1.00× 属于正常结果。
          </p>
        </section>
      </div>
    )}
  </>;
}
