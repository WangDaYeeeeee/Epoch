import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Sql } from "postgres";
import { currentPositionMarketDataRequirement, type MarketDataFreshness } from "../domain/market-data";
import { loadMarketDataFreshness } from "./baseline-data";
import { parseCsv } from "./csv";
import { resolveDataRoot } from "./portfolio";

const SOURCE = "market_data:normalized";
const FINGERPRINT = "freshness";

export async function persistMarketDataFreshness(sql: Sql, freshness: MarketDataFreshness): Promise<void> {
  if (freshness.status === "fresh") {
    await sql`
      UPDATE operational_alert
      SET status = 'resolved', resolved_at = now()
      WHERE source = ${SOURCE} AND fingerprint = ${FINGERPRINT} AND status = 'open'
    `;
    return;
  }
  const detail = [
    freshness.reason,
    `latest=${freshness.latestEffectiveDate ?? "missing"}`,
    `expected=${freshness.expectedThroughDate}`,
    `tradingDayLag=${freshness.tradingDayLag ?? "unknown"}`,
  ].join("; ");
  await sql`
    INSERT INTO operational_alert (
      id, source, fingerprint, severity, status, title, detail
    ) VALUES (
      ${randomUUID()}, ${SOURCE}, ${FINGERPRINT}, 'warning', 'open',
      '行情需要刷新', ${detail}
    )
    ON CONFLICT (source, fingerprint) DO UPDATE
    SET severity = 'warning', status = 'open', detail = EXCLUDED.detail,
        occurrence_count = operational_alert.occurrence_count + 1,
        last_observed_at = now(), resolved_at = NULL
  `;
}

export async function runMarketDataFreshnessMonitor(sql: Sql): Promise<"succeeded"> {
  const root = resolveDataRoot();
  if (!root) throw new Error("Private baseline data is unavailable");
  const positions = parseCsv(readFileSync(resolve(root, "normalized/positions.csv"), "utf8"));
  const requirement = currentPositionMarketDataRequirement(positions);
  const freshness = loadMarketDataFreshness(root, requirement);
  await persistMarketDataFreshness(sql, freshness);
  return "succeeded";
}
