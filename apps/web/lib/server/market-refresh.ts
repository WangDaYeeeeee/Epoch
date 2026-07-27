import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { currentPositionMarketDataRequirement } from "../domain/market-data";
import { parseCsv } from "./csv";
import { resolveDataRoot } from "./portfolio";
import { resolveWorkspaceRoot } from "./risk-code-version";

export const MARKET_SYMBOLS: Record<string, string> = {
  "US:AMD": "AMD", "US:AVGO": "AVGO", "US:BABA": "BABA", "US:DRAM": "DRAM",
  "US:FNGU": "FNGU", "US:GLD": "GLD", "US:GLL": "GLL", "US:GOOGL": "GOOGL",
  "US:HOOD": "HOOD", "US:JEPI": "JEPI", "US:KLAC": "KLAC", "US:MSFT": "MSFT",
  "US:NASA": "NASA", "US:NVDA": "NVDA", "US:PSQ": "PSQ", "US:QQQ": "QQQ",
  "US:SMH": "SMH", "US:SOXX": "SOXX", "US:SPMO": "SPMO", "US:SQQQ": "SQQQ",
  "US:TCOM": "TCOM", "US:TQQQ": "TQQQ", "US:TSLA": "TSLA", "US:TSM": "TSM",
  "US:UVIX": "UVIX", "XHKG:02259": "2259.HK", "XHKG:09992": "9992.HK",
  "XKRX:000660": "000660.KS", "FX:HKDUSD": "HKDUSD=X", "FX:KRWUSD": "KRWUSD=X",
};

export type MarketRefreshPreflight = {
  fingerprint: string;
  dateFrom: string;
  dateToExclusive: string;
  targets: { instrumentId: string; provider: string; providerSymbol: string }[];
  disclosures: string[];
};

export function buildMarketRefreshPreflight(input: {
  now: Date;
  instrumentIds: string[];
  latestDates?: Record<string, string>;
}): MarketRefreshPreflight {
  const unsupported = input.instrumentIds.filter((instrumentId) => !MARKET_SYMBOLS[instrumentId]);
  if (unsupported.length) throw new Error(`No market-data source mapping for: ${unsupported.join(", ")}`);
  if (!input.instrumentIds.length) throw new Error("No current market-data targets are available");
  const latestDates = input.instrumentIds.map((instrumentId) => input.latestDates?.[instrumentId]).filter(Boolean) as string[];
  const commonLatest = latestDates.length === input.instrumentIds.length ? latestDates.sort()[0] : null;
  const overlapStart = commonLatest ? new Date(`${commonLatest}T00:00:00Z`) : null;
  if (overlapStart) overlapStart.setUTCDate(overlapStart.getUTCDate() - 7);
  const dateFrom = process.env.MARKET_DATE_FROM
    ?? overlapStart?.toISOString().slice(0, 10)
    ?? "2025-01-20";
  const tomorrow = new Date(input.now);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const dateToExclusive = process.env.MARKET_DATE_TO_EXCLUSIVE ?? tomorrow.toISOString().slice(0, 10);
  const targets = [...input.instrumentIds].sort().map((instrumentId) => ({
      instrumentId,
      provider: "Yahoo Finance chart v8",
      providerSymbol: MARKET_SYMBOLS[instrumentId],
    }));
  const identity = JSON.stringify({ dateFrom, dateToExclusive, targets });
  return {
    fingerprint: createHash("sha256").update(identity).digest("hex"),
    dateFrom,
    dateToExclusive,
    targets,
    disclosures: [
      "The listed provider symbols and requested date range will be sent to public market-data endpoints.",
      "Only current-position securities and required FX pairs are requested; existing unrelated history is retained.",
      "Raw responses are retained by refresh run and normalized CSV files are merged by date and instrument.",
      "No broker credentials, account identifiers, quantities, weights, or transaction history are transmitted.",
    ],
  };
}

export function marketRefreshPreflight(now = new Date()): MarketRefreshPreflight {
  const root = resolveDataRoot();
  if (!root) throw new Error("Private baseline data is unavailable");
  const positions = parseCsv(readFileSync(resolve(root, "normalized/positions.csv"), "utf8"));
  const requirement = currentPositionMarketDataRequirement(positions);
  const instrumentIds = [
    ...requirement.canonicalInstrumentIds,
    ...requirement.fxPairs.map((pair) => `FX:${pair}`),
  ];
  const prices = parseCsv(readFileSync(resolve(root, "normalized/market-prices.csv"), "utf8"));
  const required = new Set(instrumentIds);
  const latestDates: Record<string, string> = {};
  for (const row of prices) {
    if (required.has(row.instrument_id) && (!latestDates[row.instrument_id] || row.date > latestDates[row.instrument_id])) {
      latestDates[row.instrument_id] = row.date;
    }
  }
  return buildMarketRefreshPreflight({ now, instrumentIds, latestDates });
}

export function confirmsMarketRefresh(body: unknown, preflight: MarketRefreshPreflight): boolean {
  if (typeof body !== "object" || body === null) return false;
  const candidate = body as Record<string, unknown>;
  return candidate.confirmed === true && candidate.fingerprint === preflight.fingerprint;
}

export type IncrementalMarketRefreshValidation = {
  targets: number;
  priceRows: number;
  barRows: number;
  splitRows: number;
  latestByInstrument: Record<string, string>;
};

export function validateIncrementalMarketRefresh(input: {
  targetInstrumentIds: string[];
  prices: string[][];
  bars: string[][];
  splits: string[][];
  dateFrom: string;
  dateToExclusive: string;
}): IncrementalMarketRefreshValidation {
  const targets = new Set(input.targetInstrumentIds);
  if (!targets.size) throw new Error("Market refresh validation requires at least one target");
  const latestByInstrument: Record<string, string> = {};
  const priceKeys = new Set<string>();
  for (const row of input.prices) {
    const [date, instrumentId, close] = row;
    if (!targets.has(instrumentId)) throw new Error(`Unexpected market price target: ${instrumentId}`);
    if (date < input.dateFrom || date >= input.dateToExclusive) throw new Error(`Market price date is outside preflight: ${date}`);
    const key = `${date}|${instrumentId}`;
    if (priceKeys.has(key)) throw new Error(`Duplicate market price: ${key}`);
    priceKeys.add(key);
    if (!Number.isFinite(Number(close)) || Number(close) <= 0) throw new Error(`Invalid market close: ${key}`);
    if (!latestByInstrument[instrumentId] || date > latestByInstrument[instrumentId]) latestByInstrument[instrumentId] = date;
  }
  const missingPrices = [...targets].filter((instrumentId) => !latestByInstrument[instrumentId]);
  if (missingPrices.length) throw new Error(`Market refresh returned no prices for: ${missingPrices.join(", ")}`);

  const barKeys = new Set<string>();
  for (const row of input.bars) {
    const [date, instrumentId, openText, highText, lowText, closeText] = row;
    if (!targets.has(instrumentId)) throw new Error(`Unexpected market bar target: ${instrumentId}`);
    if (date < input.dateFrom || date >= input.dateToExclusive) throw new Error(`Market bar date is outside preflight: ${date}`);
    const key = `${date}|${instrumentId}`;
    if (barKeys.has(key)) throw new Error(`Duplicate market bar: ${key}`);
    barKeys.add(key);
    const [open, high, low, close] = [openText, highText, lowText, closeText].map(Number);
    if (![open, high, low, close].every((value) => Number.isFinite(value) && value > 0)) {
      throw new Error(`Invalid OHLC values: ${key}`);
    }
    if (!instrumentId.startsWith("FX:") && (high < Math.max(open, close) || low > Math.min(open, close) || high < low)) {
      throw new Error(`Inconsistent OHLC values: ${key}`);
    }
  }
  const requiredBars = [...targets].filter((instrumentId) => !instrumentId.startsWith("FX:"));
  const missingBars = requiredBars.filter((instrumentId) => ![...barKeys].some((key) => key.endsWith(`|${instrumentId}`)));
  if (missingBars.length) throw new Error(`Market refresh returned no OHLC bars for: ${missingBars.join(", ")}`);

  const splitKeys = new Set<string>();
  for (const row of input.splits) {
    const [date, instrumentId, numeratorText, denominatorText] = row;
    if (!targets.has(instrumentId)) throw new Error(`Unexpected market split target: ${instrumentId}`);
    if (date < input.dateFrom || date >= input.dateToExclusive) throw new Error(`Market split date is outside preflight: ${date}`);
    const key = `${date}|${instrumentId}`;
    if (splitKeys.has(key)) throw new Error(`Duplicate market split: ${key}`);
    splitKeys.add(key);
    const numerator = Number(numeratorText), denominator = Number(denominatorText);
    if (!Number.isFinite(numerator) || numerator <= 0 || !Number.isFinite(denominator) || denominator <= 0) {
      throw new Error(`Invalid market split ratio: ${key}`);
    }
  }
  return {
    targets: targets.size,
    priceRows: input.prices.length,
    barRows: input.bars.length,
    splitRows: input.splits.length,
    latestByInstrument,
  };
}

const execFileAsync = promisify(execFile);

export async function executeMarketRefresh(): Promise<Record<string, unknown>> {
  const workspaceRoot = resolveWorkspaceRoot();
  const script = resolve(workspaceRoot, "apps/web/scripts/fetch-market-data.ts");
  const { stdout } = await execFileAsync(process.execPath, ["--import", "tsx", script], {
    cwd: resolve(workspaceRoot, "apps/web"),
    env: process.env,
    timeout: 180_000,
    maxBuffer: 1024 * 1024,
  });
  const output = stdout.trim();
  if (!output) throw new Error("Market refresh produced no result");
  return JSON.parse(output) as Record<string, unknown>;
}
