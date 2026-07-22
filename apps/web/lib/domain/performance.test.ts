import { describe, expect, it } from "vitest";
import { calculateMoneyWeightedReturn, performanceCashFlows } from "./performance";

describe("portfolio performance", () => {
  it("calculates an annualized money-weighted return from dated investor cash flows", () => {
    const result = calculateMoneyWeightedReturn([
      { date: "2025-01-01", value: -100 },
      { date: "2026-01-01", value: 110 },
    ]);
    expect(result?.annualized).toBeCloseTo(0.1, 8);
    expect(result?.cumulative).toBeCloseTo(0.1, 8);
  });

  it("converts portfolio contributions to investor-perspective cash flows", () => {
    expect(performanceCashFlows([
      { date: "2025-01-01", total_assets: "10", net_external_flow: "0" },
      { date: "2025-02-01", total_assets: "120", net_external_flow: "100" },
    ])).toEqual([
      { date: "2025-01-01", value: -10 },
      { date: "2025-02-01", value: -100 },
      { date: "2025-02-01", value: 120 },
    ]);
  });
});
