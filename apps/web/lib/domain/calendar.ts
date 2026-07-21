import { assertIsoDate } from "./conventions";

export type TradingCalendar = {
  timezone: string;
  holidays: ReadonlySet<string>;
};

export const NDX_CALENDAR: TradingCalendar = {
  timezone: "America/New_York",
  holidays: new Set([
    "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
    "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  ]),
};

export function isTradingDay(isoDate: string, calendar: TradingCalendar): boolean {
  assertIsoDate(isoDate);
  const day = new Date(`${isoDate}T12:00:00Z`).getUTCDay();
  return day !== 0 && day !== 6 && !calendar.holidays.has(isoDate);
}

export function previousTradingDay(isoDate: string, calendar: TradingCalendar): string {
  assertIsoDate(isoDate);
  const cursor = new Date(`${isoDate}T12:00:00Z`);
  do cursor.setUTCDate(cursor.getUTCDate() - 1);
  while (!isTradingDay(cursor.toISOString().slice(0, 10), calendar));
  return cursor.toISOString().slice(0, 10);
}
