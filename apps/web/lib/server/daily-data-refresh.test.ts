import { describe, expect, it, vi } from "vitest";
import { runDailyDataRefresh } from "./daily-data-refresh";
import { marketRefreshPreflight } from "./market-refresh";

describe("manual daily data refresh", () => {
  it("refreshes account NAV, benchmark and market data before follow-up calculations", async () => {
    const calls: string[] = [];
    const sql = Object.assign(
      vi.fn(async () => []),
      { json: vi.fn() },
    );
    const result = await runDailyDataRefresh(sql as never, {
      syncAccount: vi.fn(async () => {
        calls.push("account");
        return {
          status: "succeeded" as const,
          latestNavDate: "2026-07-29",
          latestPositionDate: "2026-07-29",
        };
      }),
      syncBenchmark: vi.fn(async () => {
        calls.push("benchmark");
        return { status: "succeeded" as const, latestObservationDate: "2026-07-29" };
      }),
      refreshMarket: vi.fn(async () => {
        calls.push("market");
        return { latestDate: "2026-07-29" };
      }),
      runFollowUp: vi.fn(async () => {
        calls.push("follow-up");
        return {
          freshness: "succeeded" as const,
          risk: "skipped" as const,
          qualityEvaluationsInserted: 0,
        };
      }),
      now: new Date("2026-07-30T01:00:00Z"),
      preflight: marketRefreshPreflight(new Date("2026-07-30T01:00:00Z")),
    });

    expect(calls).toEqual(["account", "benchmark", "market", "follow-up"]);
    expect(result.status).toBe("succeeded");
    expect(result.account.latestNavDate).toBe("2026-07-29");
    expect(result.account.latestPositionDate).toBe("2026-07-29");
    expect(result.benchmark.latestObservationDate).toBe("2026-07-29");
    expect(result.observedAt).toBe("2026-07-30T01:00:00.000Z");
  });
});
