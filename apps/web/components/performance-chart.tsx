"use client";

import { useMemo, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type Point = { date: string; portfolio: number; benchmark: number; drawdown?: number; benchmarkDrawdown?: number };
type Event = { date: string; type: string; label: string; details?: string[] };
const eventColor: Record<string, string> = { buy: "#5bc59b", sell: "#f07a89", deposit: "#6da8e8", withdrawal: "#d5a94e", transfer_in: "#a99bff", transfer_out: "#a99bff" };
const CHART_ANIMATION_MS = 450;

function PerformanceTooltip({ active, label, payload, eventsByDate }: {
  active?: boolean;
  label?: string;
  payload?: Array<{ name?: string; value?: number | string; color?: string }>;
  eventsByDate: Map<string, Event[]>;
}) {
  if (!active || !label || !payload?.length) return null;
  const dateEvents = eventsByDate.get(label) ?? [];
  return <div className="performance-tooltip">
    <strong>{label}</strong>
    <div className="tooltip-series">
      {payload.map((item) => <span key={item.name}><i style={{ background: item.color }}/><b>{item.name}</b>{(Number(item.value) - 100).toFixed(2)}%</span>)}
    </div>
    {dateEvents.length > 0 && <div className="tooltip-events">
      {dateEvents.map((event, index) => <section key={`${event.type}-${index}`}>
        <h4><i style={{ background: eventColor[event.type] ?? "#d5a94e" }}/>{event.label}</h4>
        {(event.details ?? []).map((detail, detailIndex) => <p key={detailIndex}>{detail}</p>)}
      </section>)}
    </div>}
  </div>;
}

export function PerformanceChart({ data, events }: { data: Point[]; events: Event[] }) {
  const [range, setRange] = useState({ startIndex: 0, endIndex: Math.max(0, data.length - 1) });
  const [activePreset, setActivePreset] = useState<string | null>("all");
  const visible = data.slice(range.startIndex, range.endIndex + 1);
  const normalized = useMemo(() => {
    if (!visible.length) return [];
    const portfolioBase = visible[0].portfolio, benchmarkBase = visible[0].benchmark;
    let portfolioPeak = 0, benchmarkPeak = 0;
    return visible.map((point) => {
      const portfolio = point.portfolio / portfolioBase * 100, benchmark = point.benchmark / benchmarkBase * 100;
      portfolioPeak = Math.max(portfolioPeak, portfolio); benchmarkPeak = Math.max(benchmarkPeak, benchmark);
      return { ...point, portfolio, benchmark, drawdown: portfolio / portfolioPeak - 1, benchmarkDrawdown: benchmark / benchmarkPeak - 1 };
    });
  }, [visible]);
  const visibleDates = new Set(normalized.map((point) => point.date));
  const visibleEvents = events.filter((event) => visibleDates.has(event.date));
  const performanceScale = useMemo(() => {
    if (!normalized.length) return { domain: [90, 110] as [number, number], ticks: [90, 100, 110] };
    const values = normalized.flatMap((point) => [point.portfolio, point.benchmark]);
    const minimum = Math.min(...values), maximum = Math.max(...values);
    const span = maximum - minimum;
    const step = span <= 30 ? 5 : span <= 90 ? 10 : 20;
    const lower = Math.max(step, 100 + Math.floor((minimum - 100) / step) * step);
    const upper = 100 + Math.ceil((maximum - 100) / step) * step;
    const ticks: number[] = [];
    for (let tick = lower; tick <= upper; tick += step) ticks.push(tick);
    return { domain: [lower, Math.max(lower + step, upper)] as [number, number], ticks };
  }, [normalized]);
  const eventsByDate = useMemo(() => {
    const grouped = new Map<string, Event[]>();
    for (const event of visibleEvents) grouped.set(event.date, [...(grouped.get(event.date) ?? []), event]);
    return grouped;
  }, [visibleEvents]);

  function setPreset(days: number | "ytd" | "all") {
    setActivePreset(String(days));
    if (days === "all") return setRange({ startIndex: 0, endIndex: data.length - 1 });
    const lastDate = new Date(`${data.at(-1)?.date}T00:00:00`);
    const cutoff = days === "ytd" ? new Date(lastDate.getFullYear(), 0, 1) : new Date(lastDate.getTime() - days * 86400000);
    const found = data.findIndex((point) => new Date(`${point.date}T00:00:00`) >= cutoff);
    setRange({ startIndex: Math.max(0, found), endIndex: data.length - 1 });
  }

  const lastIndex = Math.max(0, data.length - 1);
  const startPercent = lastIndex ? range.startIndex / lastIndex * 100 : 0;
  const endPercent = lastIndex ? range.endIndex / lastIndex * 100 : 100;
  const selectedDays = visible.length > 1
    ? Math.round((Date.parse(`${visible.at(-1)?.date}T00:00:00Z`) - Date.parse(`${visible[0]?.date}T00:00:00Z`)) / 86_400_000) + 1
    : visible.length;

  function setStartIndex(value: number) {
    setActivePreset(null);
    setRange((current) => ({ ...current, startIndex: Math.min(Math.max(0, value), current.endIndex) }));
  }

  function setEndIndex(value: number) {
    setActivePreset(null);
    setRange((current) => ({ ...current, endIndex: Math.max(current.startIndex, Math.min(lastIndex, value)) }));
  }

  return <div>
    <div className="range-controls" aria-label="时间范围">
      {[[30, "1月"], [90, "3月"], [180, "6月"], ["ytd", "YTD"], [365, "1年"], ["all", "全部"]].map(([value, label]) => <button className={activePreset === String(value) ? "active" : ""} aria-pressed={activePreset === String(value)} key={String(value)} onClick={() => setPreset(value as number | "ytd" | "all")}>{label}</button>)}
    </div>
    <div className="chart-label"><span>对数坐标</span><span>{visible.at(0)?.date} — {visible.at(-1)?.date}</span></div>
    <ResponsiveContainer width="100%" height={390}>
      <ComposedChart data={normalized} margin={{ top: 24, right: 18, left: 0, bottom: 8 }}>
        <defs><linearGradient id="portfolioFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#7662ee" stopOpacity={0.25}/><stop offset="100%" stopColor="#7662ee" stopOpacity={0}/></linearGradient></defs>
        <CartesianGrid stroke="rgba(169,155,255,.12)" vertical={false}/><XAxis dataKey="date" tickFormatter={(v) => v.slice(0, 7)} tick={{ fontSize: 10, fill: "#7f7999" }} tickMargin={8} stroke="#7f7999" tickLine={false} axisLine={false} minTickGap={48}/><YAxis scale="log" domain={performanceScale.domain} ticks={performanceScale.ticks} interval={0} allowDataOverflow tickFormatter={(v) => `${Number(v) > 100 ? "+" : ""}${(Number(v) - 100).toFixed(0)}%`} tick={{ fontSize: 10, fill: "#7f7999" }} tickMargin={7} width={48} stroke="#7f7999" tickLine={false} axisLine={false}/>
        <Tooltip content={<PerformanceTooltip eventsByDate={eventsByDate}/>}/>
        <Area type="monotone" dataKey="portfolio" stroke="#7662ee" strokeWidth={2.6} fill="url(#portfolioFill)" name="组合" dot={false} animationDuration={CHART_ANIMATION_MS} animationEasing="ease-out"/><Line type="monotone" dataKey="benchmark" stroke="#c09a52" strokeWidth={1.8} strokeDasharray="7 5" dot={false} name=".NDX" animationDuration={CHART_ANIMATION_MS} animationEasing="ease-out"/>
        {visibleEvents.map((event, index) => { const point = normalized.find((item) => item.date === event.date); return point ? <ReferenceDot key={`${event.date}-${event.type}-${index}`} x={event.date} y={point.portfolio} r={4.5} fill={eventColor[event.type] ?? "#d5a94e"} stroke="#0d0928" strokeWidth={2}/> : null; })}
      </ComposedChart>
    </ResponsiveContainer>
    <div className="event-key"><span><i className="buy"/>买入</span><span><i className="sell"/>卖出</span><span><i className="cash"/>资金流</span><span><i className="transfer"/>账户迁移</span></div>
    <div className="drawdown-title"><div><strong>回撤深度</strong><small>按当前时间窗口重新计算峰值</small></div><span>{Math.min(...normalized.map((p) => p.drawdown ?? 0)).toLocaleString("zh-CN", { style: "percent", maximumFractionDigits: 2 })}</span></div>
    <ResponsiveContainer width="100%" height={160}><ComposedChart data={normalized} margin={{ top: 8, right: 18, left: 0, bottom: 0 }}><CartesianGrid stroke="rgba(169,155,255,.12)" vertical={false}/><XAxis dataKey="date" hide/><YAxis tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} tick={{ fontSize: 10, fill: "#7f7999" }} tickMargin={7} stroke="#7f7999" tickLine={false} axisLine={false} width={42}/><Tooltip contentStyle={{ background: "#15103a", border: "1px solid #2b2460", borderRadius: 12 }} formatter={(v, name) => [`${(Number(v) * 100).toFixed(2)}%`, name]}/><Area type="monotone" dataKey="drawdown" stroke="#7662ee" fill="#7662ee" fillOpacity={0.16} name="组合回撤" animationDuration={CHART_ANIMATION_MS} animationEasing="ease-out"/><Line type="monotone" dataKey="benchmarkDrawdown" stroke="#c09a52" strokeDasharray="7 5" dot={false} name=".NDX 回撤" animationDuration={CHART_ANIMATION_MS} animationEasing="ease-out"/></ComposedChart></ResponsiveContainer>
    <div className="range-scrubber">
      <div className="scrubber-head"><span>时间窗口</span><strong>{selectedDays.toLocaleString("zh-CN")} 天</strong></div>
      <div className="scrubber-track">
        <div className="scrubber-sparkline" aria-hidden="true"><ResponsiveContainer width="100%" height={52}><ComposedChart data={data} margin={{ top: 5, right: 0, bottom: 5, left: 0 }}><defs><linearGradient id="scrubberFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#7662ee" stopOpacity={0.42}/><stop offset="100%" stopColor="#7662ee" stopOpacity={0.04}/></linearGradient></defs><Area type="monotone" dataKey="portfolio" stroke="#7662ee" strokeWidth={1.4} fill="url(#scrubberFill)" dot={false} isAnimationActive={false}/></ComposedChart></ResponsiveContainer></div>
        <div className="scrubber-dim left" style={{ width: `${startPercent}%` }}/>
        <div className="scrubber-selection" style={{ left: `${startPercent}%`, width: `${Math.max(0, endPercent - startPercent)}%` }}/>
        <div className="scrubber-dim right" style={{ left: `${endPercent}%` }}/>
        <input className="scrubber-input start" aria-label="开始日期" type="range" min={0} max={lastIndex} value={range.startIndex} onChange={(event) => setStartIndex(Number(event.target.value))}/>
        <input className="scrubber-input end" aria-label="结束日期" type="range" min={0} max={lastIndex} value={range.endIndex} onChange={(event) => setEndIndex(Number(event.target.value))}/>
      </div>
      <div className="scrubber-dates"><time>{visible[0]?.date}</time><span>拖动两端圆点调整区间</span><time>{visible.at(-1)?.date}</time></div>
    </div>
  </div>;
}
