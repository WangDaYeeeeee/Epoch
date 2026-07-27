import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd(), "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("versioned owner configuration", () => {
  it("pins the account boundary, benchmark, currency and read-only capability", () => {
    const strategy = JSON.parse(read("frameworks/strategies/epoch-satellite-v0.1.0.json"));
    expect(strategy.account_scope).toEqual(["futu_2189", "ibkr_8602"]);
    expect(strategy.benchmark).toBe(".NDX");
    expect([strategy.base_currency, strategy.reporting_currency, strategy.risk_currency]).toEqual(["USD", "USD", "USD"]);
    expect(strategy.trading_capability).toBe("read_only");
  });

  it("keeps draft parameters explicitly marked for calibration and hash-pinned", () => {
    const policyContent = read("frameworks/policies/default-draft-v0.1.0.json");
    const strategyContent = read("frameworks/strategies/epoch-satellite-v0.1.0.json");
    const policy = JSON.parse(policyContent);
    const initialMigration = read("migrations/0002_seed_phase0.sql");
    const policyMigration = read("migrations/0008_update_strategy_v05_parameters.sql");
    expect(policy.status).toBe("draft");
    expect(policy.calibration_required).toBe(true);
    expect(policyMigration).toContain(createHash("sha256").update(policyContent).digest("hex"));
    expect(initialMigration).toContain(createHash("sha256").update(strategyContent).digest("hex"));
  });
});
