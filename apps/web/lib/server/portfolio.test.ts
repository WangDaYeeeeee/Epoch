import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { loadPortfolio } from "./portfolio";

describe("staged satellite portfolio", () => {
  it("keeps the two-account history as one continuous portfolio", () => {
    const payload = loadPortfolio(resolve(process.cwd(), "../../tmp/satellite-data"));
    expect(payload.series).toHaveLength(545);
    expect(payload.meta.account).toContain("FUTU");
    expect(payload.meta.account).toContain("IBKR");
    expect(payload.series[0].date).toBe("2025-01-20");
    expect(payload.series.at(-1)?.date).toBe("2026-07-18");
    expect(payload.series.every((point) => point.portfolio > 0 && point.benchmark > 0)).toBe(true);
    expect(payload.positions.every((position) => position.marketValue < payload.summary.nav)).toBe(true);
    expect(payload.positions.some((position) => position.currency === "KRW")).toBe(true);
    expect(payload.positions.map((position) => position.marketValue)).toEqual(
      [...payload.positions].map((position) => position.marketValue).sort((left, right) => right - left),
    );
  });
});
