import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadBaselineDataset } from "./baseline-data";

const temporaryRoots: string[] = [];

function fixture(externalFlow = "true"): string {
  const root = mkdtempSync(join(tmpdir(), "epoch-baseline-"));
  temporaryRoots.push(root);
  mkdirSync(join(root, "normalized"));
  writeFileSync(join(root, "normalized", "transactions.csv"), `transaction_id,date,account_id,instrument_id,action,quantity,price,currency,fees,tax,cash_amount,external_flow,source,note
t1,2026-01-01,futu_2189,,deposit,,,USD,0,0,100,${externalFlow},fixture,
`);
  writeFileSync(join(root, "normalized", "positions.csv"), `date,account_id,instrument_id,ticker,name,category,quantity,price,market_value,currency,cost_basis,fx_to_cny,market_value_cny,source
2026-01-01,futu_2189,CASH:USD,USD,US Dollar,cash,100,1,100,USD,1,7,700,fixture
`);
  writeFileSync(join(root, "normalized", "performance.csv"), `date,portfolio_id,total_assets,cash,net_external_flow,currency,nav,period_return,benchmark,benchmark_return,source
2026-01-01,satellite,100,100,100,USD,1,,NASDAQ-100 Index,,fixture
2026-01-02,satellite,101,101,0,USD,1.01,0.01,NASDAQ-100 Index,0.02,fixture
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
    expect(dataset.checks).toContainEqual(expect.objectContaining({ name: "ledger:position-quantity-reconciliation", status: "passed" }));
    expect(dataset.checks.some((check) => check.name === "performance:nav-chain" && check.status === "passed")).toBe(true);
  });

  it("rejects a non-boolean external-flow classification", () => {
    const dataset = loadBaselineDataset(fixture("1"));
    expect(dataset.healthy).toBe(false);
    expect(dataset.checks).toContainEqual(expect.objectContaining({ name: "transactions.csv:external-flow-flags", status: "failed" }));
  });
});
