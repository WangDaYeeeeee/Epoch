import { resolve } from "node:path";
import { FmpEtfHoldingsProvider } from "../lib/connectors/fmp-etf-holdings";
import { LocalCsvEtfHoldingsProvider } from "../lib/connectors/local-etf-holdings";
import { SecNportEtfHoldingsProvider } from "../lib/connectors/sec-nport-holdings";
import { ChainedEtfHoldingsProvider, type EtfHoldingsProvider } from "../lib/domain/fund-holdings";
import { createDatabaseClient, migrateDatabase } from "../lib/server/database";
import { PostgresFundHoldingsRepository, refreshHeldFundSnapshots } from "../lib/server/fund-holdings-sync";

type PositionRow = {
  date: string;
  instrument_id: string;
  category: string;
  quantity: string;
};

async function main(): Promise<void> {
  const providerNames = (process.env.ETF_HOLDINGS_PROVIDER ?? "local_csv").split(",").map((name) => name.trim()).filter(Boolean);
  const providers: EtfHoldingsProvider[] = providerNames.map((providerName) => {
    if (providerName === "local_csv") {
      return new LocalCsvEtfHoldingsProvider(resolve(
        process.env.ETF_HOLDINGS_INPUT_DIR ?? "data/raw/etf-holdings",
      ));
    }
    if (providerName === "sec_nport") {
      return new SecNportEtfHoldingsProvider(process.env.SEC_USER_AGENT ?? "");
    }
    if (providerName === "fmp") {
      const apiKey = process.env.FMP_API_KEY;
      if (!apiKey) throw new Error("FMP_API_KEY is required when ETF_HOLDINGS_PROVIDER includes fmp");
      return new FmpEtfHoldingsProvider(apiKey);
    }
    throw new Error(`Unsupported ETF holdings provider: ${providerName}`);
  });
  const provider = providers.length === 1 ? providers[0] : new ChainedEtfHoldingsProvider(providers);
  const sql = createDatabaseClient();
  try {
    await migrateDatabase(sql);
    const rows = await sql<PositionRow[]>`
      SELECT snapshot_date::text AS date, instrument_id, category, quantity::text
      FROM reported_position_snapshot
      WHERE snapshot_date = (SELECT max(snapshot_date) FROM reported_position_snapshot)
      ORDER BY instrument_id
    `;
    if (!rows.length) throw new Error("No reported positions are available; import the baseline or Flex data first");
    const asOf = rows[0].date;
    const result = await refreshHeldFundSnapshots({
      positions: rows.map((row) => ({
        instrumentId: row.instrument_id,
        assetClass: row.category,
        quantity: Number(row.quantity),
      })),
      asOf,
      maximumAgeDays: Number(process.env.ETF_HOLDINGS_MAX_AGE_DAYS ?? 90),
      provider,
      repository: new PostgresFundHoldingsRepository(sql),
    });
    console.log(JSON.stringify({
      asOf,
      provider: provider.id,
      funds: [...result.selections.entries()].map(([fundInstrumentId, selection]) => ({
        fundInstrumentId,
        status: selection.status,
        snapshotAsOf: selection.snapshot?.asOf ?? null,
        ageDays: selection.ageDays,
      })),
      refreshedFundInstrumentIds: result.refreshedFundInstrumentIds,
      failures: result.failures,
    }, null, 2));
    if (result.failures.length) process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
