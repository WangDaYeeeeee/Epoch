import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { calculateDailyLedger } from "./ledger";
import { calculateDemoLedger } from "../server/demo-ledger";

describe("deterministic Phase 0 ledger", () => {
  it("reproduces daily positions, NAV and benchmark from fixed demo inputs", () => {
    const root = resolve(process.cwd(), "../../data/demo");
    const first = calculateDemoLedger(root);
    const second = calculateDemoLedger(root);
    expect(second).toEqual(first);
    expect(first.inputHash).toHaveLength(64);
    expect(first.snapshots).toHaveLength(10);
    expect(first.snapshots.at(-1)).toMatchObject({
      navCents: 10_689_600,
      cashCents: 1_199_600,
      marketValueCents: 9_490_000,
      benchmarkIndex: 1.04,
    });
    expect(first.health).toEqual({ balanced: true, maxAbsoluteDifferenceCents: 0 });
  });

  it("rejects duplicate facts instead of silently duplicating the ledger", () => {
    expect(() => calculateDailyLedger({
      benchmark: "INDEX:.NDX",
      trades: [
        { externalId: "duplicate", date: "2026-07-06", instrumentId: "XNAS:NVDA", quantity: 1, priceCents: 100, feeCents: 0, currency: "USD" },
        { externalId: "duplicate", date: "2026-07-06", instrumentId: "XNAS:NVDA", quantity: 1, priceCents: 100, feeCents: 0, currency: "USD" },
      ],
      flows: [],
      prices: [{ date: "2026-07-06", instrumentId: "INDEX:.NDX", closeCents: 100, currency: "USD" }],
    })).toThrow("Duplicate trade external id");
  });
});
