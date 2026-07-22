import { describe, expect, it } from "vitest";
import { parseIbkrFlexStatement } from "./ibkr-flex";

const statement = `Trades,Header,DataDiscriminator,AssetCategory,Currency,Symbol,Description,Conid,ListingExchange,TradeID,DateTime,Quantity,TradePrice,IBCommission,Buy/Sell
Trades,Data,Order,Stocks,USD,NVDA,NVIDIA CORP,4815747,NASDAQ,99101,20260720;153001,10,172.25,-1.00,BUY
Trades,Data,Order,Stocks,USD,NVDA,NVIDIA CORP,4815747,NASDAQ,99102,20260721;153001,4,175.50,-0.75,SELL
Cash Transactions,Header,Currency,TransactionID,DateTime,Type,Description,Amount
Cash Transactions,Data,USD,77101,20260719,Deposits/Withdrawals,Deposit,10000.00
Cash Transactions,Data,USD,77102,20260721,Dividends,NVDA cash dividend,25.50
`;

describe("IBKR Flex connector", () => {
  it("normalizes sectioned Flex CSV into immutable ledger facts", () => {
    const parsed = parseIbkrFlexStatement(statement);
    expect(parsed.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(parsed.sourceCounts).toEqual({ Trades: 2, "Cash Transactions": 2 });
    expect(parsed.instruments).toEqual([{
      id: "IBKR:4815747",
      ticker: "NVDA",
      name: "NVIDIA CORP",
      venue: "NASDAQ",
      currency: "USD",
    }]);
    expect(parsed.trades.map(({ externalId, quantity, priceMinor, feeMinor }) => ({ externalId, quantity, priceMinor, feeMinor }))).toEqual([
      { externalId: "IBKR:TRADE:99101", quantity: 10, priceMinor: 17225, feeMinor: 100 },
      { externalId: "IBKR:TRADE:99102", quantity: -4, priceMinor: 17550, feeMinor: 75 },
    ]);
    expect(parsed.cashFlows.map(({ kind, amountMinor }) => ({ kind, amountMinor }))).toEqual([
      { kind: "deposit", amountMinor: 1000000 },
      { kind: "dividend", amountMinor: 2550 },
    ]);
  });

  it("rejects duplicate provider identifiers", () => {
    expect(() => parseIbkrFlexStatement(statement.replace("99102", "99101"))).toThrow("Duplicate IBKR Flex external id");
  });
});
