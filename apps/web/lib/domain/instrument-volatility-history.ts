import { canonicalMarketInstrumentId } from "./market-data";

type MarketBarRow = Record<string, string>;

export type InstrumentVolatilityPoint = {
  date: string;
  value: number;
};

export function rollingGarmanKlassVolatilityHistory(
  instrumentId: string,
  rows: MarketBarRow[],
  window = 60,
): InstrumentVolatilityPoint[] {
  if (window < 2) throw new Error("Volatility history window must contain at least 2 trading days");
  const barsByDate = new Map<string, { date: string; variance: number }>();
  for (const row of rows) {
    if (canonicalMarketInstrumentId(row.instrument_id) !== instrumentId) continue;
    const open = Number(row.open);
    const high = Number(row.high);
    const low = Number(row.low);
    const close = Number(row.close);
    if (
      ![open, high, low, close].every((value) => Number.isFinite(value) && value > 0)
      || high < Math.max(open, low, close)
      || low > Math.min(open, high, close)
    ) continue;
    const rangeTerm = 0.5 * Math.log(high / low) ** 2;
    const closeOpenTerm = (2 * Math.log(2) - 1) * Math.log(close / open) ** 2;
    barsByDate.set(row.date, { date: row.date, variance: Math.max(0, rangeTerm - closeOpenTerm) });
  }
  const bars = [...barsByDate.values()].sort((left, right) => left.date.localeCompare(right.date));
  if (bars.length < window) return [];
  let rollingVariance = bars.slice(0, window).reduce((sum, bar) => sum + bar.variance, 0);
  const points: InstrumentVolatilityPoint[] = [{
    date: bars[window - 1].date,
    value: Math.sqrt(rollingVariance / window * 252),
  }];
  for (let index = window; index < bars.length; index += 1) {
    rollingVariance += bars[index].variance - bars[index - window].variance;
    points.push({
      date: bars[index].date,
      value: Math.sqrt(Math.max(0, rollingVariance) / window * 252),
    });
  }
  return points;
}
