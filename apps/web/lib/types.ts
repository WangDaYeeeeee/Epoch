export type PortfolioPayload = {
  meta: { account: string; asOf: string; baseCurrency: string; benchmark: string; strategyVersion: string };
  summary: { nav: number; cash: number; portfolioReturn: number; benchmarkReturn: number; activeReturn: number; maxDrawdown?: number; moneyWeightedReturn?: number; cumulativeMoneyWeightedReturn?: number };
  series: { date: string; portfolio: number; benchmark: number; nav: number; drawdown?: number; benchmarkDrawdown?: number }[];
  events?: { date: string; type: string; label: string; details?: string[] }[];
  positions: { symbol: string; name?: string; quantity: number; marketValue: number; currency?: string }[];
  health: {
    status: string;
    ledgerBalanced: boolean;
    reconciliationDifference: number;
    source: string;
    message: string;
    assetReturnsReconciled?: boolean;
    eventCoverage?: { total: number; classified: number; trades: number; cashEvents: number; dividends: number; taxes: number; fxLegs: number; transfers: number; adjustments: number };
    valuationCoverage?: { total: number; withFx: number; fxReconciled: number; missingFx: number; maxBaseValueError: number };
    marketDataRequirement?: { dateFrom: string; dateTo: string; rawInstrumentIds: number; canonicalInstrumentIds: string[]; aliasesCollapsed: number; fxPairs: string[] };
    marketDataCoverage?: { requiredSecurities: number; coveredSecurities: number; missingInstrumentIds: string[]; requiredFxPairs: number; coveredFxPairs: number; priceObservations: number; splitEvents: number };
    ledgerReplayReadiness?: { total: number; classified: number; marketTrades: number; derivativeTrades: number; cashEquivalentTrades: number; cashEvents: number; fxLegs: number; transfers: number; adjustments: number; splitEvents: number; positionImpactingSplits: number };
    cashEndpointReconciliation?: {
      endpoints: number; matched: number;
      differences: { accountId: string; currency: string; date: string; replayed: number; reported: number; difference: number }[];
    };
    positionReconciliation?: {
      intervals: number;
      comparisons: number;
      matched: number;
      timezoneAdjustedTransactions: number;
      differences: {
        accountId: string; fromDate: string; toDate: string; instrumentId: string;
        expectedQuantity: number; reportedQuantity: number; difference: number;
      }[];
    };
  };
};
