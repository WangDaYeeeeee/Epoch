import { assertIsoDate } from "./conventions";
import { isTradingDay, NDX_CALENDAR } from "./calendar";

export const INVESTMENT_EVENT_TYPES = [
  "earnings", "product", "regulatory", "macro", "capital_allocation", "other",
] as const;
export type InvestmentEventType = typeof INVESTMENT_EVENT_TYPES[number];
export type PlaybookStatus = "missing" | "draft" | "ready";
export type EventHorizonZone = "past" | "near" | "far";

export type InvestmentEvent = {
  id: string;
  title: string;
  instrumentId: string | null;
  eventType: InvestmentEventType;
  scheduledDate: string;
  source: string;
  playbookStatus: PlaybookStatus;
  playbookSummary: string | null;
};

export type EventHorizonItem = InvestmentEvent & {
  tradingDaysAway: number;
  zone: EventHorizonZone;
  needsPlaybook: boolean;
};

export type EventHorizonSnapshot = {
  asOf: string;
  nearWindowTradingDays: number;
  items: EventHorizonItem[];
  missingPlaybookCount: number;
};

const shiftDate = (date: string, days: number): string => {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

export function tradingDaysFrom(asOf: string, scheduledDate: string): number {
  assertIsoDate(asOf);
  assertIsoDate(scheduledDate);
  if (asOf === scheduledDate) return 0;
  const direction = scheduledDate > asOf ? 1 : -1;
  let cursor = asOf;
  let count = 0;
  while (cursor !== scheduledDate) {
    cursor = shiftDate(cursor, direction);
    if (isTradingDay(cursor, NDX_CALENDAR)) count += direction;
  }
  return count;
}

export function buildEventHorizon(
  events: InvestmentEvent[],
  asOf: string,
  nearWindowTradingDays = 10,
): EventHorizonSnapshot {
  assertIsoDate(asOf);
  if (!Number.isInteger(nearWindowTradingDays) || nearWindowTradingDays < 1) {
    throw new Error("Event horizon near window must be a positive integer");
  }
  const ids = new Set<string>();
  const items = events.map((event) => {
    if (!event.id || ids.has(event.id)) throw new Error(`Duplicate or missing investment event id: ${event.id}`);
    ids.add(event.id);
    if (!event.title.trim() || event.title.length > 200) throw new Error("Investment event title must contain 1-200 characters");
    if (!INVESTMENT_EVENT_TYPES.includes(event.eventType)) throw new Error(`Unsupported investment event type: ${event.eventType}`);
    assertIsoDate(event.scheduledDate);
    const tradingDaysAway = tradingDaysFrom(asOf, event.scheduledDate);
    const zone: EventHorizonZone = tradingDaysAway < 0
      ? "past"
      : tradingDaysAway <= nearWindowTradingDays ? "near" : "far";
    return {
      ...event,
      tradingDaysAway,
      zone,
      needsPlaybook: zone === "near" && event.playbookStatus !== "ready",
    };
  }).sort((left, right) =>
    left.scheduledDate.localeCompare(right.scheduledDate)
    || left.title.localeCompare(right.title)
    || left.id.localeCompare(right.id));
  return {
    asOf,
    nearWindowTradingDays,
    items,
    missingPlaybookCount: items.filter((item) => item.needsPlaybook).length,
  };
}
