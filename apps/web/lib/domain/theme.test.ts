import { describe, expect, it } from "vitest";
import { validateThemeVersion } from "./theme";

describe("theme version", () => {
  it("requires a profit path and falsifiable invalidation condition", () => {
    expect(validateThemeVersion({
      asOf: "2026-07-27", phase: "deployment", thesis: "AI infrastructure expands",
      profitPath: "Capital expenditure converts to supplier earnings",
      invalidationCondition: "Orders contract for two quarters", confirmed: true,
    }).phase).toBe("deployment");
    expect(() => validateThemeVersion({
      asOf: "2026-07-27", phase: "installation", thesis: "Narrative only",
      profitPath: "", invalidationCondition: "x", confirmed: false,
    })).toThrow("profitPath");
  });
});
