import { describe, expect, it } from "vitest";
import { validateException, validatePlaybook } from "./playbook";

describe("playbook", () => {
  it("requires both instrument and theme branches for ready earnings playbooks", () => {
    expect(() => validatePlaybook({
      eventType: "earnings", status: "ready", summary: "Quarterly plan", asOf: "2026-07-27",
      branches: [{ scope: "instrument", scenario: "miss", trigger: "EPS misses", action: "Reduce", riskDirection: "decrease" }],
    })).toThrow("instrument and theme");
  });

  it("accepts falsifiable branch triggers with explicit risk direction", () => {
    expect(validatePlaybook({
      eventType: "earnings", status: "ready", summary: "Quarterly plan", asOf: "2026-07-27",
      branches: [
        { scope: "instrument", scenario: "miss", trigger: "EPS misses", action: "Reduce", riskDirection: "decrease" },
        { scope: "theme", scenario: "thesis invalidated", trigger: "Industry demand contracts", action: "Downgrade group to QQQ", riskDirection: "decrease" },
      ],
    }).branches).toHaveLength(2);
  });

  it("requires a written waiver when the cooling delay is bypassed", () => {
    expect(() => validateException({
      uncoveredReason: "Novel event", logicChange: "Business model changed", action: "Reduce",
      decidedAt: "2026-07-27T12:00:00Z", executeAfter: "2026-07-27T11:00:00Z",
    })).toThrow("delay waiver");
  });
});
