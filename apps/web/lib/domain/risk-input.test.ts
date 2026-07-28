import { describe, expect, it } from "vitest";
import { buildHistoricalPortfolioRiskInput, buildPortfolioRiskInput } from "./risk-input";

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

  it("builds an as-of risk input from replayed quantities without future market data", () => {
    const futureDate = "2026-01-01";
    const historicalBars = dates.flatMap((date, index) => [
      bar(date, "US:AAA", 100 + index),
      bar(date, "XKRX:BBB", 1000 + index, "KRW"),
      bar(date, "FX:KRWUSD", 0.001 + index / 1_000_000),
    ]);
    historicalBars.push(bar(futureDate, "US:AAA", 9999));
    const result = buildHistoricalPortfolioRiskInput({
      date: dates.at(-1)!,
      cash: {},
      transit: {},
      cashEquivalents: {},
      quantities: {
        "account-a|US:AAA": 2,
        "account-b|US:AAA": 1,
        "account-a|XKRX:BBB": 4,
        "account-a|US:AAA260117C00100000": 1,
      },
    }, 1_000, historicalBars);

    const finalIndex = dates.length - 1;
    expect(result.asOf).toBe(`${dates.at(-1)}T00:00:00Z`);
    expect(result.positions).toEqual([
      { instrumentId: "US:AAA", weight: 3 * (100 + finalIndex) / 1_000 },
      {
        instrumentId: "XKRX:BBB",
        weight: 4 * (1000 + finalIndex) * (0.001 + finalIndex / 1_000_000) / 1_000,
      },
    ]);
    expect(result.series[0].bars.at(-1)?.date).toBe(dates.at(-1));
    expect(result.series[0].bars.some((item) => item.close === 9999)).toBe(false);
  });

  it("requires a same-date close for every historical holding", () => {
    const state = {
      date: dates.at(-1)!,
      cash: {},
      transit: {},
      cashEquivalents: {},
      quantities: { "account-a|US:AAA": 1, "account-a|US:MISSING": 1 },
    };
    expect(() => buildHistoricalPortfolioRiskInput(
      state,
      1_000,
      dates.map((date, index) => bar(date, "US:AAA", 100 + index)),
    )).toThrow(`no ${dates.at(-1)} market close for US:MISSING`);
  });

  it("converts pre-split ledger quantities to the split-adjusted price basis", () => {
    const result = buildHistoricalPortfolioRiskInput({
      date: dates.at(-1)!,
      cash: {},
      transit: {},
      cashEquivalents: {},
      quantities: { "account-a|US:AAA": 10 },
    }, 1_000, dates.map((date, index) => bar(date, "US:AAA", 100 + index)), [{
      date: "2026-02-01",
      instrument_id: "US:AAA",
      numerator: "1",
      denominator: "2",
    }]);
    expect(result.positions[0].weight).toBe(5 * (100 + dates.length - 1) / 1_000);
  });
});
