"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type Weight = { instrumentId: string; name: string; weight: number };

const errorMessage = (payload: unknown, fallback: string) => {
  if (typeof payload !== "object" || payload === null) return fallback;
  const detail = (payload as Record<string, unknown>).detail;
  const error = (payload as Record<string, unknown>).error;
  return typeof detail === "string" ? detail : typeof error === "string" ? error : fallback;
};

export function TargetWeightAnchorForm({
  initialWeights,
  anchorInstrumentIds,
}: {
  initialWeights: Weight[];
  anchorInstrumentIds?: string[];
}) {
  const router = useRouter();
  const [weights, setWeights] = useState(() => initialWeights.map((item) => ({ ...item })));
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<{ pending: boolean; message: string; tone: "idle" | "success" | "error" }>({
    pending: false,
    message: "",
    tone: "idle",
  });
  const total = useMemo(() => weights.reduce((sum, item) => sum + item.weight, 0), [weights]);
  const anchorMismatch = useMemo(() => {
    if (!anchorInstrumentIds) return null;
    const current = new Set(initialWeights.map((item) => item.instrumentId));
    const anchor = new Set(anchorInstrumentIds);
    const added = [...current].filter((instrumentId) => !anchor.has(instrumentId));
    const removed = [...anchor].filter((instrumentId) => !current.has(instrumentId));
    return added.length || removed.length ? { added, removed } : null;
  }, [anchorInstrumentIds, initialWeights]);
  const isValid = total > 0 && total <= 1 + 1e-9 && weights.every((item) => item.weight >= 0 && item.weight <= 1);
  const closeModal = () => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !state.pending) {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        setOpen(false);
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open, state.pending]);

  useEffect(() => {
    if (!open) setWeights(initialWeights.map((item) => ({ ...item })));
  }, [initialWeights, open]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!isValid) return;
    if (!window.confirm("确认保存这组基准目标仓位吗？保存后将用于计算权重偏离与风险漂移。")) return;
    setState({ pending: true, message: "正在计算并保存基准仓位锚点…", tone: "idle" });
    try {
      const calculationResponse = await fetch("/api/v1/risk/rebalance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetWeights: weights }),
      });
      const calculation = await calculationResponse.json() as Record<string, unknown>;
      if (!calculationResponse.ok) throw new Error(errorMessage(calculation, "基准仓位风险计算失败"));
      if (typeof calculation.calculationId !== "string") throw new Error("风险计算未返回有效记录");

      const anchorResponse = await fetch("/api/v1/risk/anchors", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          calculationId: calculation.calculationId,
          note: "用户手工维护的基准目标仓位",
        }),
      });
      const anchor = await anchorResponse.json();
      if (!anchorResponse.ok) throw new Error(errorMessage(anchor, "基准仓位锚点保存失败"));
      setState({ pending: false, tone: "success", message: "基准目标仓位已保存，漂移比较已刷新。" });
      closeModal();
      router.refresh();
    } catch (error) {
      setState({ pending: false, tone: "error", message: error instanceof Error ? error.message : "基准仓位锚点保存失败" });
    }
  };

  return <>
    <section className={`risk-anchor-entry ${anchorMismatch ? "mismatch" : ""}`}>
      <div>
        <span>{anchorMismatch ? "基准仓位需要更新" : "基准仓位设置"}</span>
        <strong>{weights.length} 个标的 · 合计 {(total * 100).toFixed(1)}%</strong>
        {anchorMismatch ? (
          <small className="anchor-mismatch-detail">
            {anchorMismatch.added.length > 0 && <>新增 {anchorMismatch.added.join("、")}</>}
            {anchorMismatch.added.length > 0 && anchorMismatch.removed.length > 0 && <span> · </span>}
            {anchorMismatch.removed.length > 0 && <>已退出 {anchorMismatch.removed.join("、")}</>}
            <span>；请按最新实际持仓重新设置基准</span>
          </small>
        ) : <small>用于权重偏离与风险漂移比较</small>}
      </div>
      <button type="button" onClick={() => setOpen(true)}>{anchorMismatch ? "重新设置基准" : "调整基准仓位"}</button>
    </section>
    {open && createPortal((
      <div
        className="anchor-modal-backdrop"
        role="presentation"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget && !state.pending) closeModal();
        }}
      >
        <form
          aria-labelledby="anchor-modal-title"
          aria-modal="true"
          className="risk-action-card anchor-action anchor-modal"
          role="dialog"
          onSubmit={submit}
        >
          <div className="anchor-modal-head">
            <div>
              <h3 id="anchor-modal-title">调整基准目标仓位</h3>
              <p>逐项维护全部持仓标的的长期目标权重；未分配部分视为现金。</p>
            </div>
            <button aria-label="关闭基准仓位浮窗" disabled={state.pending} type="button" onClick={closeModal}>×</button>
          </div>
          <div className="anchor-weight-grid">
            {weights.map((item, index) => (
              <label key={item.instrumentId}>
                <span className="anchor-instrument"><b>{item.instrumentId}</b><small>{item.name}</small></span>
                <div>
                  <input
                    aria-label={`${item.instrumentId} 基准目标仓位`}
                    type="number"
                    min="0"
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
                </div>
              </label>
            ))}
          </div>
          <div className="anchor-modal-summary">
            <div><span>目标仓位合计</span><strong className={isValid ? "" : "invalid"}>{(total * 100).toFixed(1)}%</strong></div>
            <div><span>现金目标</span><strong>{isValid ? `${((1 - total) * 100).toFixed(1)}%` : "—"}</strong></div>
          </div>
          <div className="risk-action-footer">
            <span>{isValid ? "保存后将重建风险基准" : "目标权重合计必须大于 0% 且不超过 100%"}</span>
            <button disabled={!isValid || state.pending} type="submit">{state.pending ? "保存中…" : "保存基准仓位"}</button>
          </div>
          {state.message && <p className={`risk-action-message ${state.tone}`}>{state.message}</p>}
        </form>
      </div>
    ), document.body)}
  </>;
}

export function HistoricalRiskBackfillControl() {
  const router = useRouter();
  const [frequency, setFrequency] = useState<"daily" | "weekly" | "monthly">("daily");
  const [state, setState] = useState<{ pending: boolean; message: string; tone: "idle" | "success" | "error" }>({
    pending: false,
    message: "",
    tone: "idle",
  });

  const run = async () => {
    setState({ pending: true, message: "正在按历史持仓重放并计算…", tone: "idle" });
    try {
      const response = await fetch("/api/v1/risk/history", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ frequency, limit: frequency === "daily" ? 260 : frequency === "weekly" ? 52 : 24 }),
      });
      const payload = await response.json() as Record<string, unknown>;
      if (!response.ok) throw new Error(errorMessage(payload, "历史风险回补失败"));
      const result = payload.result as Record<string, unknown> | undefined;
      const available = Number(result?.availableRuns ?? 0);
      const skipped = Number(result?.skippedDates ?? 0);
      setState({
        pending: false,
        tone: "success",
        message: `已生成或复用 ${available} 个真实历史点${skipped ? `，${skipped} 个历史周期受数据条件限制` : ""}。`,
      });
      router.refresh();
    } catch (error) {
      setState({ pending: false, tone: "error", message: error instanceof Error ? error.message : "历史风险回补失败" });
    }
  };

  return (
    <section className="risk-anchor-entry risk-history-entry">
      <div>
        <span>真实历史风险</span>
        <strong>当日实际持仓 · 截止当日行情</strong>
        <small>{state.message || "账本逐日重放，不使用当前仓位倒推历史"}</small>
      </div>
      <div className="risk-history-controls">
        <select
          aria-label="历史风险回补频率"
          disabled={state.pending}
          value={frequency}
          onChange={(event) => setFrequency(event.target.value as typeof frequency)}
        >
          <option value="daily">日频</option>
          <option value="weekly">周频</option>
          <option value="monthly">月频</option>
        </select>
        <button disabled={state.pending} type="button" onClick={run}>{state.pending ? "回补中…" : "补全历史"}</button>
      </div>
    </section>
  );
}
