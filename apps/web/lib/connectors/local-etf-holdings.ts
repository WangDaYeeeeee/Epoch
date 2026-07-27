import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, resolve } from "node:path";
import {
  validateFundHoldingsSnapshot,
  type EtfHoldingsProvider,
  type FundHolding,
  type FundHoldingsSnapshot,
} from "../domain/fund-holdings";
import { canonicalMarketInstrumentId } from "../domain/market-data";
import { parseCsvRows } from "../server/csv";

const value = (row: string[], headers: string[], ...names: string[]): string => {
  for (const name of names) {
    const index = headers.findIndex((header) => header.trim().toLowerCase() === name.toLowerCase());
    if (index >= 0 && row[index]?.trim()) return row[index].trim();
  }
  return "";
};

const decimal = (raw: string): number | undefined => {
  if (!raw) return undefined;
  const parsed = Number(raw.replaceAll(",", "").replace("%", ""));
  return Number.isFinite(parsed) ? parsed : undefined;
};

const normalizedInstrumentId = (raw: string): string => {
  const instrumentId = raw.trim().toUpperCase();
  if (!instrumentId) throw new Error("ETF holding is missing constituent instrument id");
  return canonicalMarketInstrumentId(instrumentId.includes(":") ? instrumentId : `US:${instrumentId}`);
};

function aggregateHoldings(holdings: FundHolding[]): FundHolding[] {
  const aggregated = new Map<string, FundHolding>();
  for (const holding of holdings) {
    const current = aggregated.get(holding.constituentInstrumentId);
    aggregated.set(holding.constituentInstrumentId, current ? {
      ...current,
      weight: current.weight + holding.weight,
      shares: current.shares == null || holding.shares == null ? undefined : current.shares + holding.shares,
      marketValue: current.marketValue == null || holding.marketValue == null ? undefined : current.marketValue + holding.marketValue,
    } : holding);
  }
  return [...aggregated.values()];
}

function genericSnapshot(text: string, observedAt: string, sourceHash: string): FundHoldingsSnapshot | null {
  const rows = parseCsvRows(text);
  const headers = rows[0]?.map((header) => header.replace(/^\uFEFF/, "").trim()) ?? [];
  if (!headers.some((header) => header.toLowerCase() === "fund_instrument_id")) return null;
  const data = rows.slice(1);
  const fundInstrumentId = canonicalMarketInstrumentId(value(data[0] ?? [], headers, "fund_instrument_id"));
  const asOf = value(data[0] ?? [], headers, "as_of");
  const holdings = aggregateHoldings(data.flatMap((row) => {
    const rawWeight = decimal(value(row, headers, "weight"));
    const constituent = value(row, headers, "constituent_instrument_id");
    if (!constituent || rawWeight == null || rawWeight <= 0) return [];
    return [{
      constituentInstrumentId: normalizedInstrumentId(constituent),
      name: value(row, headers, "name") || constituent,
      weight: rawWeight,
      shares: decimal(value(row, headers, "shares")),
      marketValue: decimal(value(row, headers, "market_value")),
    }];
  }));
  return validateFundHoldingsSnapshot({
    fundInstrumentId,
    asOf,
    observedAt,
    provider: "local_csv",
    sourceHash,
    holdings,
  });
}

function iSharesSnapshot(
  text: string,
  fileName: string,
  observedAt: string,
  sourceHash: string,
): FundHoldingsSnapshot | null {
  const rows = parseCsvRows(text);
  const headerIndex = rows.findIndex((row) =>
    row.some((cell) => cell.trim().toLowerCase() === "ticker")
    && row.some((cell) => ["weight (%)", "weight (%) "].includes(cell.trim().toLowerCase())),
  );
  if (headerIndex < 0) return null;
  const symbol = fileName.match(/^([A-Za-z0-9.-]+?)(?:_holdings|[-_]\d{4}-\d{2}-\d{2}|\.csv)/i)?.[1]?.toUpperCase();
  if (!symbol) throw new Error(`Cannot derive ETF symbol from local holdings file: ${fileName}`);
  const metadata = rows.slice(0, headerIndex).flat().join(" ");
  const dateMatch = metadata.match(/(?:holdings as of|as of)[^A-Za-z0-9]+([A-Za-z]{3,9}\s+\d{1,2},\s+\d{4}|\d{4}-\d{2}-\d{2})/i);
  if (!dateMatch) throw new Error(`Cannot derive as-of date from iShares holdings file: ${fileName}`);
  const asOf = new Date(`${dateMatch[1]} UTC`).toISOString().slice(0, 10);
  const headers = rows[headerIndex].map((header) => header.trim());
  const holdings = aggregateHoldings(rows.slice(headerIndex + 1).flatMap((row) => {
    const ticker = value(row, headers, "Ticker");
    const assetClass = value(row, headers, "Asset Class").toLowerCase();
    const weightPercentage = decimal(value(row, headers, "Weight (%)"));
    if (!ticker || ["cash", "cash and/or derivatives"].includes(assetClass) || weightPercentage == null || weightPercentage <= 0) return [];
    return [{
      constituentInstrumentId: normalizedInstrumentId(ticker),
      name: value(row, headers, "Name") || ticker,
      weight: weightPercentage / 100,
      shares: decimal(value(row, headers, "Quantity")),
      marketValue: decimal(value(row, headers, "Market Value")),
    }];
  }));
  return validateFundHoldingsSnapshot({
    fundInstrumentId: `US:${symbol}`,
    asOf,
    observedAt,
    provider: "local_csv",
    sourceHash,
    holdings,
  });
}

export function parseLocalEtfHoldings(
  text: string,
  fileName: string,
  observedAt: string,
): FundHoldingsSnapshot {
  const sourceHash = createHash("sha256").update(text).digest("hex");
  const parsed = genericSnapshot(text, observedAt, sourceHash)
    ?? iSharesSnapshot(text, fileName, observedAt, sourceHash);
  if (!parsed) throw new Error(`Unsupported ETF holdings CSV format: ${fileName}`);
  return parsed;
}

export class LocalCsvEtfHoldingsProvider implements EtfHoldingsProvider {
  readonly id = "local_csv";

  constructor(private readonly root: string) {}

  async fetchHoldings(fundInstrumentId: string, asOf?: string): Promise<FundHoldingsSnapshot> {
    const canonicalFundId = canonicalMarketInstrumentId(fundInstrumentId);
    const entries = await readdir(this.root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    const snapshots: FundHoldingsSnapshot[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || extname(entry.name).toLowerCase() !== ".csv") continue;
      const path = resolve(this.root, entry.name);
      const [text, metadata] = await Promise.all([readFile(path, "utf8"), stat(path)]);
      const snapshot = parseLocalEtfHoldings(text, entry.name, metadata.mtime.toISOString());
      if (snapshot.fundInstrumentId === canonicalFundId && (!asOf || snapshot.asOf <= asOf)) snapshots.push(snapshot);
    }
    const selected = snapshots.sort((left, right) =>
      right.asOf.localeCompare(left.asOf) || right.observedAt.localeCompare(left.observedAt))[0];
    if (!selected) throw new Error(`No local holdings CSV is available for ${canonicalFundId}${asOf ? ` as of ${asOf}` : ""}`);
    return selected;
  }
}
