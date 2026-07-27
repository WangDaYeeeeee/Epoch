import { describe, expect, it } from "vitest";
import { exitRestriction, validateCatalyst, validateInvalidationCondition } from "./position-governance";

describe("position governance", () => {
  it("requires a falsifiable catalyst window", () => {
    expect(validateCatalyst({
      title: "Quarterly earnings", expectedDate: "2026-08-01", validThrough: "2026-08-08",
      status: "planned", observableOutcome: "EPS guidance exceeds the stated threshold",
    }).validThrough).toBe("2026-08-08");
    expect(() => validateCatalyst({
      title: "x", expectedDate: "2026-08-08", validThrough: "2026-08-01",
      status: "planned", observableOutcome: "x",
    })).toThrow("cannot precede");
  });

  it("requires an observable invalidation trigger", () => {
    expect(() => validateInvalidationCondition({
      statement: "Demand thesis fails", observableMetric: "", trigger: "Orders fall",
    })).toThrow("observableMetric");
  });

  it("applies the 90-day restriction only to an active full exit", () => {
    expect(exitRestriction({ exitType: "active_exit", exitDate: "2026-07-27" }))
      .toEqual({ restricted: true, restrictedUntil: "2026-10-25" });
    expect(exitRestriction({ exitType: "risk_reduction", exitDate: "2026-07-27" }))
      .toEqual({ restricted: false, restrictedUntil: null });
  });
});
