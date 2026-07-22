import { describe, expect, it } from "vitest";
import { ledgerReplayReadiness, reconcileCashEndpoints, replayLedgerDaily } from "./ledger-replay";

describe("ledger replay readiness", () => {
  it("classifies cash equivalents separately from market trades", () => {
    expect(ledgerReplayReadiness([
      { date: "2026-01-01", account_id: "a", action: "buy", instrument_id: "US:NVDA", quantity: "2" },
      { date: "2026-01-02", account_id: "a", action: "buy", instrument_id: "FUND:HK0000938420", quantity: "10" },
      { date: "2026-01-03", account_id: "a", action: "dividend", instrument_id: "US:NVDA" },
    ], [])).toMatchObject({ total: 3, classified: 3, marketTrades: 1, cashEquivalentTrades: 1, cashEvents: 1 });
  });

  it("classifies listed options separately from daily-priced market securities", () => {
    expect(ledgerReplayReadiness([
      { date: "2026-01-01", account_id: "a", action: "sell", instrument_id: "US:TCOM260220P65000", quantity: "1" },
    ], [])).toMatchObject({ total: 1, classified: 1, marketTrades: 0, derivativeTrades: 1 });
  });

  it("only marks a split as impacting when the position is open", () => {
    const split = [{ date: "2026-01-02", instrument_id: "US:NVDA", numerator: "2", denominator: "1" }];
    expect(ledgerReplayReadiness([
      { date: "2026-01-01", account_id: "a", action: "buy", instrument_id: "XNAS:NVDA", quantity: "2" },
    ], split)).toMatchObject({ splitEvents: 1, positionImpactingSplits: 1 });
    expect(ledgerReplayReadiness([
      { date: "2026-01-01", account_id: "a", action: "buy", instrument_id: "US:NVDA", quantity: "2" },
      { date: "2026-01-01", account_id: "a", action: "sell", instrument_id: "US:NVDA", quantity: "2" },
    ], split)).toMatchObject({ splitEvents: 1, positionImpactingSplits: 0 });
  });

  it("replays cash amounts through each account's latest reported cash endpoint", () => {
    const result = reconcileCashEndpoints([
      { date: "2026-01-01", account_id: "a", currency: "USD", cash_amount: "100" },
      { date: "2026-01-02", account_id: "a", currency: "USD", cash_amount: "-25" },
      { date: "2026-01-03", account_id: "a", currency: "USD", cash_amount: "10" },
      { date: "2026-01-01", account_id: "b", currency: "HKD", cash_amount: "50" },
    ], [
      { date: "2026-01-02", account_id: "a", instrument_id: "CASH:USD", currency: "USD", quantity: "75.005" },
      { date: "2026-01-03", account_id: "b", instrument_id: "CASH:HKD", currency: "HKD", quantity: "40" },
    ]);
    expect(result).toMatchObject({ endpoints: 2, matched: 1 });
    expect(result.differences[0]).toMatchObject({ accountId: "b", currency: "HKD", replayed: 50, reported: 40, difference: -10 });
  });

  it("produces deterministic daily cash and quantity states", () => {
    const result = replayLedgerDaily([
      { date: "2026-01-01", account_id: "a", currency: "USD", action: "deposit", cash_amount: "100", quantity: "", instrument_id: "CASH:USD" },
      { date: "2026-01-02", account_id: "a", currency: "USD", action: "buy", cash_amount: "-20", quantity: "2", instrument_id: "XNAS:NVDA" },
    ], [
      { date: "2026-01-03", instrument_id: "US:NVDA", numerator: "2", denominator: "1" },
    ], ["2026-01-01", "2026-01-02", "2026-01-03"]);
    expect(result).toMatchObject({ days: 3, transactionEventsApplied: 2, splitEventsApplied: 1 });
    expect(result.states[0]).toMatchObject({ cash: { "a|USD": 100 }, transit: {}, cashEquivalents: {}, quantities: {} });
    expect(result.states[1]).toMatchObject({ cash: { "a|USD": 80 }, quantities: { "a|US:NVDA": 2 } });
    expect(result.states[2]).toMatchObject({ cash: { "a|USD": 80 }, quantities: { "a|US:NVDA": 4 } });
  });

  it("recognizes IBKR Sunday overnight trades on Monday's portfolio date", () => {
    const result = replayLedgerDaily([
      { date: "2026-05-31", account_id: "a", currency: "USD", action: "buy", cash_amount: "-20", quantity: "2", instrument_id: "XNAS:NVDA", source: "ibkr_activity:statement.csv" },
    ], [], ["2026-05-31", "2026-06-01"]);
    expect(result.states[0]).toMatchObject({ cash: {}, quantities: {} });
    expect(result.states[1]).toMatchObject({ cash: { "a|USD": -20 }, quantities: { "a|US:NVDA": 2 } });
  });

  it("carries money-market funds at book value while preserving their units", () => {
    const result = replayLedgerDaily([
      { date: "2026-01-01", account_id: "a", currency: "USD", action: "buy", cash_amount: "-100", quantity: "10", instrument_id: "FUND:HK0000938420" },
      { date: "2026-01-02", account_id: "a", currency: "USD", action: "sell", cash_amount: "55", quantity: "5", instrument_id: "FUND:HK0000938420" },
    ], [], ["2026-01-01", "2026-01-02"]);
    expect(result.states[0].cashEquivalents).toEqual({ "a|FUND:HK0000938420": 100 });
    expect(result.states[1]).toMatchObject({ cashEquivalents: { "a|FUND:HK0000938420": 50 }, quantities: { "a|FUND:HK0000938420": 5 } });
  });

  it("preserves internal bank transfers as assets while they are in transit", () => {
    const result = replayLedgerDaily([
      { date: "2026-01-01", account_id: "a", currency: "USD", action: "deposit", cash_amount: "100", external_flow: "true", quantity: "", instrument_id: "CASH:USD", note: "" },
      { date: "2026-01-02", account_id: "a", currency: "USD", action: "transfer_out", cash_amount: "-80", external_flow: "false", quantity: "", instrument_id: "CASH:USD", note: "Temporary bank transit" },
      { date: "2026-01-03", account_id: "b", currency: "USD", action: "transfer_in", cash_amount: "79", external_flow: "false", quantity: "", instrument_id: "CASH:USD", note: "Internal migration from bank" },
    ], [], ["2026-01-02", "2026-01-03"]);
    expect(result.states[0]).toMatchObject({ cash: { "a|USD": 20 }, transit: { "bank|USD": 80 } });
    expect(result.states[1]).toMatchObject({ cash: { "a|USD": 20, "b|USD": 79 }, transit: { "bank|USD": 0 } });
  });

  it("closes a child-account balance on its final return instead of retaining its trading loss", () => {
    const result = replayLedgerDaily([
      { transaction_id: "1", date: "2026-01-01", account_id: "a", currency: "USD", action: "transfer_out", cash_amount: "-100", external_flow: "false", quantity: "", instrument_id: "CASH:USD", note: "INTER-ACCOUNT TRANSFER TO 7313 USD 100" },
      { transaction_id: "2", date: "2026-01-02", account_id: "a", currency: "USD", action: "transfer_in", cash_amount: "90", external_flow: "false", quantity: "", instrument_id: "CASH:USD", note: "INTER-ACCOUNT TRANSFER FROM 7313 USD 90" },
    ], [], ["2026-01-01", "2026-01-02"]);
    expect(result.states[0].transit).toEqual({ "subaccount:7313|USD": 100 });
    expect(result.states[1].transit).toEqual({ "subaccount:7313|USD": 0 });
  });
});
