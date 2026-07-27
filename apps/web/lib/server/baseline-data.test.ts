import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadBaselineDataset, loadMarketDataFreshness, reconcileEventCoverage, reconcilePositionQuantities, reconcileReportedValuations } from "./baseline-data";

const temporaryRoots: string[] = [];

function fixture(externalFlow = "true"): string {
  const root = mkdtempSync(join(tmpdir(), "epoch-baseline-"));
  temporaryRoots.push(root);
  mkdirSync(join(root, "normalized"));
  writeFileSync(join(root, "normalized", "transactions.csv"), `transaction_id,date,account_id,instrument_id,action,quantity,price,currency,fees,tax,cash_amount,external_flow,source,note
t1,2026-01-01,futu_2189,,deposit,,,USD,0,0,100,${externalFlow},fixture,
`);
  writeFileSync(join(root, "normalized", "positions.csv"), `date,account_id,instrument_id,ticker,name,category,quantity,price,market_value,currency,cost_basis,fx_to_cny,market_value_cny,source,base_currency,fx_to_base,market_value_base
2026-01-01,futu_2189,CASH:USD,USD,US Dollar,cash,100,1,100,USD,1,7,700,fixture,CNY,7,700
`);
  writeFileSync(join(root, "normalized", "performance.csv"), `date,portfolio_id,total_assets,cash,net_external_flow,currency,nav,period_return,benchmark,benchmark_return,source,external_flow_weight
2026-01-01,satellite,100,100,100,USD,1,,NASDAQ-100 Index,,fixture,1
2026-01-02,satellite,101,101,0,USD,1.01,0.01,NASDAQ-100 Index,0.02,fixture,
`);
  writeFileSync(join(root, "validation.json"), JSON.stringify({
    scope: { accounts: ["futu_2189"], portfolio: "satellite" },
    normalized: {
      "transactions.csv": { selected_rows: 1, values: { futu_2189: 1 }, date_min: "2026-01-01", date_max: "2026-01-01" },
      "positions.csv": { selected_rows: 1, values: { futu_2189: 1 }, date_min: "2026-01-01", date_max: "2026-01-01" },
      "performance.csv": { selected_rows: 2, values: { satellite: 2 }, date_min: "2026-01-01", date_max: "2026-01-02" },
    },
  }));
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("normalized satellite baseline", () => {
  it("validates schema, scope, keys, and the linked NAV series", () => {
    const dataset = loadBaselineDataset(fixture());
    expect(dataset.healthy).toBe(true);
    expect(dataset.ledgerReconciled).toBe(false);
    expect(dataset.checks.filter((check) => check.status === "pending")).toHaveLength(2);
    expect(dataset.checks).toContainEqual(expect.objectContaining({ name: "market-data:daily-coverage", status: "passed" }));
    expect(dataset.checks).toContainEqual(expect.objectContaining({ name: "market-data:freshness", status: "pending" }));
    expect(dataset.checks).toContainEqual(expect.objectContaining({ name: "market-data:ohlcv", status: "passed" }));
    expect(dataset.checks).toContainEqual(expect.objectContaining({ name: "performance:asset-return-reconciliation", status: "passed" }));
    expect(dataset.checks).toContainEqual(expect.objectContaining({ name: "ledger:position-quantity-reconciliation", status: "passed" }));
    expect(dataset.checks.some((check) => check.name === "performance:nav-chain" && check.status === "passed")).toBe(true);
    expect(dataset.returnAttribution.residuals.reduce((sum, item) => sum + item.pnlUsd, 0))
      .toBeCloseTo(dataset.returnAttribution.residualPnlUsd, 8);
    expect(dataset.returnAttribution.residuals).toContainEqual(expect.objectContaining({
      reason: "UNEXPLAINED_MODEL_RESIDUAL",
      days: 1,
    }));
  });

  it("rejects a non-boolean external-flow classification", () => {
    const dataset = loadBaselineDataset(fixture("1"));
    expect(dataset.healthy).toBe(false);
    expect(dataset.checks).toContainEqual(expect.objectContaining({ name: "transactions.csv:external-flow-flags", status: "failed" }));
  });

  it("applies explicit non-cash position adjustments without classifying them as trades", () => {
    const transactions = [{
      date: "2026-01-15", account_id: "futu_2189", instrument_id: "US:TSLA",
      action: "adjustment_in", quantity: "0.4", source: "fixture",
    }];
    const positions = [
      { date: "2026-01-01", account_id: "futu_2189", instrument_id: "CASH:USD", category: "cash", quantity: "100" },
      { date: "2026-01-31", account_id: "futu_2189", instrument_id: "US:TSLA", category: "stock", quantity: "0.4" },
    ];
    expect(reconcilePositionQuantities(transactions, positions)).toMatchObject({ comparisons: 1, matched: 1, differences: [] });
  });

  it("requires the fields needed to replay each event type", () => {
    expect(reconcileEventCoverage([{ action: "sell", instrument_id: "US:TSLA", quantity: "1", price: "100", cash_amount: "100" }])).toMatchObject({ total: 1, classified: 1, trades: 1 });
    expect(reconcileEventCoverage([{ action: "sell", instrument_id: "US:TSLA", quantity: "", price: "", cash_amount: "100" }])).toMatchObject({ total: 1, classified: 0 });
  });

  it("reconciles reported local values through their explicit FX rate", () => {
    expect(reconcileReportedValuations([
      { market_value: "100", base_currency: "CNY", fx_to_base: "7.2", market_value_base: "720" },
      { market_value: "50", base_currency: "", fx_to_base: "", market_value_base: "" },
    ])).toMatchObject({ total: 2, withFx: 1, fxReconciled: 1, missingFx: 1, maxBaseValueError: 0 });
  });

  it("uses the latest actual date intersection rather than the minimum of per-series maxima", () => {
    const root = mkdtempSync(join(tmpdir(), "epoch-market-freshness-"));
    temporaryRoots.push(root);
    mkdirSync(join(root, "normalized"), { recursive: true });
    mkdirSync(join(root, "raw", "market-data"), { recursive: true });
    writeFileSync(join(root, "normalized", "market-prices.csv"), `date,instrument_id,close,currency,source,source_symbol,observed_at
2026-07-23,US:GOOGL,200,USD,fixture,GOOGL,2026-07-27T00:00:00Z
2026-07-24,US:GOOGL,201,USD,fixture,GOOGL,2026-07-27T00:00:00Z
2026-07-23,FX:KRWUSD,0.00072,USD,fixture,KRWUSD=X,2026-07-27T00:00:00Z
2026-07-27,FX:KRWUSD,0.00073,USD,fixture,KRWUSD=X,2026-07-27T00:00:00Z
`);
    writeFileSync(join(root, "raw", "market-data", "manifest.json"), JSON.stringify({ observed_at: "2026-07-27T00:00:00Z" }));
    expect(loadMarketDataFreshness(root, {
      dateFrom: "2026-07-17",
      dateTo: "2026-07-17",
      rawInstrumentIds: 1,
      canonicalInstrumentIds: ["US:GOOGL"],
      aliasesCollapsed: 0,
      fxPairs: ["KRWUSD"],
    }, "2026-07-27")).toMatchObject({
      status: "fresh",
      latestEffectiveDate: "2026-07-23",
      expectedThroughDate: "2026-07-24",
      tradingDayLag: 1,
    });
  });
});
