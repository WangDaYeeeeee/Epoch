"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { MarketRefreshPreflight } from "@/lib/server/market-refresh";

export function MarketRefreshControl() {
  const router = useRouter();
  const [preflight, setPreflight] = useState<MarketRefreshPreflight | null>(null);
  const [latestRun, setLatestRun] = useState<{
    id: string;
    status: "running" | "succeeded" | "failed";
    requestedAt: string;
    failureReason: string | null;
  } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [state, setState] = useState<{ pending: boolean; message: string; tone: "idle" | "success" | "error" }>({
    pending: false,
    message: "",
    tone: "idle",
  });

  useEffect(() => {
    void fetch("/api/v1/market-data/refresh")
      .then(async (response) => {
        const payload = await response.json() as {
          preflight?: MarketRefreshPreflight;
          latestRun?: typeof latestRun;
        };
        if (!response.ok || !payload.preflight) throw new Error("无法加载行情刷新预检");
        setPreflight(payload.preflight);
        setLatestRun(payload.latestRun ?? null);
      })
      .catch((error) => setState({
        pending: false,
        tone: "error",
        message: error instanceof Error ? error.message : "无法加载行情刷新预检",
      }));
  }, []);

  const refresh = async () => {
    if (!preflight || !confirmed) return;
    const providerCount = new Set(preflight.targets.map((target) => target.provider)).size;
    if (!window.confirm(`将调用已配置的 IBKR Flex，并向 ${providerCount} 个公开行情来源发送 ${preflight.targets.length} 个来源标识。确认继续吗？`)) return;
    setState({ pending: true, tone: "idle", message: "正在刷新账户净值、基准和持仓行情，可能需要约一分钟…" });
    try {
      const response = await fetch("/api/v1/market-data/refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmed: true, fingerprint: preflight.fingerprint }),
      });
      const payload = await response.json() as {
        detail?: string;
        result?: {
          observedAt?: string;
          account?: {
            status?: string;
            latestNavDate?: string;
            latestPositionDate?: string;
            positionSnapshotsInserted?: number;
            reason?: string;
          };
          benchmark?: { status?: string; latestObservationDate?: string; reason?: string };
        };
        run?: NonNullable<typeof latestRun>;
      };
      if (!response.ok) throw new Error(payload.detail ?? "行情刷新失败");
      if (payload.run) setLatestRun(payload.run);
      setState({
        pending: false,
        tone: "success",
        message: [
          "日频数据刷新完成",
          payload.result?.account?.latestNavDate
            ? `IBKR NAV ${payload.result.account.latestNavDate}`
            : `IBKR ${payload.result?.account?.reason ?? "未返回新快照"}`,
          payload.result?.account?.latestPositionDate
            ? `持仓 ${payload.result.account.latestPositionDate}`
            : "持仓未返回",
          payload.result?.benchmark?.latestObservationDate
            ? `.NDX ${payload.result.benchmark.latestObservationDate}`
            : `.NDX ${payload.result?.benchmark?.reason ?? "未返回新行情"}`,
        ].join(" · "),
      });
      setConfirmed(false);
      router.refresh();
    } catch (error) {
      setState({ pending: false, tone: "error", message: error instanceof Error ? error.message : "行情刷新失败" });
    }
  };

  return (
    <section className="market-refresh-control">
      <div className="risk-action-head">
        <div><h3>人工刷新日频数据</h3><p>刷新 IBKR 账户净值、.NDX 基准以及持仓与汇率日线。</p></div>
        <button className="text-button" type="button" onClick={() => setExpanded((value) => !value)}>
          {expanded ? "收起预检" : "查看预检"}
        </button>
      </div>
      {preflight && expanded && (
        <div className="market-preflight">
          <p>{preflight.dateFrom} → {preflight.dateToExclusive}（不含结束日） · {preflight.targets.length} 个来源标识</p>
          <div>{preflight.targets.map((target) => (
            <span key={target.instrumentId}>{target.instrumentId} → {target.providerSymbol} · {target.provider}</span>
          ))}</div>
          {preflight.disclosures.map((item) => <small key={item}>{item}</small>)}
        </div>
      )}
      <label className="anchor-confirm">
        <input type="checkbox" checked={confirmed} disabled={!preflight || state.pending} onChange={(event) => setConfirmed(event.target.checked)} />
        <span>我确认调用已配置的 IBKR Flex，并将上述来源标识和日期范围发送给公开行情 Provider</span>
      </label>
      <div className="risk-action-footer">
        <span>{preflight ? `预检指纹 ${preflight.fingerprint.slice(0, 12)}` : "正在加载预检…"}</span>
        <button type="button" disabled={!preflight || !confirmed || state.pending} onClick={() => void refresh()}>
          {state.pending ? "刷新中…" : "确认并刷新"}
        </button>
      </div>
      {latestRun && (
        <p className={`market-refresh-last ${latestRun.status}`}>
          最近运行 {latestRun.requestedAt.slice(0, 16).replace("T", " ")} · {
            latestRun.status === "succeeded" ? "成功" : latestRun.status === "failed" ? "失败" : "进行中"
          }{latestRun.failureReason ? ` · ${latestRun.failureReason}` : ""}
        </p>
      )}
      {state.message && <p className={`risk-action-message ${state.tone}`}>{state.message}</p>}
    </section>
  );
}
