import { describe, expect, it } from "vitest";
import { buildEventHorizon, tradingDaysFrom, type InvestmentEvent } from "./event-horizon";

const event = (input: Partial<InvestmentEvent> = {}): InvestmentEvent => ({
  id: "event-1",
  title: "Quarterly earnings",
  instrumentId: "US:GOOGL",
  eventType: "earnings",
  scheduledDate: "2026-07-31",
  source: "manual",
  playbookStatus: "missing",
  playbookSummary: null,
  ...input,
});

describe("event horizon", () => {
  it("counts NDX trading days and excludes weekends", () => {
    expect(tradingDaysFrom("2026-07-24", "2026-07-27")).toBe(1);
    expect(tradingDaysFrom("2026-07-27", "2026-07-24")).toBe(-1);
  });

  it("raises a red flag for a near event without a ready playbook", () => {
    const result = buildEventHorizon([event()], "2026-07-27");
    expect(result.items[0]).toMatchObject({ tradingDaysAway: 4, zone: "near", needsPlaybook: true });
    expect(result.missingPlaybookCount).toBe(1);
  });

  it("does not flag a ready playbook or a far event", () => {
    const result = buildEventHorizon([
      event({ id: "ready", playbookStatus: "ready" }),
      event({ id: "far", scheduledDate: "2026-09-30" }),
    ], "2026-07-27");
    expect(result.items.map((item) => item.needsPlaybook)).toEqual([false, false]);
  });
});
