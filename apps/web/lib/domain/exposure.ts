import { canonicalMarketInstrumentId } from "./market-data";

export type ExposurePosition = {
  instrumentId: string;
  marketValueUsd: number;
  currency: string;
  assetClass: string;
};

export type InstrumentClassification = {
  instrumentId: string;
  issuer?: { id: string; name: string };
  issuerHoldings?: { id: string; name: string; weight: number }[];
};

export type ExposureBucket = {
  id: string;
  name: string;
  marketValueUsd: number;
  weight: number;
};

export type ExposureSnapshot = {
  methodology: "gross-market-value";
  totalGrossValueUsd: number;
  issuerCoverage: {
    classifiedValueUsd: number;
    totalValueUsd: number;
    ratio: number;
    missingInstrumentIds: string[];
  };
  issuers: ExposureBucket[];
  currencies: ExposureBucket[];
  assetClasses: ExposureBucket[];
};

const add = (buckets: Map<string, { name: string; value: number }>, id: string, name: string, value: number) => {
  const current = buckets.get(id);
  buckets.set(id, { name, value: (current?.value ?? 0) + value });
};

const finish = (buckets: Map<string, { name: string; value: number }>, total: number): ExposureBucket[] =>
  [...buckets.entries()]
    .map(([id, bucket]) => ({ id, name: bucket.name, marketValueUsd: bucket.value, weight: total ? bucket.value / total : 0 }))
    .sort((left, right) => right.marketValueUsd - left.marketValueUsd || left.id.localeCompare(right.id));

export function buildExposureSnapshot(
  positions: ExposurePosition[],
  classifications: InstrumentClassification[],
): ExposureSnapshot {
  const classificationById = new Map(classifications.map((item) => [canonicalMarketInstrumentId(item.instrumentId), item]));
  const issuerBuckets = new Map<string, { name: string; value: number }>();
  const currencyBuckets = new Map<string, { name: string; value: number }>();
  const assetClassBuckets = new Map<string, { name: string; value: number }>();
  const missingInstrumentIds = new Set<string>();
  let classifiedValueUsd = 0;
  let totalGrossValueUsd = 0;

  for (const position of positions) {
    const value = Math.abs(position.marketValueUsd);
    if (!Number.isFinite(value) || value === 0) continue;
    totalGrossValueUsd += value;
    add(currencyBuckets, position.currency, position.currency, value);
    add(assetClassBuckets, position.assetClass, position.assetClass, value);

    const instrumentId = canonicalMarketInstrumentId(position.instrumentId);
    const classification = classificationById.get(instrumentId);
    if (classification?.issuer) {
      add(issuerBuckets, classification.issuer.id, classification.issuer.name, value);
      classifiedValueUsd += value;
      continue;
    }

    const holdings = classification?.issuerHoldings ?? [];
    const validHoldings = holdings.filter((holding) => Number.isFinite(holding.weight) && holding.weight > 0);
    const coveredWeight = validHoldings.reduce((sum, holding) => sum + holding.weight, 0);
    if (coveredWeight > 1 + 1e-9) throw new Error(`Issuer look-through weights exceed 100% for ${instrumentId}`);
    for (const holding of validHoldings) {
      add(issuerBuckets, holding.id, holding.name, value * holding.weight);
    }
    classifiedValueUsd += value * coveredWeight;
    if (coveredWeight < 1) {
      add(issuerBuckets, "unclassified", "待穿透", value * (1 - coveredWeight));
      missingInstrumentIds.add(instrumentId);
    }
  }

  return {
    methodology: "gross-market-value",
    totalGrossValueUsd,
    issuerCoverage: {
      classifiedValueUsd,
      totalValueUsd: totalGrossValueUsd,
      ratio: totalGrossValueUsd ? classifiedValueUsd / totalGrossValueUsd : 1,
      missingInstrumentIds: [...missingInstrumentIds].sort(),
    },
    issuers: finish(issuerBuckets, totalGrossValueUsd),
    currencies: finish(currencyBuckets, totalGrossValueUsd),
    assetClasses: finish(assetClassBuckets, totalGrossValueUsd),
  };
}
