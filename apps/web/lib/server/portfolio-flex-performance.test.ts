import { describe, expect, it } from "vitest";
import { appendFlexPerformanceRows } from "./portfolio";

describe("Flex NAV performance continuation", () => {
  it("links post-baseline NAV while excluding external cash flows from return", () => {
    const rows = appendFlexPerformanceRows([{
      date: "2026-07-18",
      portfolio_id: "satellite",
      total_assets: "100",
      cash: "10",
      net_external_flow: "0",
      currency: "USD",
      nav: "120",
      period_return: "0",
      benchmark: "NASDAQ-100 Index",
      benchmark_return: "0",
      source: "baseline",
      external_flow_weight: "",
    }], [
      { date: "2026-07-20", nav: "160", cash: "60" },
      { date: "2026-07-21", nav: "144", cash: "54" },
    ], [
      { date: "2026-07-19", amountBase: "50" },
    ], [
      { date: "2026-07-17", close: "100" },
      { date: "2026-07-20", close: "102" },
      { date: "2026-07-21", close: "99.96" },
    ]);

    expect(rows).toHaveLength(3);
    expect(Number(rows[1].period_return)).toBeCloseTo(0.1, 12);
    expect(Number(rows[1].nav)).toBeCloseTo(132, 12);
    expect(Number(rows[1].benchmark_return)).toBeCloseTo(0.02, 12);
    expect(rows[1].net_external_flow).toBe("50");
    expect(Number(rows[2].period_return)).toBeCloseTo(-0.1, 12);
    expect(Number(rows[2].nav)).toBeCloseTo(118.8, 12);
    expect(Number(rows[2].benchmark_return)).toBeCloseTo(-0.02, 12);
  });
});
