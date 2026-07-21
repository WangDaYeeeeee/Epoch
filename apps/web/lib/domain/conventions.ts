export const EPOCH_CONVENTIONS = {
  storageTimezone: "UTC",
  reportingTimezone: "Asia/Shanghai",
  baseCurrency: "USD",
  reportingCurrency: "USD",
  riskCurrency: "USD",
  benchmark: ".NDX",
  dateFormat: "YYYY-MM-DD",
  timestamps: ["observedAt", "effectiveAt", "recordedAt", "asOf"],
} as const;

export const SUPPORTED_CURRENCIES = ["USD", "KRW", "HKD", "CNY"] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

export type InstrumentId = `${string}:${string}`;

export function parseInstrumentId(value: string): { venue: string; localId: string } {
  const separator = value.indexOf(":");
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error(`Invalid instrument id: ${value}`);
  }
  return { venue: value.slice(0, separator), localId: value.slice(separator + 1) };
}

export function assertCurrency(value: string): asserts value is Currency {
  if (!SUPPORTED_CURRENCIES.includes(value as Currency)) {
    throw new Error(`Unsupported currency: ${value}`);
  }
}

export function assertIsoDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Invalid ISO date: ${value}`);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`Invalid ISO date: ${value}`);
  }
}
