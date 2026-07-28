"use client";

import { useId, useRef, type CSSProperties } from "react";
import { Area, ComposedChart, ResponsiveContainer } from "recharts";

export type TimeRange = { startIndex: number; endIndex: number };
type PreviewPoint = { date: string; preview: number };

export function TimeRangeScrubber({
  data,
  range,
  onChange,
  accent = "#7662ee",
}: {
  data: PreviewPoint[];
  range: TimeRange;
  onChange: (range: TimeRange) => void;
  accent?: string;
}) {
  const gradientId = `scrubber-${useId().replaceAll(":", "")}`;
  const drag = useRef<{ clientX: number; startIndex: number; endIndex: number; width: number } | null>(null);
  const handleDrag = useRef<{ kind: "start" | "end"; left: number; width: number } | null>(null);
  const lastIndex = Math.max(0, data.length - 1);
  const visible = data.slice(range.startIndex, range.endIndex + 1);
  const startPercent = lastIndex ? range.startIndex / lastIndex * 100 : 0;
  const endPercent = lastIndex ? range.endIndex / lastIndex * 100 : 100;
  const selectedDays = visible.length > 1
    ? Math.round((Date.parse(`${visible.at(-1)?.date}T00:00:00Z`) - Date.parse(`${visible[0]?.date}T00:00:00Z`)) / 86_400_000) + 1
    : visible.length;

  const setStartIndex = (value: number) =>
    onChange({ ...range, startIndex: Math.min(Math.max(0, value), range.endIndex) });
  const setEndIndex = (value: number) =>
    onChange({ ...range, endIndex: Math.max(range.startIndex, Math.min(lastIndex, value)) });
  const handleKey = (kind: "start" | "end", key: string) => {
    const direction = key === "ArrowLeft" ? -1 : key === "ArrowRight" ? 1 : 0;
    if (!direction) return;
    if (kind === "start") setStartIndex(range.startIndex + direction);
    else setEndIndex(range.endIndex + direction);
  };

  return (
    <div className="range-scrubber">
      <div className="scrubber-head">
        <span>时间窗口</span>
        <strong>{selectedDays.toLocaleString("zh-CN")} 天 · {visible.length.toLocaleString("zh-CN")} 点</strong>
      </div>
      <div className="scrubber-track">
        <div className="scrubber-window">
          <div className="scrubber-sparkline" aria-hidden="true">
            <ResponsiveContainer width="100%" height={48}>
              <ComposedChart data={data} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
                <defs>
                  <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={accent} stopOpacity={0.42} />
                    <stop offset="100%" stopColor={accent} stopOpacity={0.04} />
                  </linearGradient>
                </defs>
                <Area type="monotone" dataKey="preview" stroke={accent} strokeWidth={1.4} fill={`url(#${gradientId})`} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="scrubber-dim left" style={{ width: `${startPercent}%` }} />
          <div
            className="scrubber-selection"
            style={{
              left: `${startPercent}%`,
              width: `${Math.max(0, endPercent - startPercent)}%`,
              "--scrubber-accent": accent,
            } as CSSProperties}
            onPointerDown={(event) => {
              const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
              if (!bounds || range.startIndex === range.endIndex) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              drag.current = {
                clientX: event.clientX,
                startIndex: range.startIndex,
                endIndex: range.endIndex,
                width: bounds.width,
              };
            }}
            onPointerMove={(event) => {
              if (!drag.current || !lastIndex) return;
              const delta = Math.round((event.clientX - drag.current.clientX) / drag.current.width * lastIndex);
              const span = drag.current.endIndex - drag.current.startIndex;
              const startIndex = Math.max(0, Math.min(lastIndex - span, drag.current.startIndex + delta));
              onChange({ startIndex, endIndex: startIndex + span });
            }}
            onPointerUp={(event) => {
              drag.current = null;
              event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            title="拖动选区平移时间窗口"
          />
          <div className="scrubber-dim right" style={{ left: `${endPercent}%` }} />
          {(["start", "end"] as const).map((kind) => {
            const value = kind === "start" ? range.startIndex : range.endIndex;
            const percent = kind === "start" ? startPercent : endPercent;
            return (
              <div
                aria-label={kind === "start" ? "开始日期" : "结束日期"}
                aria-valuemax={lastIndex}
                aria-valuemin={0}
                aria-valuenow={value}
                aria-valuetext={data[value]?.date}
                className={`scrubber-handle ${kind}`}
                key={kind}
                role="slider"
                style={{
                  left: `${percent}%`,
                  "--scrubber-accent": accent,
                } as CSSProperties}
                tabIndex={0}
                onKeyDown={(event) => handleKey(kind, event.key)}
                onPointerDown={(event) => {
                  const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
                  if (!bounds) return;
                  event.currentTarget.setPointerCapture(event.pointerId);
                  handleDrag.current = { kind, left: bounds.left, width: bounds.width };
                }}
                onPointerMove={(event) => {
                  if (!handleDrag.current || !lastIndex) return;
                  const index = Math.round((event.clientX - handleDrag.current.left) / handleDrag.current.width * lastIndex);
                  if (handleDrag.current.kind === "start") setStartIndex(index);
                  else setEndIndex(index);
                }}
                onPointerUp={(event) => {
                  handleDrag.current = null;
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }}
              />
            );
          })}
        </div>
      </div>
      <div className="scrubber-label-rail">
        <time style={{ left: `${startPercent}%` }}>{visible[0]?.date}</time>
        <span>拖动圆点缩放 · 拖动高亮区间平移</span>
        <time style={{ left: `${endPercent}%` }}>{visible.at(-1)?.date}</time>
      </div>
    </div>
  );
}
