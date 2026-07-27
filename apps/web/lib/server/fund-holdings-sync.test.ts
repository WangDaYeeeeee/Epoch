import { describe, expect, it } from "vitest";
import type { EtfHoldingsProvider, FundHoldingsSnapshot } from "../domain/fund-holdings";
import { refreshHeldFundSnapshots, type FundHoldingsRepository } from "./fund-holdings-sync";

class MemoryRepository implements FundHoldingsRepository {
  constructor(readonly snapshots: FundHoldingsSnapshot[] = []) {}
  async load(fundInstrumentIds: string[]) {
    return this.snapshots.filter((snapshot) => fundInstrumentIds.includes(snapshot.fundInstrumentId));
  }
  async save(snapshot: FundHoldingsSnapshot) {
    this.snapshots.push(snapshot);
  }
}

const snapshot = (asOf: string): FundHoldingsSnapshot => ({
  fundInstrumentId: "US:SOXX",
  asOf,
  observedAt: `${asOf}T22:00:00Z`,
  provider: "fixture",
  sourceHash: `hash-${asOf}`,
  holdings: [{ constituentInstrumentId: "US:NVDA", name: "NVIDIA", weight: 0.1 }],
});

describe("fund holdings refresh", () => {
  it("does not call the provider when a fresh snapshot exists", async () => {
    const repository = new MemoryRepository([snapshot("2026-07-10")]);
    const provider: EtfHoldingsProvider = {
      id: "fixture",
      fetchHoldings: async () => { throw new Error("should not fetch"); },
    };
    const result = await refreshHeldFundSnapshots({
      positions: [{ instrumentId: "XNAS:SOXX", assetClass: "broad_index_fund", quantity: 30 }],
      asOf: "2026-07-17",
      maximumAgeDays: 30,
      provider,
      repository,
    });
    expect(result.refreshedFundInstrumentIds).toEqual([]);
    expect(result.selections.get("US:SOXX")?.status).toBe("fresh");
  });

  it("refreshes a missing ETF discovered from the latest positions", async () => {
    const repository = new MemoryRepository();
    const provider: EtfHoldingsProvider = {
      id: "fixture",
      fetchHoldings: async () => snapshot("2026-07-17"),
    };
    const result = await refreshHeldFundSnapshots({
      positions: [{ instrumentId: "XNAS:SOXX", assetClass: "broad_index_fund", quantity: 30 }],
      asOf: "2026-07-17",
      maximumAgeDays: 30,
      provider,
      repository,
    });
    expect(result.refreshedFundInstrumentIds).toEqual(["US:SOXX"]);
    expect(repository.snapshots).toHaveLength(1);
    expect(result.selections.get("US:SOXX")?.status).toBe("fresh");
  });

  it("retains a stale snapshot and records the provider failure", async () => {
    const repository = new MemoryRepository([snapshot("2026-01-01")]);
    const provider: EtfHoldingsProvider = {
      id: "fixture",
      fetchHoldings: async () => { throw new Error("provider unavailable"); },
    };
    const result = await refreshHeldFundSnapshots({
      positions: [{ instrumentId: "US:SOXX", assetClass: "broad_index_fund", quantity: 30 }],
      asOf: "2026-07-17",
      maximumAgeDays: 30,
      provider,
      repository,
    });
    expect(result.selections.get("US:SOXX")?.status).toBe("stale");
    expect(result.failures).toEqual([{ fundInstrumentId: "US:SOXX", reason: "provider unavailable" }]);
  });
});
