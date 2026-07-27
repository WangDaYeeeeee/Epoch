"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";

type Weight = { instrumentId: string; weight: number };
type AnchorOption = { calculationId: string; label: string };

const errorMessage = (payload: unknown, fallback: string) => {
  if (typeof payload !== "object" || payload === null) return fallback;
  const detail = (payload as Record<string, unknown>).detail;
  const error = (payload as Record<string, unknown>).error;
  return typeof detail === "string" ? detail : typeof error === "string" ? error : fallback;
};

export function RebalanceRiskForm({ initialWeights }: { initialWeights: Weight[] }) {
  const router = useRouter();
  const [weights, setWeights] = useState(() => initialWeights.map((item) => ({ ...item })));
  const [state, setState] = useState<{ pending: boolean; message: string; tone: "idle" | "success" | "error" }>({
    pending: false,
    message: "",
    tone: "idle",
  });
  const total = useMemo(() => weights.reduce((sum, item) => sum + item.weight, 0), [weights]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setState({ pending: true, message: "正在测算并保存审计记录…", tone: "idle" });
    try {
      const response = await fetch("/api/v1/risk/rebalance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetWeights: weights }),
      });
      const payload = await response.json() as Record<string, unknown>;
      if (!response.ok) throw new Error(errorMessage(payload, "调仓风险测算失败"));
      const output = payload.output as { portfolio?: { volatilityAnnualized?: number }; policyGate?: { passed?: boolean } } | undefined;
      const sigma = output?.portfolio?.volatilityAnnualized;
      const passed = output?.policyGate?.passed;
      setState({
        pending: false,
        tone: "success",
        message: `测算已保存${typeof sigma === "number" ? ` · σₚ ${(sigma * 100).toFixed(2)}%` : ""}${typeof passed === "boolean" ? ` · 卡口${passed ? "通过" : "越界"}` : ""}`,
      });
      router.refresh();
    } catch (error) {
      setState({ pending: false, tone: "error", message: error instanceof Error ? error.message : "调仓风险测算失败" });
    }
  };

  return (
    <form className="risk-action-card" onSubmit={submit}>
      <div className="risk-action-head">
        <div><h3>调仓意向测算</h3><p>百分比可为负数；系统不归一化、不求解、不下单。</p></div>
        <strong>合计 {(total * 100).toFixed(1)}%</strong>
      </div>
      <div className="rebalance-fields">
        {weights.map((item, index) => (
          <label key={item.instrumentId}>
            <span>{item.instrumentId}</span>
            <input
              aria-label={`${item.instrumentId} target weight percent`}
              type="number"
              min="-100"
              max="100"
              step="0.1"
              value={Number((item.weight * 100).toFixed(4))}
              onChange={(event) => {
                const weight = Number(event.target.value) / 100;
                setWeights((current) => current.map((candidate, candidateIndex) => (
                  candidateIndex === index ? { ...candidate, weight } : candidate
                )));
              }}
            />
            <small>%</small>
          </label>
        ))}
      </div>
      <div className="risk-action-footer">
        <span>未分配/现金余量 {((1 - total) * 100).toFixed(1)}%</span>
        <button disabled={state.pending} type="submit">{state.pending ? "测算中…" : "保存并测算"}</button>
      </div>
      {state.message && <p className={`risk-action-message ${state.tone}`}>{state.message}</p>}
    </form>
  );
}

export function RiskAnchorForm({ options }: { options: AnchorOption[] }) {
  const router = useRouter();
  const [calculationId, setCalculationId] = useState(options[0]?.calculationId ?? "");
  const [confirmed, setConfirmed] = useState(false);
  const [state, setState] = useState<{ pending: boolean; message: string; tone: "idle" | "success" | "error" }>({
    pending: false,
    message: "",
    tone: "idle",
  });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!confirmed) return;
    if (!window.confirm("再次确认：这个计算对应的组合已经实际执行，要将它设为波动率漂移锚点吗？")) return;
    setState({ pending: true, message: "正在确认锚点…", tone: "idle" });
    try {
      const response = await fetch("/api/v1/risk/anchors", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ calculationId, note: "用户在 Portfolio 页面明确确认该组合已实际执行" }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(errorMessage(payload, "锚点确认失败"));
      setState({ pending: false, tone: "success", message: "锚点已确认，漂移比较已刷新。" });
      setConfirmed(false);
      router.refresh();
    } catch (error) {
      setState({ pending: false, tone: "error", message: error instanceof Error ? error.message : "锚点确认失败" });
    }
  };

  return (
    <form className="risk-action-card anchor-action" onSubmit={submit}>
      <div className="risk-action-head"><div><h3>确认已执行组合锚点</h3><p>只有实际完成调仓后才可确认；测算场景不会自动生效。</p></div></div>
      <select value={calculationId} onChange={(event) => setCalculationId(event.target.value)}>
        {options.map((option) => <option key={option.calculationId} value={option.calculationId}>{option.label}</option>)}
      </select>
      <label className="anchor-confirm">
        <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
        <span>我确认上述计算对应的组合已经实际执行</span>
      </label>
      <div className="risk-action-footer">
        <span>提交后仍需进行第二次确认</span>
        <button disabled={!confirmed || state.pending || !calculationId} type="submit">{state.pending ? "确认中…" : "设为漂移锚点"}</button>
      </div>
      {state.message && <p className={`risk-action-message ${state.tone}`}>{state.message}</p>}
    </form>
  );
}
