import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseCsv } from "../lib/server/csv";
import { configuredDataRoot } from "../lib/server/data-root";
import { marketRefreshPreflight, validateIncrementalMarketRefresh } from "../lib/server/market-refresh";

type ChartResult = {
  meta: { currency: string; symbol: string };
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
  const observedAt = new Date().toISOString();
  const runId = observedAt.replaceAll(/[:.]/g, "-");
  const root = configuredDataRoot();
  const rawRoot = resolve(root, "raw/market-data");
  const runRoot = resolve(rawRoot, "runs", runId);
  const normalizedRoot = resolve(root, "normalized");
  const preflight = process.env.MARKET_REFRESH_PREFLIGHT_JSON
    ? JSON.parse(process.env.MARKET_REFRESH_PREFLIGHT_JSON) as ReturnType<typeof marketRefreshPreflight>
    : marketRefreshPreflight(new Date(observedAt));
  await mkdir(runRoot, { recursive: true });
  await mkdir(normalizedRoot, { recursive: true });

  const period1 = Math.floor(Date.parse(`${preflight.dateFrom}T00:00:00Z`) / 1000);
  const period2 = Math.floor(Date.parse(`${preflight.dateToExclusive}T00:00:00Z`) / 1000);
  const prices: string[][] = [];
  const bars: string[][] = [];
  const splits: string[][] = [];
  const manifest: Array<Record<string, unknown>> = [];

  for (const target of preflight.targets) {
    const { instrumentId, providerSymbol: symbol } = target;
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d&events=div%2Csplits`;
    const response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
    if (!response.ok) throw new Error(`${symbol}: HTTP ${response.status}`);
    const body = await response.text();
    const filename = `${symbol.replaceAll("=", "_")}.json`;
    await writeFile(resolve(runRoot, filename), `${body}\n`, "utf8");
    await writeFile(resolve(rawRoot, filename), `${body}\n`, "utf8");
    const payload = JSON.parse(body) as { chart: { result?: ChartResult[]; error?: { description?: string } } };
    const result = payload.chart.result?.[0];
    if (!result) throw new Error(`${symbol}: ${payload.chart.error?.description ?? "missing chart result"}`);
    const timestamps = result.timestamp ?? [];
    const quote = result.indicators.quote[0];
    const closes = quote?.close ?? [];
    for (let index = 0; index < timestamps.length; index += 1) {
      if (closes[index] == null) continue;
      const date = isoDate(timestamps[index]);
      if (date < preflight.dateFrom || date >= preflight.dateToExclusive) continue;
      prices.push([date, instrumentId, String(closes[index]), result.meta.currency, "yahoo_chart_v8", symbol, observedAt]);
      if (quote.open[index] != null && quote.high[index] != null && quote.low[index] != null) {
        bars.push([
          date, instrumentId, String(quote.open[index]), String(quote.high[index]), String(quote.low[index]),
          String(closes[index]), quote.volume[index] == null ? "" : String(quote.volume[index]),
          result.meta.currency, "yahoo_chart_v8", symbol, observedAt,
        ]);
      }
    }
    for (const event of Object.values(result.events?.splits ?? {})) {
      const date = isoDate(event.date);
      if (date < preflight.dateFrom || date >= preflight.dateToExclusive) continue;
      splits.push([date, instrumentId, String(event.numerator), String(event.denominator), event.splitRatio, "yahoo_chart_v8", symbol]);
    }
    manifest.push({
      instrument_id: instrumentId,
      symbol,
      currency: result.meta.currency,
      observations: timestamps.length,
      bars: bars.filter((row) => row[1] === instrumentId).length,
      latest_effective_date: timestamps.length ? isoDate(timestamps.at(-1)!) : null,
      sha256: createHash("sha256").update(body).digest("hex"),
    });
    await new Promise((done) => setTimeout(done, 250));
  }

  const validation = validateIncrementalMarketRefresh({
    targetInstrumentIds: preflight.targets.map((target) => target.instrumentId),
    prices,
    bars,
    splits,
    dateFrom: preflight.dateFrom,
    dateToExclusive: preflight.dateToExclusive,
  });
  const targetIds = new Set(preflight.targets.map((target) => target.instrumentId));
  const prepareCsv = (name: string, header: string[], fresh: string[][]) => {
    const path = resolve(normalizedRoot, name);
    const existing = existsSync(path) ? parseCsv(readFileSync(path, "utf8")) : [];
    const retained = existing
      .filter((row) => !(targetIds.has(row.instrument_id) && row.date >= preflight.dateFrom))
      .map((row) => header.map((column) => row[column] ?? ""));
    const rows = [...retained, ...fresh].sort((left, right) => (
      left[0].localeCompare(right[0]) || left[1].localeCompare(right[1])
    ));
    const content = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
    return { path, temporaryPath: `${path}.${runId}.tmp`, content, total: rows.length };
  };

  const prepared = [
    prepareCsv("market-prices.csv", ["date", "instrument_id", "close", "currency", "source", "source_symbol", "observed_at"], prices),
    prepareCsv("market-bars.csv", ["date", "instrument_id", "open", "high", "low", "close", "volume", "currency", "source", "source_symbol", "observed_at"], bars),
    prepareCsv("market-splits.csv", ["date", "instrument_id", "numerator", "denominator", "ratio", "source", "source_symbol"], splits),
  ];
  await Promise.all(prepared.map((item) => writeFile(item.temporaryPath, item.content, "utf8")));
  for (const item of prepared) await rename(item.temporaryPath, item.path);
  const totals = {
    prices: prepared[0].total,
    bars: prepared[1].total,
    splits: prepared[2].total,
  };
  const manifestDocument = {
    observed_at: observedAt,
    run_id: runId,
    mode: "current-position-incremental",
    date_from: preflight.dateFrom,
    date_to_exclusive: preflight.dateToExclusive,
    fingerprint: preflight.fingerprint,
    validation,
    instruments: manifest,
  };
  const manifestText = JSON.stringify(manifestDocument, null, 2) + "\n";
  await writeFile(resolve(runRoot, "manifest.json"), manifestText, "utf8");
  await writeFile(resolve(rawRoot, "manifest.json"), manifestText, "utf8");
  console.log(JSON.stringify({
    mode: manifestDocument.mode,
    instruments: preflight.targets.length,
    fetched: { prices: prices.length, bars: bars.length, splits: splits.length },
    validation,
    totals,
    observedAt,
    runId,
    root,
  }));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
