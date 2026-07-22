import { describe, expect, it } from "vitest";
import { ledgerReplayReadiness, reconcileCashEndpoints } from "./ledger-replay";

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
});
