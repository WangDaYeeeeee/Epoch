import { describe, expect, it } from "vitest";
import { rollingGarmanKlassVolatilityHistory } from "./instrument-volatility-history";

describe("rollingGarmanKlassVolatilityHistory", () => {
  it("calculates each point from its real rolling OHLC window", () => {
    const rows = [
      ["2026-07-01", "100", "104", "99", "102"],
      ["2026-07-02", "102", "106", "101", "105"],
      ["2026-07-03", "105", "108", "100", "101"],
      ["2026-07-04", "101", "103", "97", "99"],
    ].map(([date, open, high, low, close]) => ({
      date, instrument_id: "US:AAA", open, high, low, close,
    }));
    const points = rollingGarmanKlassVolatilityHistory("US:AAA", rows, 3);
    expect(points).toHaveLength(2);
    expect(points.map((point) => point.date)).toEqual(["2026-07-03", "2026-07-04"]);
    expect(points[0].value).not.toBe(points[1].value);
  });

  it("does not invent values before a complete market-data window exists", () => {
    expect(rollingGarmanKlassVolatilityHistory("US:AAA", [{
      date: "2026-07-01",
      instrument_id: "US:AAA",
      open: "100",
      high: "102",
      low: "99",
      close: "101",
    }], 2)).toEqual([]);
  });
});
