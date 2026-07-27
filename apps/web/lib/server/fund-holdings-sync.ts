import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import {
  discoverHeldFunds,
  selectFundHoldingsSnapshot,
  type EtfHoldingsProvider,
  type FundHoldingsSnapshot,
  type FundPosition,
  type SelectedFundHoldings,
} from "../domain/fund-holdings";

export interface FundHoldingsRepository {
  load(fundInstrumentIds: string[]): Promise<FundHoldingsSnapshot[]>;
  save(snapshot: FundHoldingsSnapshot): Promise<void>;
}

export type FundHoldingsRefreshResult = {
  selections: Map<string, SelectedFundHoldings>;
  refreshedFundInstrumentIds: string[];
  failures: { fundInstrumentId: string; reason: string }[];
};

export async function refreshHeldFundSnapshots(input: {
  positions: FundPosition[];
  asOf: string;
  maximumAgeDays: number;
  provider: EtfHoldingsProvider;
  repository: FundHoldingsRepository;
}): Promise<FundHoldingsRefreshResult> {
  const fundInstrumentIds = discoverHeldFunds(input.positions);
  const existing = await input.repository.load(fundInstrumentIds);
  const selections = new Map<string, SelectedFundHoldings>();
  const refreshedFundInstrumentIds: string[] = [];
  const failures: FundHoldingsRefreshResult["failures"] = [];

  for (const fundInstrumentId of fundInstrumentIds) {
    const available = existing.filter((snapshot) => snapshot.fundInstrumentId === fundInstrumentId);
    let selection = selectFundHoldingsSnapshot(available, input.asOf, input.maximumAgeDays);
    if (selection.status !== "fresh") {
      try {
        const fetched = await input.provider.fetchHoldings(fundInstrumentId, input.asOf);
        await input.repository.save(fetched);
        selection = selectFundHoldingsSnapshot([...available, fetched], input.asOf, input.maximumAgeDays);
        refreshedFundInstrumentIds.push(fundInstrumentId);
      } catch (error) {
        failures.push({
          fundInstrumentId,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
    selections.set(fundInstrumentId, selection);
  }

  return { selections, refreshedFundInstrumentIds, failures };
}

type SnapshotRow = {
  id: string;
  fund_instrument_id: string;
  as_of: string;
  observed_at: string;
  provider: string;
  source_hash: string;
  constituent_instrument_id: string | null;
  name: string | null;
  weight: string | null;
  shares: string | null;
  market_value: string | null;
};

export class PostgresFundHoldingsRepository implements FundHoldingsRepository {
  constructor(private readonly sql: Sql) {}

  async load(fundInstrumentIds: string[]): Promise<FundHoldingsSnapshot[]> {
    if (!fundInstrumentIds.length) return [];
    const rows = await this.sql<SnapshotRow[]>`
      SELECT snapshot.id::text, snapshot.fund_instrument_id, snapshot.as_of::text,
             snapshot.observed_at::text, snapshot.provider, snapshot.source_hash,
             holding.constituent_instrument_id, holding.name, holding.weight::text,
             holding.shares::text, holding.market_value::text
      FROM fund_holdings_snapshot snapshot
      LEFT JOIN fund_holding holding ON holding.snapshot_id = snapshot.id
      WHERE snapshot.fund_instrument_id = ANY(${fundInstrumentIds})
      ORDER BY snapshot.fund_instrument_id, snapshot.as_of DESC, snapshot.observed_at DESC,
               holding.constituent_instrument_id
    `;
    const grouped = new Map<string, FundHoldingsSnapshot>();
    for (const row of rows) {
      const snapshot = grouped.get(row.id) ?? {
        fundInstrumentId: row.fund_instrument_id,
        asOf: row.as_of,
        observedAt: new Date(row.observed_at).toISOString(),
        provider: row.provider,
        sourceHash: row.source_hash,
        holdings: [],
      };
      if (row.constituent_instrument_id && row.name && row.weight) {
        snapshot.holdings.push({
          constituentInstrumentId: row.constituent_instrument_id,
          name: row.name,
          weight: Number(row.weight),
          shares: row.shares == null ? undefined : Number(row.shares),
          marketValue: row.market_value == null ? undefined : Number(row.market_value),
        });
      }
      grouped.set(row.id, snapshot);
    }
    return [...grouped.values()];
  }

  async save(snapshot: FundHoldingsSnapshot): Promise<void> {
    await this.sql.begin(async (transaction) => {
      const id = randomUUID();
      const coveredWeight = snapshot.holdings.reduce((sum, holding) => sum + holding.weight, 0);
      const inserted = await transaction<{ id: string }[]>`
        INSERT INTO fund_holdings_snapshot (
          id, fund_instrument_id, as_of, observed_at, provider, source_hash, holding_count, covered_weight
        ) VALUES (
          ${id}, ${snapshot.fundInstrumentId}, ${snapshot.asOf}, ${snapshot.observedAt},
          ${snapshot.provider}, ${snapshot.sourceHash}, ${snapshot.holdings.length}, ${coveredWeight}
        )
        ON CONFLICT (fund_instrument_id, as_of, provider, source_hash) DO NOTHING
        RETURNING id::text
      `;
      if (!inserted.length) return;
      for (const holding of snapshot.holdings) {
        await transaction`
          INSERT INTO fund_holding (
            snapshot_id, constituent_instrument_id, name, weight, shares, market_value
          ) VALUES (
            ${id}, ${holding.constituentInstrumentId}, ${holding.name}, ${holding.weight},
            ${holding.shares ?? null}, ${holding.marketValue ?? null}
          )
        `;
      }
    });
  }
}
