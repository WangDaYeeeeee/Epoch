"use client";

import { useMemo, useState, type CSSProperties } from "react";
import type { PortfolioRiskSnapshot } from "@/lib/types";

type RiskInstrument = PortfolioRiskSnapshot["instruments"][number] & { name: string };
type Diagnostics = NonNullable<PortfolioRiskSnapshot["modelDiagnostics"]>;
type View = "contribution" | "shar";
type SortKey = "riskContribution" | "weight" | "volatilityAnnualized" | "jump" | "downside" | "rmse";

const percent = (value: number) => `${(value * 100).toFixed(2)}%`;
const bp2 = (value: number) => `${(value * 10000).toFixed(2)} bp²`;
const meterStyle = (value: number, max: number, color: string) => ({
  "--meter-width": `${max > 0 ? Math.max(4, Math.abs(value) / max * 100) : 0}%`,
  "--meter-color": color,
}) as CSSProperties;

function InstrumentIdentity({ instrumentId, name }: { instrumentId: string; name: string }) {
  return (
    <strong className="instrument-identity">
      <span>{instrumentId}</span>
      <small>{name}</small>
    </strong>
  );
}

function toneForVolatility(value: number) {
  return value > 0.8 ? "high" : value > 0.45 ? "medium" : "low";
}

function toneForCapital(value: number | null) {
  if (value == null) return "";
  return value > 0.65 ? "high" : value > 0.4 ? "medium" : "low";
}

export function RiskInstrumentDetails({
  instruments,
  diagnostics,
}: {
  instruments: RiskInstrument[];
  diagnostics?: Diagnostics;
}) {
  const [view, setView] = useState<View>("contribution");
  const [sortKey, setSortKey] = useState<SortKey>("riskContribution");

  const riskRows = useMemo(() => [...instruments].sort((left, right) => {
    const key = sortKey === "weight" || sortKey === "volatilityAnnualized" ? sortKey : "riskContribution";
    return right[key] - left[key];
  }), [instruments, sortKey]);

  const sharRows = useMemo(() => [...(diagnostics?.forecasts ?? [])].sort((left, right) => {
    if (sortKey === "downside") return right.negativeSemivariance22d - left.negativeSemivariance22d;
    if (sortKey === "rmse") return right.expandingWindowBacktest.rmse - left.expandingWindowBacktest.rmse;
    return Math.abs(right.signedJump22d) - Math.abs(left.signedJump22d);
  }), [diagnostics, sortKey]);

  const maxima = useMemo(() => ({
    weight: Math.max(...instruments.map((item) => item.weight), 0),
    volatility: Math.max(...instruments.map((item) => item.volatilityAnnualized), 0),
    contribution: Math.max(...instruments.map((item) => item.riskContribution), 0),
    capital: Math.max(...instruments.map((item) => item.riskCapitalRatio ?? 0), 0),
    positive: Math.max(...(diagnostics?.forecasts ?? []).map((item) => item.positiveSemivariance22d), 0),
    negative: Math.max(...(diagnostics?.forecasts ?? []).map((item) => item.negativeSemivariance22d), 0),
  }), [diagnostics, instruments]);

  const selectView = (nextView: View) => {
    setView(nextView);
    setSortKey(nextView === "contribution" ? "riskContribution" : "jump");
  };

  return (
    <section className="risk-instrument-details">
      <div className="risk-instrument-head">
        <div>
          <h3>标的风险明细</h3>
          <p>{view === "contribution" ? "识别风险集中来源与仓位效率" : "比较上下行尾部响应与样本外误差"}</p>
        </div>
        <div className="risk-instrument-controls">
          <div aria-label="标的风险明细视图" className="risk-detail-tabs" role="tablist">
            <button
              aria-selected={view === "contribution"}
              className={view === "contribution" ? "active" : ""}
              onClick={() => selectView("contribution")}
              role="tab"
              type="button"
            >
              风险贡献 <span>{instruments.length}</span>
            </button>
            <button
              aria-selected={view === "shar"}
              className={view === "shar" ? "active" : ""}
              disabled={!diagnostics}
              onClick={() => selectView("shar")}
              role="tab"
              type="button"
            >
              SHAR 尾部监控 <span>{diagnostics?.forecasts.length ?? 0}</span>
            </button>
          </div>
          <label className="risk-sort-control">
            <span>排序</span>
            {view === "contribution" ? (
              <select value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}>
                <option value="riskContribution">风险贡献 ↓</option>
                <option value="weight">组合权重 ↓</option>
                <option value="volatilityAnnualized">年化波动率 ↓</option>
              </select>
            ) : (
              <select value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}>
                <option value="jump">|ΔJ| ↓</option>
                <option value="downside">RS⁻ ↓</option>
                <option value="rmse">OOS RMSE ↓</option>
              </select>
            )}
          </label>
        </div>
      </div>

      {view === "contribution" ? (
        <div className="risk-detail-table" role="tabpanel">
          <div className="risk-detail-row risk-detail-row-head">
            <span>标的</span>
            <span>组合权重</span>
            <span>年化波动率</span>
            <span>风险贡献</span>
            <span title="风险贡献相对于组合权重的比例">风险资本比</span>
          </div>
          {riskRows.map((item) => (
            <div className="risk-detail-row" key={item.instrumentId}>
              <InstrumentIdentity instrumentId={item.instrumentId} name={item.name} />
              <div className="risk-value-meter" style={meterStyle(item.weight, maxima.weight, "#7662ee")}>
                <span>{percent(item.weight)}</span><i />
              </div>
              <div className={`risk-value-meter ${toneForVolatility(item.volatilityAnnualized)}`} style={meterStyle(item.volatilityAnnualized, maxima.volatility, "#e0bd72")}>
                <span>{percent(item.volatilityAnnualized)}</span><i />
              </div>
              <div className="risk-value-meter" style={meterStyle(item.riskContribution, maxima.contribution, "#f07a89")}>
                <span>{percent(item.riskContribution)}</span><i />
              </div>
              <div className={`risk-value-meter ${toneForCapital(item.riskCapitalRatio)}`} style={meterStyle(item.riskCapitalRatio ?? 0, maxima.capital, "#5bc59b")}>
                <span>{item.riskCapitalRatio == null ? "—" : percent(item.riskCapitalRatio)}</span><i />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="risk-detail-table risk-shar-table" role="tabpanel">
          <div className="risk-detail-row risk-detail-row-head">
            <span>标的</span>
            <span title="22 日上行与下行半方差">RS⁺ / RS⁻</span>
            <span title="上行半方差减去下行半方差">ΔJ</span>
            <span title="扩展窗口样本外均方根误差">OOS RMSE</span>
          </div>
          {sharRows.map((forecast) => (
            <div className="risk-detail-row" key={forecast.instrumentId}>
              <InstrumentIdentity
                instrumentId={forecast.instrumentId}
                name={instruments.find((item) => item.instrumentId === forecast.instrumentId)?.name ?? "名称待补充"}
              />
              <div className="shar-pair">
                <div style={meterStyle(forecast.positiveSemivariance22d, maxima.positive, "#5bc59b")}><b>RS⁺</b><span>{bp2(forecast.positiveSemivariance22d)}</span><i /></div>
                <div style={meterStyle(forecast.negativeSemivariance22d, maxima.negative, "#f07a89")}><b>RS⁻</b><span>{bp2(forecast.negativeSemivariance22d)}</span><i /></div>
              </div>
              <span className={`jump-value ${forecast.signedJump22d < 0 ? "negative" : "positive"}`}>{bp2(forecast.signedJump22d)}</span>
              <span className="rmse-value">{bp2(forecast.expandingWindowBacktest.rmse)}</span>
            </div>
          ))}
        </div>
      )}

      {view === "shar" && diagnostics && (
        <div className="risk-detail-foot">
          <span>{diagnostics.semivarianceResolution}</span>
          <span className={diagnostics.ivInputStatus.includes("unavailable") ? "warning" : ""}>IV {diagnostics.ivInputStatus}</span>
          <small>比例条按当前标的集合归一化，仅用于横向比较。</small>
        </div>
      )}
    </section>
  );
}
