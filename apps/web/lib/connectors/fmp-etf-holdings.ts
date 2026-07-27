import { createHash } from "node:crypto";
import {
  validateFundHoldingsSnapshot,
  type EtfHoldingsProvider,
  type FundHolding,
  type FundHoldingsSnapshot,
} from "../domain/fund-holdings";
import { canonicalMarketInstrumentId } from "../domain/market-data";

type FmpHolding = {
  asset?: string;
  symbol?: string;
  name?: string;
  weightPercentage?: number | string;
  weight?: number | string;
  sharesNumber?: number | string;
  shares?: number | string;
  marketValue?: number | string;
  updated?: string;
  date?: string;
};

const number = (value: number | string | undefined): number | undefined => {
  if (value == null || value === "") return undefined;
  const parsed = Number(String(value).replace("%", ""));
  return Number.isFinite(parsed) ? parsed : undefined;
};

const isoDate = (value: string): string => {
  const match = value.match(/^\d{4}-\d{2}-\d{2}/);
  if (!match) throw new Error(`ETF holdings response has invalid as-of date: ${value}`);
  return match[0];
};

function normalizedWeight(row: FmpHolding): number {
  const percentage = number(row.weightPercentage);
  if (percentage != null) return percentage / 100;
  const raw = number(row.weight);
  if (raw == null) throw new Error(`ETF holding is missing weight: ${row.asset ?? row.symbol ?? "unknown"}`);
  return raw;
}

export class FmpEtfHoldingsProvider implements EtfHoldingsProvider {
  readonly id = "fmp";

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly baseUrl = "https://financialmodelingprep.com/stable",
  ) {
    if (!apiKey) throw new Error("FMP API key is required");
  }

  async fetchHoldings(fundInstrumentId: string, asOf?: string): Promise<FundHoldingsSnapshot> {
    const symbol = canonicalMarketInstrumentId(fundInstrumentId).split(":").at(-1);
    if (!symbol) throw new Error(`Cannot derive ETF symbol from ${fundInstrumentId}`);
    const url = new URL(`${this.baseUrl}/etf/holdings`);
    url.searchParams.set("symbol", symbol);
    if (asOf) url.searchParams.set("date", asOf);
    url.searchParams.set("apikey", this.apiKey);
    const response = await this.fetchImpl(url);
    if (!response.ok) throw new Error(`FMP ETF holdings request failed: HTTP ${response.status}`);
    const body = await response.text();
    const parsed = JSON.parse(body) as FmpHolding[] | { data?: FmpHolding[] };
    const rows = Array.isArray(parsed) ? parsed : parsed.data ?? [];
    if (!rows.length) throw new Error(`FMP ETF holdings response is empty for ${symbol}`);
    const responseAsOf = isoDate(rows.map((row) => row.updated ?? row.date ?? "").filter(Boolean).sort().at(-1) ?? asOf ?? "");
    const holdings: FundHolding[] = rows.map((row) => {
      const constituentSymbol = row.asset ?? row.symbol;
      if (!constituentSymbol) throw new Error("ETF holding is missing constituent symbol");
      return {
        constituentInstrumentId: constituentSymbol.includes(":") ? canonicalMarketInstrumentId(constituentSymbol) : `US:${constituentSymbol}`,
        name: row.name || constituentSymbol,
        weight: normalizedWeight(row),
        shares: number(row.sharesNumber ?? row.shares),
        marketValue: number(row.marketValue),
      };
    });
    return validateFundHoldingsSnapshot({
      fundInstrumentId: canonicalMarketInstrumentId(fundInstrumentId),
      asOf: responseAsOf,
      observedAt: new Date().toISOString(),
      provider: this.id,
      sourceHash: createHash("sha256").update(body).digest("hex"),
      holdings,
    });
  }
}
