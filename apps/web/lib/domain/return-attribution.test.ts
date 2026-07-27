import { describe, expect, it } from "vitest";
import { attributePortfolioReturns } from "./return-attribution";

describe("return attribution", () => {
  it("reconciles opening-position moves, execution effects, income, and residual", () => {
    const result = attributePortfolioReturns({
      states: [
        { date: "2026-01-01", cash: { "a|HKD": 100 }, transit: {}, cashEquivalents: {}, quantities: { "a|US:AAA": 10 } },
        { date: "2026-01-02", cash: { "a|HKD": 100 }, transit: {}, cashEquivalents: {}, quantities: { "a|US:AAA": 12 } },
      ],
      prices: [
        { date: "2026-01-01", instrument_id: "US:AAA", close: "10", currency: "USD" },
        { date: "2026-01-02", instrument_id: "US:AAA", close: "12", currency: "USD" },
        { date: "2026-01-01", instrument_id: "FX:HKDUSD", close: "0.12", currency: "USD" },
        { date: "2026-01-02", instrument_id: "FX:HKDUSD", close: "0.13", currency: "USD" },
      ],
      transactions: [
        { date: "2026-01-02", instrument_id: "US:AAA", action: "buy", quantity: "2", price: "11", fees: "1", tax: "", currency: "USD" },
        { date: "2026-01-02", instrument_id: "", action: "dividend", cash_amount: "3", currency: "USD" },
      ],
      performance: [
        { date: "2026-01-01", total_assets: "100", net_external_flow: "0" },
        { date: "2026-01-02", total_assets: "126", net_external_flow: "0" },
      ],
      splits: [],
      residualReasonsByDate: { "2026-01-02": ["SUBACCOUNT:7313", "US:MISSING"] },
    });
    expect(result.securities).toEqual([
      { instrumentId: "US:AAA", pnlUsd: 21 },
      { instrumentId: "CASH:HKD", pnlUsd: 1.0000000000000009 },
    ]);
    expect(result.cashIncomePnlUsd).toBe(3);
    expect(result.explainedPnlUsd).toBe(25);
    expect(result.portfolioPnlUsd).toBe(26);
    expect(result.residualPnlUsd).toBe(1);
    expect(result.residuals).toEqual([{
      reason: "SUBACCOUNT:7313 + US:MISSING",
      pnlUsd: 1,
      days: 1,
    }]);
    expect(result.largestResidualDays).toEqual([{
      date: "2026-01-02",
      reason: "SUBACCOUNT:7313 + US:MISSING",
      pnlUsd: 1,
      actions: ["buy", "dividend"],
    }]);
    expect(result.explainedRatio).toBe(25 / 26);
  });

  it("attributes a sale as execution price minus closing price", () => {
    const result = attributePortfolioReturns({
      states: [
        { date: "2026-01-01", cash: {}, transit: {}, cashEquivalents: {}, quantities: { "a|US:AAA": 2 } },
        { date: "2026-01-02", cash: {}, transit: {}, cashEquivalents: {}, quantities: { "a|US:AAA": 1 } },
      ],
      prices: [
        { date: "2026-01-01", instrument_id: "US:AAA", close: "10", currency: "USD" },
        { date: "2026-01-02", instrument_id: "US:AAA", close: "12", currency: "USD" },
      ],
      transactions: [
        { date: "2026-01-02", instrument_id: "US:AAA", action: "sell", quantity: "1", price: "13", fees: "0", tax: "", currency: "USD" },
      ],
      performance: [
        { date: "2026-01-01", total_assets: "20", net_external_flow: "0" },
        { date: "2026-01-02", total_assets: "25", net_external_flow: "0" },
      ],
      splits: [],
    });
    expect(result.securities).toEqual([{ instrumentId: "US:AAA", pnlUsd: 5 }]);
    expect(result.residualPnlUsd).toBe(0);
  });

  it("uses cash proceeds for a zero-net-quantity round trip without a closing price", () => {
    const result = attributePortfolioReturns({
      states: [
        { date: "2026-01-01", cash: {}, transit: {}, cashEquivalents: {}, quantities: {} },
        { date: "2026-01-02", cash: {}, transit: {}, cashEquivalents: {}, quantities: {} },
      ],
      prices: [],
      transactions: [
        { date: "2026-01-02", instrument_id: "US:AAA", action: "buy", quantity: "2", price: "10", cash_amount: "-21", currency: "USD" },
        { date: "2026-01-02", instrument_id: "US:AAA", action: "sell", quantity: "2", price: "12", cash_amount: "23", currency: "USD" },
      ],
      performance: [
        { date: "2026-01-01", total_assets: "20", net_external_flow: "0" },
        { date: "2026-01-02", total_assets: "22", net_external_flow: "0" },
      ],
      splits: [],
    });
    expect(result.securities).toEqual([{ instrumentId: "US:AAA", pnlUsd: 2 }]);
    expect(result.residualPnlUsd).toBe(0);
  });

  it("uses a priced position adjustment as the pre-listing valuation anchor", () => {
    const result = attributePortfolioReturns({
      states: [
        { date: "2026-01-01", cash: {}, transit: {}, cashEquivalents: {}, quantities: {} },
        { date: "2026-01-02", cash: {}, transit: {}, cashEquivalents: {}, quantities: { "a|US:IPO": 2 } },
        { date: "2026-01-03", cash: {}, transit: {}, cashEquivalents: {}, quantities: { "a|US:IPO": 2 } },
      ],
      prices: [
        { date: "2026-01-03", instrument_id: "US:IPO", close: "15", currency: "USD" },
      ],
      transactions: [
        { date: "2026-01-02", instrument_id: "US:IPO", action: "adjustment_in", quantity: "2", price: "10", cash_amount: "", currency: "USD" },
      ],
      performance: [
        { date: "2026-01-01", total_assets: "0", net_external_flow: "0" },
        { date: "2026-01-02", total_assets: "20", net_external_flow: "20" },
        { date: "2026-01-03", total_assets: "30", net_external_flow: "0" },
      ],
      splits: [],
    });
    expect(result.securities).toEqual([{ instrumentId: "US:IPO", pnlUsd: 10 }]);
    expect(result.residualPnlUsd).toBe(0);
  });
});
