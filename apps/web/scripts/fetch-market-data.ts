import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const DATE_FROM = "2025-01-20";
const DATE_TO_EXCLUSIVE = "2026-07-19";
const SYMBOLS: Record<string, string> = {
  "US:AMD": "AMD", "US:AVGO": "AVGO", "US:BABA": "BABA", "US:DRAM": "DRAM",
  "US:FNGU": "FNGU", "US:GLD": "GLD", "US:GLL": "GLL", "US:GOOGL": "GOOGL",
  "US:HOOD": "HOOD", "US:JEPI": "JEPI", "US:KLAC": "KLAC", "US:MSFT": "MSFT",
  "US:NASA": "NASA", "US:NVDA": "NVDA", "US:PSQ": "PSQ", "US:QQQ": "QQQ",
  "US:SMH": "SMH", "US:SOXX": "SOXX", "US:SPMO": "SPMO", "US:SQQQ": "SQQQ",
  "US:TCOM": "TCOM", "US:TQQQ": "TQQQ", "US:TSLA": "TSLA", "US:TSM": "TSM",
  "US:UVIX": "UVIX", "XHKG:02259": "2259.HK", "XHKG:09992": "9992.HK",
  "XKRX:000660": "000660.KS", "FX:HKDUSD": "HKDUSD=X", "FX:KRWUSD": "KRWUSD=X",
};

type ChartResult = {
  meta: { currency: string; symbol: string };
  timestamp?: number[];
  indicators: { quote: Array<{ close: Array<number | null> }> };
  events?: { splits?: Record<string, { date: number; numerator: number; denominator: number; splitRatio: string }> };
};

const csvCell = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const isoDate = (timestamp: number) => new Date(timestamp * 1000).toISOString().slice(0, 10);

async function main(): Promise<void> {
  const root = resolve(process.env.EPOCH_DATA_ROOT ?? resolve(process.cwd(), "../../tmp/satellite-data"));
  const rawRoot = resolve(root, "raw/market-data");
  const normalizedRoot = resolve(root, "normalized");
  await mkdir(rawRoot, { recursive: true });
  await mkdir(normalizedRoot, { recursive: true });
  const period1 = Math.floor(Date.parse(`${DATE_FROM}T00:00:00Z`) / 1000);
  const period2 = Math.floor(Date.parse(`${DATE_TO_EXCLUSIVE}T00:00:00Z`) / 1000);
  const prices: string[][] = [];
  const splits: string[][] = [];
  const manifest: Array<Record<string, unknown>> = [];

  for (const [instrumentId, symbol] of Object.entries(SYMBOLS)) {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d&events=div%2Csplits`;
    const response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
    if (!response.ok) throw new Error(`${symbol}: HTTP ${response.status}`);
    const body = await response.text();
    const rawPath = resolve(rawRoot, `${symbol.replaceAll("=", "_")}.json`);
    await writeFile(rawPath, `${body}\n`, "utf8");
    const payload = JSON.parse(body) as { chart: { result?: ChartResult[]; error?: { description?: string } } };
    const result = payload.chart.result?.[0];
    if (!result) throw new Error(`${symbol}: ${payload.chart.error?.description ?? "missing chart result"}`);
    const timestamps = result.timestamp ?? [];
    const closes = result.indicators.quote[0]?.close ?? [];
    for (let index = 0; index < timestamps.length; index += 1) {
      if (closes[index] == null) continue;
      prices.push([isoDate(timestamps[index]), instrumentId, String(closes[index]), result.meta.currency, "yahoo_chart_v8", symbol]);
    }
    for (const event of Object.values(result.events?.splits ?? {})) {
      splits.push([isoDate(event.date), instrumentId, String(event.numerator), String(event.denominator), event.splitRatio, "yahoo_chart_v8", symbol]);
    }
    manifest.push({ instrument_id: instrumentId, symbol, currency: result.meta.currency, observations: timestamps.length, sha256: createHash("sha256").update(body).digest("hex") });
    await new Promise((done) => setTimeout(done, 250));
  }

  const chinaAmcUrl = "https://www.chinaamc.com.hk/jeecg-boot/mainFundShareClass/tMainFundShareClass/fullNavHistory?fundId=HKSELMMF";
  const chinaAmcResponse = await fetch(chinaAmcUrl, { headers: { "user-agent": "Mozilla/5.0" } });
  if (!chinaAmcResponse.ok) throw new Error(`HKSELMMF: HTTP ${chinaAmcResponse.status}`);
  const chinaAmcBody = await chinaAmcResponse.text();
  await writeFile(resolve(rawRoot, "HKSELMMF.json"), `${chinaAmcBody}\n`, "utf8");
  const chinaAmcPayload = JSON.parse(chinaAmcBody) as { result?: Array<{ ssShareClassId: string; currencyEn: string; navHistoryList?: Array<{ date: string; nav: number }> }> };
  const fHkd = chinaAmcPayload.result?.find((shareClass) => shareClass.ssShareClassId === "F-HKD");
  if (!fHkd) throw new Error("HKSELMMF: missing F-HKD share class");
  const fundRows = (fHkd.navHistoryList ?? []).filter((row) => {
    const date = `${row.date.slice(0, 4)}-${row.date.slice(4, 6)}-${row.date.slice(6, 8)}`;
    return date >= DATE_FROM && date < DATE_TO_EXCLUSIVE;
  });
  for (const row of fundRows) {
    const date = `${row.date.slice(0, 4)}-${row.date.slice(4, 6)}-${row.date.slice(6, 8)}`;
    prices.push([date, "FUND:HK0000502390", String(row.nav), fHkd.currencyEn, "chinaamc_full_nav_history", "HKSELMMF/F-HKD"]);
  }
  manifest.push({
    instrument_id: "FUND:HK0000502390", symbol: "HKSELMMF/F-HKD", currency: fHkd.currencyEn,
    observations: fundRows.length, sha256: createHash("sha256").update(chinaAmcBody).digest("hex"),
  });

  const gaoTengUrl = "https://api.gaotengasset.com/gt/website/fundNav?fundClassId=10018002";
  const gaoTengResponse = await fetch(gaoTengUrl, { headers: { "user-agent": "Mozilla/5.0" } });
  if (!gaoTengResponse.ok) throw new Error(`GTWVCUS: HTTP ${gaoTengResponse.status}`);
  const gaoTengBody = await gaoTengResponse.text();
  await writeFile(resolve(rawRoot, "GTWVCUS.json"), `${gaoTengBody}\n`, "utf8");
  const gaoTengPayload = JSON.parse(gaoTengBody) as { data?: { navList?: Array<{ date: string; fundNav: string }> } };
  const gaoTengRows = (gaoTengPayload.data?.navList ?? []).filter((row) => row.date >= DATE_FROM && row.date < DATE_TO_EXCLUSIVE);
  for (const row of gaoTengRows) {
    prices.push([row.date, "FUND:HK0000584752", row.fundNav, "USD", "gaoteng_fund_nav", "GTWVCUS/10018002"]);
  }
  manifest.push({
    instrument_id: "FUND:HK0000584752", symbol: "GTWVCUS/10018002", currency: "USD",
    observations: gaoTengRows.length, sha256: createHash("sha256").update(gaoTengBody).digest("hex"),
  });

  const writeCsv = async (name: string, header: string[], rows: string[][]) => {
    const content = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
    await writeFile(resolve(normalizedRoot, name), content, "utf8");
  };
  await writeCsv("market-prices.csv", ["date", "instrument_id", "close", "currency", "source", "source_symbol"], prices.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1])));
  await writeCsv("market-splits.csv", ["date", "instrument_id", "numerator", "denominator", "ratio", "source", "source_symbol"], splits.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1])));
  await writeFile(resolve(rawRoot, "manifest.json"), JSON.stringify({ date_from: DATE_FROM, date_to_exclusive: DATE_TO_EXCLUSIVE, instruments: manifest }, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({ instruments: Object.keys(SYMBOLS).length + 2, prices: prices.length, splits: splits.length, root }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
