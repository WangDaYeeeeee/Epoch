import { canonicalMarketInstrumentId } from "./market-data";
import type { InstrumentClassification } from "./exposure";

export type FundPosition = {
  instrumentId: string;
  assetClass: string;
  quantity?: number;
};

export type FundHolding = {
  constituentInstrumentId: string;
  name: string;
  weight: number;
  shares?: number;
  marketValue?: number;
};

export type FundHoldingsSnapshot = {
  fundInstrumentId: string;
  asOf: string;
  observedAt: string;
  provider: string;
  sourceHash: string;
  holdings: FundHolding[];
};

export type SelectedFundHoldings = {
  snapshot: FundHoldingsSnapshot | null;
  status: "fresh" | "stale" | "missing";
  ageDays: number | null;
};

export interface EtfHoldingsProvider {
  readonly id: string;
  fetchHoldings(fundInstrumentId: string, asOf?: string): Promise<FundHoldingsSnapshot>;
}

export class ChainedEtfHoldingsProvider implements EtfHoldingsProvider {
  readonly id: string;

  constructor(private readonly providers: EtfHoldingsProvider[]) {
    if (!providers.length) throw new Error("At least one ETF holdings provider is required");
    this.id = providers.map((provider) => provider.id).join(",");
  }

  async fetchHoldings(fundInstrumentId: string, asOf?: string): Promise<FundHoldingsSnapshot> {
    const failures: string[] = [];
    for (const provider of this.providers) {
      try {
        return await provider.fetchHoldings(fundInstrumentId, asOf);
      } catch (error) {
        failures.push(`${provider.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    throw new Error(`All ETF holdings providers failed for ${fundInstrumentId}: ${failures.join("; ")}`);
  }
}

const FUND_ASSET_CLASSES = new Set([
  "broad_index_fund",
  "quantitative_fund",
  "thematic_etf",
  "etf",
]);

export function isFundAssetClass(assetClass: string): boolean {
  return FUND_ASSET_CLASSES.has(assetClass.toLowerCase()) || assetClass.toLowerCase().endsWith("_etf");
}

export function discoverHeldFunds(positions: FundPosition[]): string[] {
  return [...new Set(positions
    .filter((position) => (position.quantity ?? 1) !== 0 && isFundAssetClass(position.assetClass))
    .map((position) => canonicalMarketInstrumentId(position.instrumentId)))]
    .sort();
}

const dayNumber = (date: string): number => Date.parse(`${date}T00:00:00Z`) / 86_400_000;

export function selectFundHoldingsSnapshot(
  snapshots: FundHoldingsSnapshot[],
  requestedAsOf: string,
  maximumAgeDays: number,
): SelectedFundHoldings {
  const eligible = snapshots
    .filter((snapshot) => snapshot.asOf <= requestedAsOf)
    .sort((left, right) => right.asOf.localeCompare(left.asOf) || right.observedAt.localeCompare(left.observedAt));
  const snapshot = eligible[0] ?? null;
  if (!snapshot) return { snapshot: null, status: "missing", ageDays: null };
  const ageDays = Math.max(0, dayNumber(requestedAsOf) - dayNumber(snapshot.asOf));
  return { snapshot, status: ageDays <= maximumAgeDays ? "fresh" : "stale", ageDays };
}

export function holdingsClassifications(
  selections: Map<string, SelectedFundHoldings>,
  directClassifications: InstrumentClassification[],
): InstrumentClassification[] {
  const issuerByInstrument = new Map(directClassifications
    .filter((classification) => classification.issuer)
    .map((classification) => [canonicalMarketInstrumentId(classification.instrumentId), classification.issuer!]));

  return [...selections.entries()].map(([fundInstrumentId, selection]) => ({
    instrumentId: fundInstrumentId,
    issuerHoldings: (selection.snapshot?.holdings ?? []).flatMap((holding) => {
      const constituentInstrumentId = canonicalMarketInstrumentId(holding.constituentInstrumentId);
      const issuer = issuerByInstrument.get(constituentInstrumentId) ?? {
        id: `issuer:security:${constituentInstrumentId.toLowerCase().replace(":", "-")}`,
        name: holding.name,
      };
      return [{ ...issuer, weight: holding.weight }];
    }),
    industryHoldings: (selection.snapshot?.holdings ?? []).flatMap((holding) => {
      const classification = directClassifications.find((item) =>
        canonicalMarketInstrumentId(item.instrumentId) === canonicalMarketInstrumentId(holding.constituentInstrumentId));
      return classification?.industry ? [{ ...classification.industry, weight: holding.weight }] : [];
    }),
    regionHoldings: (selection.snapshot?.holdings ?? []).flatMap((holding) => {
      const classification = directClassifications.find((item) =>
        canonicalMarketInstrumentId(item.instrumentId) === canonicalMarketInstrumentId(holding.constituentInstrumentId));
      return classification?.region ? [{ ...classification.region, weight: holding.weight }] : [];
    }),
    themeHoldings: (selection.snapshot?.holdings ?? []).flatMap((holding) => {
      const classification = directClassifications.find((item) =>
        canonicalMarketInstrumentId(item.instrumentId) === canonicalMarketInstrumentId(holding.constituentInstrumentId));
      return (classification?.themes ?? []).map((theme) => ({ ...theme, weight: holding.weight }));
    }),
    themeCoverageWeight: (selection.snapshot?.holdings ?? []).reduce((sum, holding) => {
      const classification = directClassifications.find((item) =>
        canonicalMarketInstrumentId(item.instrumentId) === canonicalMarketInstrumentId(holding.constituentInstrumentId));
      return sum + (classification?.themes?.length ? holding.weight : 0);
    }, 0),
  }));
}

export function validateFundHoldingsSnapshot(snapshot: FundHoldingsSnapshot): FundHoldingsSnapshot {
  if (!snapshot.fundInstrumentId.includes(":")) throw new Error("Fund holdings snapshot requires a canonical instrument id");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshot.asOf)) throw new Error("Fund holdings snapshot requires an ISO as-of date");
  if (Number.isNaN(Date.parse(snapshot.observedAt))) throw new Error("Fund holdings snapshot requires a valid observed-at timestamp");
  if (!snapshot.provider || !snapshot.sourceHash) throw new Error("Fund holdings snapshot requires provider provenance");
  const seen = new Set<string>();
  let totalWeight = 0;
  for (const holding of snapshot.holdings) {
    const instrumentId = canonicalMarketInstrumentId(holding.constituentInstrumentId);
    if (seen.has(instrumentId)) throw new Error(`Duplicate fund holding: ${instrumentId}`);
    seen.add(instrumentId);
    if (!Number.isFinite(holding.weight) || holding.weight <= 0 || holding.weight > 1) {
      throw new Error(`Invalid fund holding weight for ${instrumentId}`);
    }
    totalWeight += holding.weight;
  }
  if (totalWeight > 1 + 1e-6) throw new Error("Fund holdings weights exceed 100%");
  return snapshot;
}
