import { CASH_EQUIVALENT_INSTRUMENTS, canonicalMarketInstrumentId, isDerivativeInstrumentId } from "./market-data";
import type { DailyLedgerState } from "./ledger-replay";

type Row = Record<string, string>;

export type PortfolioRiskInput = {
  schemaVersion: "portfolio-risk-input/1.0";
  asOf: string;
  baseCurrency: "USD";
  weightDefinition: "market_value_usd_over_net_nav_cash_in_denominator";
  marketDataDefinition: {
    priceAdjustment: "split_adjusted";
    ohlcCurrency: "usd_using_same_date_fx_close";
    returnMethod: "common_date_close_to_close_usd";
    dividendTreatment: "excluded";
  };
  positions: {
    instrumentId: string;
    weight: number;
  }[];
  series: {
    instrumentId: string;
    bars: {
      date: string;
      open: number;
      high: number;
      low: number;
      close: number;
    }[];
    returnsUsd: {
      date: string;
      value: number;
    }[];
  }[];
};

type Position = {
  instrumentId: string;
  currency: string;
  marketValueUsd: number;
};

type UsdBar = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
};

type RiskPosition = Position;

const numeric = (value: string, field: string): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid ${field}: ${value}`);
  return parsed;
};

const usdValue = (row: Row): number => {
  if (row.market_value_base !== "") return numeric(row.market_value_base, "market_value_base");
  if (row.currency === "USD") return numeric(row.market_value, "market_value");
  if (row.fx_to_base !== "") return numeric(row.market_value, "market_value") * numeric(row.fx_to_base, "fx_to_base");
  throw new Error(`Position ${row.instrument_id} has no USD valuation`);
};

function buildRiskInput(
  positions: RiskPosition[],
  portfolioNavUsd: number,
  marketBarRows: Row[],
  asOfDate?: string,
): PortfolioRiskInput {
  if (!Number.isFinite(portfolioNavUsd) || portfolioNavUsd <= 0) {
    throw new Error("Risk input requires a positive USD portfolio NAV");
  }
  if (!positions.length) throw new Error("Risk input has no market-risk positions");

  const fxCloseByPairAndDate = new Map<string, Map<string, number>>();
  for (const row of marketBarRows) {
    if (asOfDate && row.date > asOfDate) continue;
    if (!row.instrument_id.startsWith("FX:")) continue;
    const daily = fxCloseByPairAndDate.get(row.instrument_id) ?? new Map<string, number>();
    daily.set(row.date, numeric(row.close, "FX close"));
    fxCloseByPairAndDate.set(row.instrument_id, daily);
  }
  const barsByInstrument = new Map<string, UsdBar[]>();
  for (const position of positions) {
    const sourceRows = marketBarRows
      .filter((row) =>
        canonicalMarketInstrumentId(row.instrument_id) === position.instrumentId
        && (!asOfDate || row.date <= asOfDate),
      )
      .sort((left, right) => left.date.localeCompare(right.date));
    const fx = position.currency === "USD"
      ? undefined
      : fxCloseByPairAndDate.get(`FX:${position.currency}USD`);
    const usdBars = sourceRows.flatMap((row): UsdBar[] => {
      const rate = position.currency === "USD" ? 1 : fx?.get(row.date);
      if (rate == null) return [];
      return [{
        date: row.date,
        open: numeric(row.open, "open") * rate,
        high: numeric(row.high, "high") * rate,
        low: numeric(row.low, "low") * rate,
        close: numeric(row.close, "close") * rate,
      }];
    });
    if (usdBars.length < 60) {
      throw new Error(`Risk input requires 60 USD OHLC bars for ${position.instrumentId}; received ${usdBars.length}`);
    }
    barsByInstrument.set(position.instrumentId, usdBars);
  }

  const commonDates = positions
    .map((position) => new Set(barsByInstrument.get(position.instrumentId)!.map((bar) => bar.date)))
    .reduce((common, dates) => new Set([...common].filter((date) => dates.has(date))));
  const alignedDates = [...commonDates].sort();
  if (alignedDates.length < 251) {
    throw new Error(`Risk input requires 251 common USD close dates; received ${alignedDates.length}`);
  }
  const valuationDates = alignedDates.slice(-251);
  const resolvedAsOfDate = valuationDates.at(-1)!;
  if (asOfDate && resolvedAsOfDate !== asOfDate) {
    throw new Error(`Risk input has no aligned market close for ${asOfDate}; latest is ${resolvedAsOfDate}`);
  }

  return {
    schemaVersion: "portfolio-risk-input/1.0",
    asOf: `${resolvedAsOfDate}T00:00:00Z`,
    baseCurrency: "USD",
    weightDefinition: "market_value_usd_over_net_nav_cash_in_denominator",
    marketDataDefinition: {
      priceAdjustment: "split_adjusted",
      ohlcCurrency: "usd_using_same_date_fx_close",
      returnMethod: "common_date_close_to_close_usd",
      dividendTreatment: "excluded",
    },
    positions: positions.map((position) => ({
      instrumentId: position.instrumentId,
      weight: position.marketValueUsd / portfolioNavUsd,
    })),
    series: positions.map((position) => {
      const bars = barsByInstrument.get(position.instrumentId)!;
      const closes = new Map(bars.map((bar) => [bar.date, bar.close]));
      return {
        instrumentId: position.instrumentId,
        bars: bars.slice(-60),
        returnsUsd: valuationDates.slice(1).map((date, index) => ({
          date,
          value: closes.get(date)! / closes.get(valuationDates[index])! - 1,
        })),
      };
    }),
  };
}

export function buildPortfolioRiskInput(
  positionRows: Row[],
  marketBarRows: Row[],
  portfolioNavUsdOverride?: number,
): PortfolioRiskInput {
  const latestPositionDate = positionRows.map((row) => row.date).filter(Boolean).sort().at(-1);
  if (!latestPositionDate) throw new Error("Risk input requires a position snapshot");
  const currentRows = positionRows.filter((row) => row.date === latestPositionDate);
  const portfolioNavUsd = portfolioNavUsdOverride
    ?? currentRows.reduce((sum, row) => sum + usdValue(row), 0);
  const groupedPositions = new Map<string, Position>();
  for (const row of currentRows) {
    if (
      ["cash", "other", "option", "future"].includes(row.category)
      || row.instrument_id.startsWith("CASH:")
      || row.instrument_id.startsWith("ACCRUAL:")
      || CASH_EQUIVALENT_INSTRUMENTS.has(row.instrument_id)
      || isDerivativeInstrumentId(row.instrument_id)
      || Math.abs(numeric(row.quantity, "quantity")) <= 1e-12
    ) continue;
    const instrumentId = canonicalMarketInstrumentId(row.instrument_id);
    const existing = groupedPositions.get(instrumentId);
    if (existing && existing.currency !== row.currency) {
      throw new Error(`Canonical instrument ${instrumentId} has conflicting currencies`);
    }
    groupedPositions.set(instrumentId, {
      instrumentId,
      currency: row.currency,
      marketValueUsd: (existing?.marketValueUsd ?? 0) + usdValue(row),
    });
  }
  return buildRiskInput(
    [...groupedPositions.values()].sort((left, right) => left.instrumentId.localeCompare(right.instrumentId)),
    portfolioNavUsd,
    marketBarRows,
  );
}

export function buildHistoricalPortfolioRiskInput(
  state: DailyLedgerState,
  portfolioNavUsd: number,
  marketBarRows: Row[],
  splitRows: Row[] = [],
): PortfolioRiskInput {
  const futureSplitFactor = (instrumentId: string): number => splitRows
    .filter((row) =>
      row.date > state.date
      && canonicalMarketInstrumentId(row.instrument_id) === instrumentId,
    )
    .reduce((factor, row) => factor * numeric(row.numerator, "split numerator") / numeric(row.denominator, "split denominator"), 1);
  const quantities = new Map<string, number>();
  for (const [key, quantity] of Object.entries(state.quantities)) {
    const separator = key.indexOf("|");
    const instrumentId = canonicalMarketInstrumentId(separator >= 0 ? key.slice(separator + 1) : key);
    if (
      instrumentId.startsWith("CASH:")
      || instrumentId.startsWith("ACCRUAL:")
      || CASH_EQUIVALENT_INSTRUMENTS.has(instrumentId)
      || isDerivativeInstrumentId(instrumentId)
      || Math.abs(quantity) <= 1e-12
    ) continue;
    quantities.set(
      instrumentId,
      (quantities.get(instrumentId) ?? 0) + quantity * futureSplitFactor(instrumentId),
    );
  }

  const currencyByInstrument = new Map<string, string>();
  const closeByInstrument = new Map<string, number>();
  const fxClose = new Map<string, number>();
  for (const row of marketBarRows) {
    if (row.date !== state.date) continue;
    if (row.instrument_id.startsWith("FX:")) {
      fxClose.set(row.instrument_id, numeric(row.close, "FX close"));
      continue;
    }
    const instrumentId = canonicalMarketInstrumentId(row.instrument_id);
    if (!quantities.has(instrumentId)) continue;
    const existingCurrency = currencyByInstrument.get(instrumentId);
    if (existingCurrency && existingCurrency !== row.currency) {
      throw new Error(`Canonical instrument ${instrumentId} has conflicting currencies`);
    }
    currencyByInstrument.set(instrumentId, row.currency);
    closeByInstrument.set(instrumentId, numeric(row.close, "close"));
  }

  const positions = [...quantities.entries()]
    .filter(([, quantity]) => Math.abs(quantity) > 1e-12)
    .map(([instrumentId, quantity]): RiskPosition => {
      const currency = currencyByInstrument.get(instrumentId);
      const close = closeByInstrument.get(instrumentId);
      if (!currency || close == null) throw new Error(`Risk input has no ${state.date} market close for ${instrumentId}`);
      const rate = currency === "USD" ? 1 : fxClose.get(`FX:${currency}USD`);
      if (rate == null) throw new Error(`Risk input has no ${state.date} FX close for ${currency}USD`);
      return { instrumentId, currency, marketValueUsd: quantity * close * rate };
    })
    .sort((left, right) => left.instrumentId.localeCompare(right.instrumentId));

  return buildRiskInput(positions, portfolioNavUsd, marketBarRows, state.date);
}
