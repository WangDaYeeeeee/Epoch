import { AlpacaIntradayProvider } from "../lib/connectors/alpaca-intraday";
import { createDatabaseClient, migrateDatabase } from "../lib/server/database";
import { PostgresDataSourceHealthRepository } from "../lib/server/data-source-health";
import { PostgresMarketSignalRepository } from "../lib/server/market-signal";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main(): Promise<void> {
  const symbols = required("ALPACA_INTRADAY_SYMBOLS").split(",").map((value) => value.trim().toUpperCase()).filter(Boolean);
  const start = required("ALPACA_INTRADAY_START");
  const end = required("ALPACA_INTRADAY_END");
  const provider = new AlpacaIntradayProvider(required("ALPACA_API_KEY_ID"), required("ALPACA_API_SECRET_KEY"));
  const sql = createDatabaseClient();
  try {
    await migrateDatabase(sql);
    const health = new PostgresDataSourceHealthRepository(sql);
    try {
      const bars = await provider.fetchBars({ symbols, start, end });
      if (!bars.length) throw new Error("Alpaca returned no minute bars");
      const signals = new PostgresMarketSignalRepository(sql);
      const inserted = await signals.ingestIntradayBars(bars);
      const semivarianceDays = await signals.refreshDailySemivariance(provider.id);
      await health.activate({
        sourceId: "intraday-returns",
        provider: provider.id,
        maximumAgeHours: 120,
        note: "Non-production IEX minute-bar validation; not consolidated US market coverage",
      });
      await health.observe({
        sourceId: "intraday-returns",
        status: "degraded",
        effectiveAt: bars.map((bar) => bar.timestamp).sort().at(-1),
        detail: `${bars.length} IEX minute bars fetched; ${inserted} new observations. IEX is not consolidated coverage.`,
      });
      console.log(JSON.stringify({ fetched: bars.length, inserted, semivarianceDays, provider: provider.id }, null, 2));
    } catch (error) {
      await health.observe({
        sourceId: "intraday-returns",
        status: "failure",
        detail: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
