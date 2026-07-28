import type { PortfolioPayload } from "../types";

export type OperationPriority = "critical" | "action" | "review";
export type OperationCategory = "risk" | "data" | "coverage" | "event" | "refill" | "governance" | "review" | "approval";

export type OperationItem = {
  id: string;
  priority: OperationPriority;
  category: OperationCategory;
  title: string;
  detail: string;
  evidence: string;
};

export type OperationsSnapshot = {
  asOf: string;
  status: "clear" | "attention" | "critical";
  counts: Record<OperationPriority, number>;
  items: OperationItem[];
};

const priorityRank: Record<OperationPriority, number> = { critical: 0, action: 1, review: 2 };
const marketFreshnessAlertSources = new Set(["market_data:normalized", "market-data-freshness-monitor"]);

export function mergeOperationItems(snapshot: OperationsSnapshot, additional: OperationItem[]): OperationsSnapshot {
  const byId = new Map([...snapshot.items, ...additional].map((item) => [item.id, item]));
  const items = [...byId.values()].sort((left, right) =>
    priorityRank[left.priority] - priorityRank[right.priority]
    || left.category.localeCompare(right.category)
    || left.id.localeCompare(right.id));
  const counts = {
    critical: items.filter((item) => item.priority === "critical").length,
    action: items.filter((item) => item.priority === "action").length,
    review: items.filter((item) => item.priority === "review").length,
  };
  return {
    ...snapshot,
    status: counts.critical ? "critical" : items.length ? "attention" : "clear",
    counts,
    items,
  };
}

export function buildOperationsSnapshot(
  payload: Omit<PortfolioPayload, "operations">,
): OperationsSnapshot {
  const items: OperationItem[] = [];
  const alerts = payload.health.operationalAlerts ?? [];

  for (const alert of alerts) {
    const isMarketFreshnessAlert = marketFreshnessAlertSources.has(alert.source);
    items.push({
      id: `alert:${alert.id}`,
      priority: alert.severity === "error" ? "critical" : "action",
      category: alert.source.includes("risk") ? "risk" : "data",
      title: isMarketFreshnessAlert ? "行情需要刷新" : alert.title,
      detail: isMarketFreshnessAlert
        ? payload.health.marketDataFreshness?.reason ?? alert.detail
        : alert.detail,
      evidence: `${alert.occurrenceCount} 次 · 最近 ${alert.lastObservedAt.slice(0, 16).replace("T", " ")}`,
    });
  }

  const freshness = payload.health.marketDataFreshness;
  if (freshness && freshness.status !== "fresh"
    && !alerts.some((alert) => marketFreshnessAlertSources.has(alert.source))) {
    items.push({
      id: "market-data-freshness",
      priority: freshness.status === "missing" ? "critical" : "action",
      category: "data",
      title: freshness.status === "missing" ? "行情输入缺失" : "行情需要刷新",
      detail: freshness.reason,
      evidence: `最新 ${freshness.latestEffectiveDate ?? "未知"} · 预期 ${freshness.expectedThroughDate}`,
    });
  }

  if (!payload.risk) {
    items.push({
      id: "portfolio-risk-missing",
      priority: "critical",
      category: "risk",
      title: "缺少真实组合风险运行",
      detail: "当前没有可用于判断组合风险卡口的已完成 CalculationRun。",
      evidence: `组合数据截至 ${payload.meta.asOf}`,
    });
  } else if (!payload.risk.policyGate.passed) {
    items.push({
      id: "portfolio-volatility-gate",
      priority: "critical",
      category: "risk",
      title: "组合波动率越过 45% 卡口",
      detail: "需要复核并形成显式降风险意向；系统不会自动生成权重或下单。",
      evidence: `σₚ ${(payload.risk.policyGate.observedAnnualized * 100).toFixed(2)}% · 上限 ${(payload.risk.policyGate.limitAnnualized * 100).toFixed(0)}%`,
    });
  }

  const missingExposure = payload.exposure.issuerCoverage.missingInstrumentIds;
  if (missingExposure.length) {
    items.push({
      id: "issuer-coverage",
      priority: "review",
      category: "coverage",
      title: "持仓穿透尚未完整",
      detail: `补充 ${missingExposure.join("、")} 的发行人分类或基金成分快照。`,
      evidence: `发行人覆盖率 ${(payload.exposure.issuerCoverage.ratio * 100).toFixed(2)}%`,
    });
  }

  for (const event of payload.eventHorizon?.items.filter((item) => item.needsPlaybook) ?? []) {
    items.push({
      id: `event-playbook:${event.id}`,
      priority: event.tradingDaysAway <= 3 ? "action" : "review",
      category: "event",
      title: "近区事件缺少可执行预案",
      detail: `${event.title}${event.instrumentId ? ` · ${event.instrumentId}` : ""}`,
      evidence: event.tradingDaysAway === 0 ? "今日事件" : `${event.tradingDaysAway} 个交易日后`,
    });
  }

  if (payload.riskDrift) {
    const strong = payload.riskDrift.instruments.filter((item) => item.level === "strong");
    const highlighted = payload.riskDrift.instruments.filter((item) => item.level === "highlight");
    if (payload.riskDrift.portfolio.level !== "normal" || strong.length || highlighted.length) {
      const names = [...strong, ...highlighted].map((item) => item.instrumentId);
      items.push({
        id: "volatility-drift-review",
        priority: strong.length || payload.riskDrift.portfolio.level === "strong" ? "action" : "review",
        category: "risk",
        title: "波动率漂移需要书面复核",
        detail: names.length ? `高亮标的：${names.join("、")}` : "组合波动率相对执行锚点显著漂移。",
        evidence: payload.riskDrift.portfolio.ratio == null
          ? "组合漂移倍数不可用"
          : `组合 σₚ/σₚ⁰ = ${payload.riskDrift.portfolio.ratio.toFixed(2)}×`,
      });
    }
  }

  items.sort((left, right) =>
    priorityRank[left.priority] - priorityRank[right.priority]
    || left.category.localeCompare(right.category)
    || left.id.localeCompare(right.id));
  const counts = {
    critical: items.filter((item) => item.priority === "critical").length,
    action: items.filter((item) => item.priority === "action").length,
    review: items.filter((item) => item.priority === "review").length,
  };
  return {
    asOf: payload.meta.asOf,
    status: counts.critical ? "critical" : items.length ? "attention" : "clear",
    counts,
    items,
  };
}
