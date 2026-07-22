export type DatedValue = { date: string; value: number };

const DAYS_PER_YEAR = 365;

function yearFraction(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 / DAYS_PER_YEAR;
}

export function calculateMoneyWeightedReturn(cashFlows: DatedValue[]): { annualized: number; cumulative: number } | null {
  if (cashFlows.length < 2) return null;
  const ordered = [...cashFlows].sort((left, right) => left.date.localeCompare(right.date));
  if (!ordered.some((item) => item.value < 0) || !ordered.some((item) => item.value > 0)) return null;
  const start = ordered[0].date;
  const npv = (rate: number) => ordered.reduce(
    (sum, item) => sum + item.value / ((1 + rate) ** yearFraction(start, item.date)), 0,
  );
  let low = -0.9999;
  let high = 1;
  while (npv(low) * npv(high) > 0 && high < 1_000_000) high *= 2;
  if (npv(low) * npv(high) > 0) return null;
  for (let index = 0; index < 200; index += 1) {
    const middle = (low + high) / 2;
    if (npv(low) * npv(middle) <= 0) high = middle;
    else low = middle;
  }
  const annualized = (low + high) / 2;
  const years = yearFraction(start, ordered.at(-1)!.date);
  return { annualized, cumulative: (1 + annualized) ** years - 1 };
}

export function performanceCashFlows(rows: { date: string; total_assets: string; net_external_flow: string }[]): DatedValue[] {
  if (!rows.length) return [];
  const ordered = [...rows].sort((left, right) => left.date.localeCompare(right.date));
  const flows: DatedValue[] = [{ date: ordered[0].date, value: -Number(ordered[0].total_assets) }];
  for (const row of ordered.slice(1)) {
    const externalFlow = Number(row.net_external_flow);
    if (externalFlow) flows.push({ date: row.date, value: -externalFlow });
  }
  flows.push({ date: ordered.at(-1)!.date, value: Number(ordered.at(-1)!.total_assets) });
  return flows;
}
