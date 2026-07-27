import { describe, expect, it } from "vitest";
import { buildPortfolioRiskInput } from "./risk-input";

const dates = Array.from({ length: 251 }, (_, index) => {
  const date = new Date("2025-01-01T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + index);
  return date.toISOString().slice(0, 10);
});

const bar = (date: string, instrumentId: string, close: number, currency = "USD") => ({
  date,
  instrument_id: instrumentId,
  open: String(close - 1),
  high: String(close + 1),
  low: String(close - 2),
  close: String(close),
  currency,
});

describe("portfolio risk input", () => {
  it("canonicalizes positions, preserves cash drag, converts FX, and aligns 250 returns", () => {
    const positions = [
      { date: "2025-09-30", instrument_id: "XNAS:AAA", category: "stock", quantity: "2", currency: "USD", market_value: "60", market_value_base: "60", fx_to_base: "" },
      { date: "2025-09-30", instrument_id: "XKRX:BBB", category: "stock", quantity: "1", currency: "KRW", market_value: "40000", market_value_base: "30", fx_to_base: "" },
      { date: "2025-09-30", instrument_id: "CASH:USD", category: "cash", quantity: "10", currency: "USD", market_value: "10", market_value_base: "10", fx_to_base: "" },
    ];
    const bars = dates.flatMap((date, index) => [
      bar(date, "US:AAA", 100 + index),
      bar(date, "XKRX:BBB", 1000 + index, "KRW"),
      bar(date, "FX:KRWUSD", 0.001 + index / 1_000_000),
    ]);
    const result = buildPortfolioRiskInput(positions, bars);
    expect(result.positions).toEqual([
      { instrumentId: "US:AAA", weight: 0.6 },
      { instrumentId: "XKRX:BBB", weight: 0.3 },
    ]);
    expect(result.series).toHaveLength(2);
    expect(result.series.every((series) => series.bars.length === 60 && series.returnsUsd.length === 250)).toBe(true);
    expect(result.series[1].bars.at(-1)?.close).toBe((1000 + 250) * (0.001 + 250 / 1_000_000));
    expect(result.asOf).toBe(`${dates.at(-1)}T00:00:00Z`);
  });

  it("rejects insufficient common history", () => {
    const positions = [
      { date: "2025-09-30", instrument_id: "US:AAA", category: "stock", quantity: "1", currency: "USD", market_value: "100", market_value_base: "100", fx_to_base: "" },
    ];
    expect(() => buildPortfolioRiskInput(positions, dates.slice(0, 250).map((date, index) => bar(date, "US:AAA", 100 + index))))
      .toThrow("251 common USD close dates");
  });
});
