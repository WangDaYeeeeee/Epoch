import { describe, expect, it } from "vitest";
import { NDX_CALENDAR, isTradingDay, previousTradingDay } from "./calendar";
import { assertCurrency, assertIsoDate, parseInstrumentId } from "./conventions";

describe("Epoch data conventions", () => {
  it("parses stable venue-qualified instrument identifiers", () => {
    expect(parseInstrumentId("XNAS:GOOGL")).toEqual({ venue: "XNAS", localId: "GOOGL" });
    expect(parseInstrumentId("CASH:USD")).toEqual({ venue: "CASH", localId: "USD" });
    expect(() => parseInstrumentId("GOOGL")).toThrow("Invalid instrument id");
  });

  it("validates currencies and calendar dates", () => {
    expect(() => assertCurrency("USD")).not.toThrow();
    expect(() => assertCurrency("EUR")).toThrow("Unsupported currency");
    expect(() => assertIsoDate("2026-02-29")).toThrow("Invalid ISO date");
  });

  it("uses an explicit benchmark trading calendar", () => {
    expect(isTradingDay("2026-07-02", NDX_CALENDAR)).toBe(true);
    expect(isTradingDay("2026-07-03", NDX_CALENDAR)).toBe(false);
    expect(isTradingDay("2026-07-04", NDX_CALENDAR)).toBe(false);
    expect(previousTradingDay("2026-07-06", NDX_CALENDAR)).toBe("2026-07-02");
  });
});
