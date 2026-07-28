export type RiskDriftLevel = "normal" | "highlight" | "strong";

export type RiskDriftSnapshot = {
  anchorId: string;
  anchorCalculationRunId: string;
  effectiveAt: string;
  portfolio: {
    anchorVolatilityAnnualized: number;
    currentVolatilityAnnualized: number;
    ratio: number | null;
    level: RiskDriftLevel;
  };
  divergence: {
    weight: number;
    riskContribution: number | null;
  };
  instruments: {
    instrumentId: string;
    anchorWeight: number;
    currentWeight: number | null;
    anchorVolatilityAnnualized: number;
    currentVolatilityAnnualized: number | null;
    ratio: number | null;
    level: RiskDriftLevel;
  }[];
};

const level = (ratio: number | null): RiskDriftLevel =>
  ratio != null && ratio + 1e-12 >= 2 ? "strong" : ratio != null && ratio + 1e-12 >= 1.5 ? "highlight" : "normal";

const ratio = (current: number | null, anchor: number): number | null =>
  current != null && anchor > 1e-15 ? current / anchor : null;

export function calculateRiskDrift(input: {
  currentPortfolioVolatilityAnnualized: number;
  currentInstruments: {
    instrumentId: string;
    weight: number;
    volatilityAnnualized: number;
    riskContribution: number;
  }[];
  anchor: {
    id: string;
    calculationRunId: string;
    effectiveAt: string;
    portfolioVolatilityAnnualized: number;
    instruments: {
      instrumentId: string;
      weight: number;
      volatilityAnnualized: number;
      riskContribution: number | null;
    }[];
  };
}): RiskDriftSnapshot {
  const current = new Map(input.currentInstruments.map((instrument) => [
    instrument.instrumentId,
    instrument,
  ]));
  const allInstrumentIds = new Set([
    ...input.currentInstruments.map((instrument) => instrument.instrumentId),
    ...input.anchor.instruments.map((instrument) => instrument.instrumentId),
  ]);
  const anchorById = new Map(input.anchor.instruments.map((instrument) => [instrument.instrumentId, instrument]));
  const weightDivergence = 0.5 * [...allInstrumentIds].reduce((sum, instrumentId) => (
    sum + Math.abs((current.get(instrumentId)?.weight ?? 0) - (anchorById.get(instrumentId)?.weight ?? 0))
  ), 0);
  const riskContributionDivergence = input.anchor.instruments.every((instrument) => instrument.riskContribution != null)
    ? 0.5 * [...allInstrumentIds].reduce((sum, instrumentId) => (
      sum + Math.abs(
        (current.get(instrumentId)?.riskContribution ?? 0)
        - (anchorById.get(instrumentId)?.riskContribution ?? 0)
      )
    ), 0)
    : null;
  const portfolioRatio = ratio(
    input.currentPortfolioVolatilityAnnualized,
    input.anchor.portfolioVolatilityAnnualized,
  );
  return {
    anchorId: input.anchor.id,
    anchorCalculationRunId: input.anchor.calculationRunId,
    effectiveAt: input.anchor.effectiveAt,
    portfolio: {
      anchorVolatilityAnnualized: input.anchor.portfolioVolatilityAnnualized,
      currentVolatilityAnnualized: input.currentPortfolioVolatilityAnnualized,
      ratio: portfolioRatio,
      level: level(portfolioRatio),
    },
    divergence: {
      weight: weightDivergence,
      riskContribution: riskContributionDivergence,
    },
    instruments: input.anchor.instruments.map((anchor) => {
      const currentVolatilityAnnualized = current.get(anchor.instrumentId)?.volatilityAnnualized ?? null;
      const instrumentRatio = ratio(currentVolatilityAnnualized, anchor.volatilityAnnualized);
      return {
        instrumentId: anchor.instrumentId,
        anchorWeight: anchor.weight,
        currentWeight: current.get(anchor.instrumentId)?.weight ?? null,
        anchorVolatilityAnnualized: anchor.volatilityAnnualized,
        currentVolatilityAnnualized,
        ratio: instrumentRatio,
        level: level(instrumentRatio),
      };
    }),
  };
}
