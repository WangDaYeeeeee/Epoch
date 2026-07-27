"use client";

import { FormEvent, useState } from "react";

type Result = { kind: "idle" | "working" | "success" | "error"; message: string };

const today = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());

async function submit(endpoint: string, payload: unknown): Promise<string> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(String(body.detail ?? body.error ?? "Request failed"));
  return String(body.id ?? body.eventId ?? body.themeId ?? body.reviewId ?? body.status ?? "saved");
}

export function WorkflowConsole({ strategyVersion }: { strategyVersion: string }) {
  const [result, setResult] = useState<Result>({ kind: "idle", message: "所有写入只形成记录，不会创建订单。" });
  const run = async (work: () => Promise<string>) => {
    setResult({ kind: "working", message: "正在保存…" });
    try {
      const id = await work();
      setResult({ kind: "success", message: `已保存 · ${id}。刷新页面可查看新的待办状态。` });
    } catch (error) {
      setResult({ kind: "error", message: error instanceof Error ? error.message : "保存失败" });
    }
  };

  const createEvent = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run(() => submit("/api/v1/events", {
      title: form.get("title"),
      instrumentId: form.get("instrumentId") || null,
      eventType: form.get("eventType"),
      scheduledDate: form.get("scheduledDate"),
      source: form.get("source"),
      observedAt: new Date().toISOString(),
    }));
  };
  const createTheme = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run(() => submit("/api/v1/themes", { action: "create", name: form.get("name") }));
  };
  const createReview = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run(() => submit("/api/v1/reviews", {
      action: "create",
      review: {
        cadence: form.get("cadence"),
        scope: "portfolio",
        asOf: form.get("asOf"),
        strategyVersion,
        parameterSetVersion: "default-draft-v0.1.0",
        summary: form.get("summary"),
        whatWorked: form.get("whatWorked"),
        whatFailed: form.get("whatFailed"),
        followUp: form.get("followUp"),
        confirmed: form.get("confirmed") === "on",
      },
    }));
  };

  return (
    <article className="panel workflow-console" id="workflow">
      <div className="panel-head">
        <div><h2>工作流录入</h2><p>事件、主题与多周期复盘 · 保存后由 Operations 确定性重建待办</p></div>
        <span className={`workflow-result ${result.kind}`}>{result.message}</span>
      </div>
      <div className="workflow-grid">
        <form onSubmit={createEvent}>
          <h3>登记事件</h3>
          <label>标题<input name="title" required maxLength={200} /></label>
          <label>证券（可选）<input name="instrumentId" placeholder="US:NVDA" /></label>
          <label>类型<select name="eventType" defaultValue="earnings">
            <option value="earnings">财报</option><option value="product">产品</option>
            <option value="regulatory">监管</option><option value="macro">宏观</option>
            <option value="capital_allocation">资本配置</option><option value="other">其他</option>
          </select></label>
          <label>计划日期<input name="scheduledDate" type="date" defaultValue={today()} required /></label>
          <label>来源<input name="source" required placeholder="公司 IR / 手工登记" /></label>
          <button type="submit">保存事件</button>
        </form>
        <form onSubmit={createTheme}>
          <h3>新建主题</h3>
          <label>主题名称<input name="name" required maxLength={200} placeholder="AI 基础设施部署" /></label>
          <p>创建主题主对象后，可通过 Themes API 追加版本、关联候选与证据；历史版本不会覆盖。</p>
          <button type="submit">创建主题</button>
        </form>
        <form onSubmit={createReview}>
          <h3>结构化复盘</h3>
          <div className="workflow-inline">
            <label>周期<select name="cadence" defaultValue="daily">
              <option value="daily">日常</option><option value="weekly">周度</option>
              <option value="monthly">月度</option><option value="quarterly">季度</option>
              <option value="post_exit">平仓后</option>
            </select></label>
            <label>截至<input name="asOf" type="date" defaultValue={today()} required /></label>
          </div>
          <label>结论<textarea name="summary" required /></label>
          <label>有效部分<textarea name="whatWorked" required /></label>
          <label>失效部分<textarea name="whatFailed" required /></label>
          <label>后续动作<textarea name="followUp" required /></label>
          <label className="workflow-check"><input name="confirmed" type="checkbox" />确认复盘</label>
          <button type="submit">保存复盘</button>
        </form>
      </div>
    </article>
  );
}
