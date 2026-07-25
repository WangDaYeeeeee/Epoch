import { readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

type Manifest = {
  observed_at?: string;
  date_from: string;
  date_to_exclusive: string;
  instruments: Array<{ instrument_id: string; symbol: string }>;
};

type ChartResult = {
  meta: { currency: string };
  timestamp?: number[];
  indicators: {
    quote: Array<{
      open: Array<number | null>;
      high: Array<number | null>;
      low: Array<number | null>;
      close: Array<number | null>;
      volume: Array<number | null>;
    }>;
  };
  events?: { splits?: Record<string, { date: number; numerator: number; denominator: number; splitRatio: string }> };
};

const csvCell = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const isoDate = (timestamp: number) => new Date(timestamp * 1000).toISOString().slice(0, 10);

async function main(): Promise<void> {
  const root = resolve(process.env.EPOCH_DATA_ROOT ?? resolve(process.cwd(), "../../tmp/satellite-data"));
  const rawRoot = resolve(root, "raw/market-data");
  const normalizedRoot = resolve(root, "normalized");
  const manifestPath = resolve(rawRoot, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
  const observedAt = manifest.observed_at ?? (await stat(manifestPath)).mtime.toISOString();
  const prices: string[][] = [];
  const bars: string[][] = [];
  const splits: string[][] = [];

  for (const item of manifest.instruments.filter((instrument) => !instrument.instrument_id.startsWith("FUND:"))) {
    const rawName = `${item.symbol.replaceAll("=", "_")}.json`;
    const payload = JSON.parse(await readFile(resolve(rawRoot, rawName), "utf8")) as { chart: { result?: ChartResult[] } };
    const result = payload.chart.result?.[0];
    if (!result) throw new Error(`${item.symbol}: missing chart result in ${rawName}`);
    const timestamps = result.timestamp ?? [];
    const quote = result.indicators.quote[0];
    for (let index = 0; index < timestamps.length; index += 1) {
      const close = quote?.close[index];
      if (close == null) continue;
      const date = isoDate(timestamps[index]);
      if (date < manifest.date_from || date >= manifest.date_to_exclusive) continue;
      prices.push([date, item.instrument_id, String(close), result.meta.currency, "yahoo_chart_v8", item.symbol, observedAt]);
      const open = quote.open[index], high = quote.high[index], low = quote.low[index];
      if (open == null || high == null || low == null) continue;
      bars.push([
        date, item.instrument_id, String(open), String(high), String(low), String(close),
        quote.volume[index] == null ? "" : String(quote.volume[index]),
        result.meta.currency, "yahoo_chart_v8", item.symbol, observedAt,
      ]);
    }
    for (const event of Object.values(result.events?.splits ?? {})) {
      const date = isoDate(event.date);
      if (date >= manifest.date_from && date < manifest.date_to_exclusive) {
        splits.push([date, item.instrument_id, String(event.numerator), String(event.denominator), event.splitRatio, "yahoo_chart_v8", item.symbol]);
      }
    }
  }

  const chinaAmcBody = await readFile(resolve(rawRoot, "HKSELMMF.json"), "utf8");
  const chinaAmcPayload = JSON.parse(chinaAmcBody) as { result?: Array<{ ssShareClassId: string; currencyEn: string; navHistoryList?: Array<{ date: string; nav: number }> }> };
  const fHkd = chinaAmcPayload.result?.find((shareClass) => shareClass.ssShareClassId === "F-HKD");
  if (!fHkd) throw new Error("HKSELMMF: missing F-HKD share class");
  for (const row of fHkd.navHistoryList ?? []) {
    const date = `${row.date.slice(0, 4)}-${row.date.slice(4, 6)}-${row.date.slice(6, 8)}`;
    if (date < manifest.date_from || date >= manifest.date_to_exclusive) continue;
    prices.push([date, "FUND:HK0000502390", String(row.nav), fHkd.currencyEn, "chinaamc_full_nav_history", "HKSELMMF/F-HKD", observedAt]);
    bars.push([date, "FUND:HK0000502390", String(row.nav), String(row.nav), String(row.nav), String(row.nav), "", fHkd.currencyEn, "chinaamc_full_nav_history", "HKSELMMF/F-HKD", observedAt]);
  }

  const gaoTengBody = await readFile(resolve(rawRoot, "GTWVCUS.json"), "utf8");
  const gaoTengPayload = JSON.parse(gaoTengBody) as { data?: { navList?: Array<{ date: string; fundNav: string }> } };
  for (const row of gaoTengPayload.data?.navList ?? []) {
    if (row.date < manifest.date_from || row.date >= manifest.date_to_exclusive) continue;
    prices.push([row.date, "FUND:HK0000584752", row.fundNav, "USD", "gaoteng_fund_nav", "GTWVCUS/10018002", observedAt]);
    bars.push([row.date, "FUND:HK0000584752", row.fundNav, row.fundNav, row.fundNav, row.fundNav, "", "USD", "gaoteng_fund_nav", "GTWVCUS/10018002", observedAt]);
  }

  const writeCsv = async (name: string, header: string[], rows: string[][]) => {
    const content = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
    await writeFile(resolve(normalizedRoot, name), content, "utf8");
  };
  const order = (left: string[], right: string[]) => left[0].localeCompare(right[0]) || left[1].localeCompare(right[1]);
  await writeCsv("market-prices.csv", ["date", "instrument_id", "close", "currency", "source", "source_symbol", "observed_at"], prices.sort(order));
  await writeCsv("market-bars.csv", ["date", "instrument_id", "open", "high", "low", "close", "volume", "currency", "source", "source_symbol", "observed_at"], bars.sort(order));
  await writeCsv("market-splits.csv", ["date", "instrument_id", "numerator", "denominator", "ratio", "source", "source_symbol"], splits.sort(order));
  console.log(JSON.stringify({ mode: "offline", prices: prices.length, bars: bars.length, splits: splits.length, observedAt, root }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
