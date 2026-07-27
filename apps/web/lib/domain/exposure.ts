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
  industry?: { id: string; name: string };
  industryHoldings?: { id: string; name: string; weight: number }[];
  region?: { id: string; name: string };
  regionHoldings?: { id: string; name: string; weight: number }[];
  themes?: { id: string; name: string }[];
  themeHoldings?: { id: string; name: string; weight: number }[];
  themeCoverageWeight?: number;
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
  industries: ExposureBucket[];
  regions: ExposureBucket[];
  themes: ExposureBucket[];
  dimensionCoverage: {
    industry: ExposureCoverage;
    region: ExposureCoverage;
    theme: ExposureCoverage;
  };
  holdingOverlaps: HoldingOverlap[];
};

export type ExposureCoverage = {
  classifiedValueUsd: number;
  totalValueUsd: number;
  ratio: number;
  missingInstrumentIds: string[];
};

export type HoldingOverlap = {
  issuerId: string;
  issuerName: string;
  marketValueUsd: number;
  weight: number;
  sources: {
    instrumentId: string;
    sourceType: "direct" | "fund";
    marketValueUsd: number;
    weightWithinIssuer: number;
  }[];
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
  const issuerSources = new Map<string, { name: string; sources: Map<string, { sourceType: "direct" | "fund"; value: number }> }>();
  const currencyBuckets = new Map<string, { name: string; value: number }>();
  const assetClassBuckets = new Map<string, { name: string; value: number }>();
  const industryBuckets = new Map<string, { name: string; value: number }>();
  const regionBuckets = new Map<string, { name: string; value: number }>();
  const themeBuckets = new Map<string, { name: string; value: number }>();
  const missingInstrumentIds = new Set<string>();
  const missingIndustries = new Set<string>();
  const missingRegions = new Set<string>();
  const missingThemes = new Set<string>();
  let classifiedValueUsd = 0;
  let classifiedIndustryValueUsd = 0;
  let classifiedRegionValueUsd = 0;
  let classifiedThemeValueUsd = 0;
  let totalGrossValueUsd = 0;

  for (const position of positions) {
    const value = Math.abs(position.marketValueUsd);
    if (!Number.isFinite(value) || value === 0) continue;
    totalGrossValueUsd += value;
    add(currencyBuckets, position.currency, position.currency, value);
    add(assetClassBuckets, position.assetClass, position.assetClass, value);

    const instrumentId = canonicalMarketInstrumentId(position.instrumentId);
    const classification = classificationById.get(instrumentId);
    const addIssuerSource = (issuer: { id: string; name: string }, sourceType: "direct" | "fund", sourceValue: number) => {
      add(issuerBuckets, issuer.id, issuer.name, sourceValue);
      const entry = issuerSources.get(issuer.id) ?? { name: issuer.name, sources: new Map() };
      const current = entry.sources.get(instrumentId);
      entry.sources.set(instrumentId, { sourceType, value: (current?.value ?? 0) + sourceValue });
      issuerSources.set(issuer.id, entry);
    };
    const addDimension = (
      buckets: Map<string, { name: string; value: number }>,
      direct: { id: string; name: string } | undefined,
      lookThrough: { id: string; name: string; weight: number }[],
      missing: Set<string>,
    ): number => {
      if (direct) {
        add(buckets, direct.id, direct.name, value);
        return value;
      }
      const valid = lookThrough.filter((holding) => Number.isFinite(holding.weight) && holding.weight > 0);
      const coveredWeight = Math.min(1, valid.reduce((sum, holding) => sum + holding.weight, 0));
      for (const holding of valid) add(buckets, holding.id, holding.name, value * holding.weight);
      if (coveredWeight < 1) {
        add(buckets, "unclassified", "待分类", value * (1 - coveredWeight));
        missing.add(instrumentId);
      }
      return value * coveredWeight;
    };
    classifiedIndustryValueUsd += addDimension(
      industryBuckets, classification?.industry, classification?.industryHoldings ?? [], missingIndustries,
    );
    classifiedRegionValueUsd += addDimension(
      regionBuckets, classification?.region, classification?.regionHoldings ?? [], missingRegions,
    );
    const themes = classification?.themes ?? [];
    if (themes.length) {
      for (const theme of themes) add(themeBuckets, theme.id, theme.name, value);
      classifiedThemeValueUsd += value;
    } else {
      const themeHoldings = (classification?.themeHoldings ?? [])
        .filter((holding) => Number.isFinite(holding.weight) && holding.weight > 0);
      for (const holding of themeHoldings) add(themeBuckets, holding.id, holding.name, value * holding.weight);
      const coveredWeight = Math.min(1, classification?.themeCoverageWeight
        ?? themeHoldings.reduce((sum, holding) => sum + holding.weight, 0));
      classifiedThemeValueUsd += value * coveredWeight;
      if (coveredWeight < 1) {
        add(themeBuckets, "unclassified", "待分类", value * (1 - coveredWeight));
        missingThemes.add(instrumentId);
      }
    }
    if (classification?.issuer) {
      addIssuerSource(classification.issuer, "direct", value);
      classifiedValueUsd += value;
      continue;
    }

    const holdings = classification?.issuerHoldings ?? [];
    const validHoldings = holdings.filter((holding) => Number.isFinite(holding.weight) && holding.weight > 0);
    const coveredWeight = validHoldings.reduce((sum, holding) => sum + holding.weight, 0);
    if (coveredWeight > 1 + 1e-9) throw new Error(`Issuer look-through weights exceed 100% for ${instrumentId}`);
    for (const holding of validHoldings) {
      addIssuerSource(holding, "fund", value * holding.weight);
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
    industries: finish(industryBuckets, totalGrossValueUsd),
    regions: finish(regionBuckets, totalGrossValueUsd),
    themes: finish(themeBuckets, totalGrossValueUsd),
    dimensionCoverage: {
      industry: {
        classifiedValueUsd: classifiedIndustryValueUsd,
        totalValueUsd: totalGrossValueUsd,
        ratio: totalGrossValueUsd ? classifiedIndustryValueUsd / totalGrossValueUsd : 1,
        missingInstrumentIds: [...missingIndustries].sort(),
      },
      region: {
        classifiedValueUsd: classifiedRegionValueUsd,
        totalValueUsd: totalGrossValueUsd,
        ratio: totalGrossValueUsd ? classifiedRegionValueUsd / totalGrossValueUsd : 1,
        missingInstrumentIds: [...missingRegions].sort(),
      },
      theme: {
        classifiedValueUsd: classifiedThemeValueUsd,
        totalValueUsd: totalGrossValueUsd,
        ratio: totalGrossValueUsd ? classifiedThemeValueUsd / totalGrossValueUsd : 1,
        missingInstrumentIds: [...missingThemes].sort(),
      },
    },
    holdingOverlaps: [...issuerSources.entries()].flatMap(([issuerId, entry]) => {
      if (entry.sources.size < 2) return [];
      const marketValueUsd = [...entry.sources.values()].reduce((sum, source) => sum + source.value, 0);
      return [{
        issuerId,
        issuerName: entry.name,
        marketValueUsd,
        weight: totalGrossValueUsd ? marketValueUsd / totalGrossValueUsd : 0,
        sources: [...entry.sources.entries()]
          .map(([sourceInstrumentId, source]) => ({
            instrumentId: sourceInstrumentId,
            sourceType: source.sourceType,
            marketValueUsd: source.value,
            weightWithinIssuer: marketValueUsd ? source.value / marketValueUsd : 0,
          }))
          .sort((left, right) => right.marketValueUsd - left.marketValueUsd || left.instrumentId.localeCompare(right.instrumentId)),
      }];
    }).sort((left, right) => right.marketValueUsd - left.marketValueUsd || left.issuerId.localeCompare(right.issuerId)),
  };
}
