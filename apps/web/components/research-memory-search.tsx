"use client";

import { FormEvent, useState } from "react";

type MemoryResult = {
  id: string;
  kind: "claim" | "evidence" | "theme" | "review";
  title: string;
  body: string;
  as_of: string;
  confidence: number | null;
  source: string;
  candidate_id: string | null;
  status: string | null;
  score: number;
};

const kindName: Record<MemoryResult["kind"], string> = {
  claim: "命题", evidence: "证据", theme: "主题", review: "复盘",
};

export function ResearchMemorySearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MemoryResult[]>([]);
  const [state, setState] = useState<"idle" | "working" | "success" | "error">("idle");
  const [message, setMessage] = useState("只读检索，不修改历史记录。");

  const search = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setState("working");
    setMessage("正在检索…");
    try {
      const response = await fetch(`/api/v1/research/memory?q=${encodeURIComponent(query)}&limit=20`);
      const body = await response.json() as { results?: MemoryResult[]; detail?: string };
      if (!response.ok) throw new Error(body.detail ?? "检索失败");
      const next = body.results ?? [];
      setResults(next);
      setState("success");
      setMessage(next.length ? `找到 ${next.length} 条相关记忆。` : "没有匹配的历史记录。");
    } catch (error) {
      setResults([]);
      setState("error");
      setMessage(error instanceof Error ? error.message : "检索失败");
    }
  };

  return (
    <article className="panel memory-panel" id="memory">
      <div className="panel-head">
        <div><h2>研究记忆</h2><p>命题、证据、主题与复盘的统一只读检索</p></div>
        <span className={`memory-status ${state}`}>{message}</span>
      </div>
      <form className="memory-search" onSubmit={search}>
        <input
          aria-label="研究记忆关键词"
          minLength={2}
          maxLength={200}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="输入至少两个字符，例如：半导体 需求"
          required
          value={query}
        />
        <button disabled={state === "working"} type="submit">{state === "working" ? "检索中" : "检索"}</button>
      </form>
      {results.length > 0 && (
        <div className="memory-results">
          {results.map((result) => (
            <div className="memory-result" key={`${result.kind}:${result.id}`}>
              <span>{kindName[result.kind]}</span>
              <div>
                <strong>{result.title}</strong>
                <p>{result.body || "无补充说明"}</p>
              </div>
              <small>
                {result.as_of} · {result.source}
                {result.confidence == null ? "" : ` · 置信度 ${(result.confidence * 100).toFixed(0)}%`}
                {result.status ? ` · ${result.status}` : ""}
              </small>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}
