import type { ExposureSnapshot } from "./domain/exposure";
import type { ReturnAttribution } from "./domain/return-attribution";
import type { RiskDriftSnapshot } from "./domain/risk-drift";
import type { OperationsSnapshot } from "./domain/operations";
import type { EventHorizonSnapshot } from "./domain/event-horizon";
import type { DecisionJournalEntry } from "./domain/decision-journal";

export type PortfolioRiskSnapshot = {
  calculationId: string;
  asOf: string;
  inputHash: string;
  status: "succeeded" | "degraded";
  modelVersion: string;
  dataStatus: "fresh" | "stale";
  portfolio: {
    volatilityAnnualized: number;
    stressVolatilityAnnualized: number;
    historicalCvarLoss: number | null;
    cvarConfidence: number;
  };
  instruments: {
    instrumentId: string;
    weight: number;
    volatilityAnnualized: number;
    riskContribution: number;
    riskCapitalRatio: number | null;
  }[];
  policyGate: {
    limitAnnualized: number;
    observedAnnualized: number;
    passed: boolean;
    violations: string[];
  };
  modelDiagnostics?: {
    semivarianceResolution: string;
    ivInputStatus: string;
    forecasts: {
      instrumentId: string;
      positiveSemivariance22d: number;
      negativeSemivariance22d: number;
      signedJump22d: number;
      expandingWindowBacktest: { observations: number; mae: number; rmse: number };
      harBaselineExpandingWindowBacktest: { observations: number; mae: number; rmse: number };
    }[];
    historicalCrashWeeks: { endDate: string; return: number }[];
    correlationClusters: string[][];
    divergence: { status: string; reason: string };
  };
  warnings: string[];
};

export type PortfolioPayload = {
  meta: { account: string; asOf: string; baseCurrency: string; benchmark: string; strategyVersion: string; classificationVersion: string };
  summary: { nav: number; cash: number; portfolioReturn: number; benchmarkReturn: number; activeReturn: number; maxDrawdown?: number; moneyWeightedReturn?: number; cumulativeMoneyWeightedReturn?: number };
  series: { date: string; portfolio: number; benchmark: number; nav: number; drawdown?: number; benchmarkDrawdown?: number }[];
  events?: { date: string; type: string; label: string; details?: string[] }[];
  positions: { instrumentId: string; symbol: string; name?: string; quantity: number; marketValue: number; currency: string; assetClass: string }[];
  exposure: ExposureSnapshot;
  returnAttribution?: ReturnAttribution;
  risk?: PortfolioRiskSnapshot;
  riskHistory?: PortfolioRiskSnapshot[];
  instrumentVolatilityHistory?: {
    instrumentId: string;
    estimator: "garman_klass_60d";
    points: { date: string; value: number }[];
  }[];
  riskScenarios?: PortfolioRiskSnapshot[];
  riskDrift?: RiskDriftSnapshot;
  operations?: OperationsSnapshot;
  eventHorizon?: EventHorizonSnapshot;
  journal?: DecisionJournalEntry[];
  quality?: {
    forecast: { observations: number; mae: number | null; rmse: number | null; latest_realized_as_of: string | null };
    confidenceCalibration: { confidence_bucket: number; observations: number; verified_rate: number }[];
    unresolvedClaims: {
      id: string; candidate_id: string; kind: string; statement: string;
      confidence: number; as_of: string; age_days: number;
    }[];
    playbookCoverage: { completed_events: number; covered_events: number };
    decisionQuality: { decisions: number; rejected: number; executed: number };
    dataSources: {
      id: string; capability: string; provider: string; configured_status: string;
      required: boolean; health_status: string; detail: string | null; effective_at: string | null;
    }[];
    signalCoverage: {
      intraday: { observations: number; instruments: number; earliest: string | null; latest: string | null };
      semivariance: { observations: number; instruments: number; earliest: string | null; latest: string | null; return_observations: number | null };
      options: { observations: number; instruments: number; earliest: string | null; latest: string | null };
    };
  };
  health: {
    status: string;
    ledgerBalanced: boolean;
    reconciliationDifference: number;
    source: string;
    message: string;
    operationalAlerts?: {
      id: string;
      source: string;
      severity: "warning" | "error";
      title: string;
      detail: string;
      occurrenceCount: number;
      lastObservedAt: string;
    }[];
    assetReturnsReconciled?: boolean;
    eventCoverage?: { total: number; classified: number; trades: number; cashEvents: number; dividends: number; taxes: number; fxLegs: number; transfers: number; adjustments: number };
    valuationCoverage?: { total: number; withFx: number; fxReconciled: number; missingFx: number; maxBaseValueError: number };
    marketDataRequirement?: { dateFrom: string; dateTo: string; rawInstrumentIds: number; canonicalInstrumentIds: string[]; aliasesCollapsed: number; fxPairs: string[] };
    marketDataCoverage?: { requiredSecurities: number; coveredSecurities: number; missingInstrumentIds: string[]; requiredFxPairs: number; coveredFxPairs: number; priceObservations: number; splitEvents: number };
    marketDataFreshness?: {
      status: "fresh" | "stale" | "missing";
      latestEffectiveDate: string | null; expectedThroughDate: string; tradingDayLag: number | null;
      observedAt: string | null; observationTimestampQuality: "authoritative" | "filesystem_fallback" | "missing";
      reason: string;
    };
    marketBarCoverage?: {
      requiredInstruments: number; coveredInstruments: number; missingInstrumentIds: string[];
      totalBars: number; validBars: number; invalidBars: number; duplicateBars: number;
    };
    brokerConnection?: {
      provider: "ibkr"; capability: "read_only";
      status: "not_configured" | "connected" | "authentication_required" | "unavailable";
      checkedAt: string; endpoint: string | null;
      session: { connected: boolean; authenticated: boolean; competing: boolean } | null;
      reason: string;
    };
    ledgerReplayReadiness?: { total: number; classified: number; marketTrades: number; derivativeTrades: number; cashEquivalentTrades: number; cashEvents: number; fxLegs: number; transfers: number; adjustments: number; splitEvents: number; positionImpactingSplits: number };
    cashEndpointReconciliation?: {
      endpoints: number; matched: number;
      differences: { accountId: string; currency: string; date: string; replayed: number; reported: number; difference: number }[];
    };
    dailyLedgerReplay?: {
      days: number; transactionEventsApplied: number; splitEventsApplied: number;
      terminalCashAccounts: number; terminalPositionAccounts: number;
      terminalTransit: Record<string, number>;
    };
    dailyLedgerValuation?: {
      totalDays: number; valuedDays: number; accountedDays: number; residualBridgeDays: number; missingPriceDays: number;
      maxAbsoluteResidualBridgeUsd: number;
      maxAbsoluteDifferenceUsd: number; maxAbsoluteRelativeDifference: number; terminalDifferenceUsd: number | null;
      missingInstrumentIds: string[];
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
