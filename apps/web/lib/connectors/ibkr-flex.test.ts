import { describe, expect, it } from "vitest";
import { parseIbkrFlexStatement } from "./ibkr-flex";

const statement = `HEADER,TRNT,DataDiscriminator,AssetCategory,Currency,Symbol,Description,Conid,ListingExchange,TradeID,DateTime,Quantity,TradePrice,IBCommission,Buy/Sell
DATA,TRNT,Order,Stocks,USD,NVDA,NVIDIA CORP,4815747,NASDAQ,99101,20260720;153001,10,172.25,-1.00,BUY
DATA,TRNT,Order,Stocks,USD,NVDA,NVIDIA CORP,4815747,NASDAQ,99102,20260721;153001,4,175.50,-0.75,SELL
HEADER,CTRN,Currency,TransactionID,Date/Time,Type,Description,Amount
DATA,CTRN,USD,77101,20260719,Deposits/Withdrawals,Deposit,10000.00
DATA,CTRN,USD,77102,20260721,Dividends,NVDA cash dividend,25.50
HEADER,POST,Account ID,Currency,Asset Class,FX Rate to Base,Symbol,Description,Conid,Report Date,Quantity,Mark Price,Position Value,Cost Basis Money,Listing Exchange
DATA,POST,ibkr_8602,USD,STK,1,NVDA,NVIDIA CORP,4815747,20260721,6,175.50,1053.00,900.00,NASDAQ
HEADER,EQUT,Account ID,Report Date,Cash,Stock,Total
DATA,EQUT,ibkr_8602,20260721,1200.50,25000.00,26200.50
`;

describe("IBKR Flex connector", () => {
  it("normalizes sectioned Flex CSV into immutable ledger facts", () => {
    const parsed = parseIbkrFlexStatement(statement, { accountId: "ibkr_8602", baseCurrency: "USD" });
    expect(parsed.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(parsed.sourceCounts).toEqual({
      Trades: 2,
      "Cash Transactions": 2,
      "Open Positions": 1,
      "Net Asset Value (NAV) Summary in Base": 1,
    });
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
    expect(parsed.cashFlows.map(({ kind, amountMinor, fxRateToBase }) => ({ kind, amountMinor, fxRateToBase }))).toEqual([
      { kind: "deposit", amountMinor: 1000000, fxRateToBase: null },
      { kind: "dividend", amountMinor: 2550, fxRateToBase: null },
    ]);
    expect(parsed.navSnapshots).toEqual([{
      accountId: "ibkr_8602",
      date: "2026-07-21",
      nav: 26200.5,
      cash: 1200.5,
      currency: "USD",
    }]);
    expect(parsed.positionSnapshots).toEqual([{
      accountId: "ibkr_8602",
      date: "2026-07-21",
      instrumentId: "IBKR:4815747",
      ticker: "NVDA",
      name: "NVIDIA CORP",
      category: "stock",
      quantity: 6,
      price: 175.5,
      marketValue: 1053,
      currency: "USD",
      costBasis: 900,
      baseCurrency: "USD",
      fxToBase: 1,
      marketValueBase: 1053,
    }]);
  });

  it("rejects duplicate provider identifiers", () => {
    expect(() => parseIbkrFlexStatement(
      statement.replace("99102", "99101"),
      { accountId: "ibkr_8602", baseCurrency: "USD" },
    )).toThrow("Duplicate IBKR Flex external id");
  });
});
