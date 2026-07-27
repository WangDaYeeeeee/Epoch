import { describe, expect, it } from "vitest";
import { dailySignedSemivariances, validateIntradayBar, validateOptionSignal } from "./market-signal";

describe("market signal contracts", () => {
  it("accepts a bounded provider-neutral intraday bar", () => {
    expect(validateIntradayBar({
      instrumentId: "QQQ", timestamp: "2026-07-27T14:30:00Z",
      open: 550, high: 552, low: 549, close: 551, volume: 1200,
      provider: "fixture", observedAt: "2026-07-27T14:31:00Z",
    }).instrumentId).toBe("QQQ");
  });

  it("rejects malformed high/low bounds", () => {
    expect(() => validateIntradayBar({
      instrumentId: "QQQ", timestamp: "2026-07-27T14:30:00Z",
      open: 550, high: 548, low: 549, close: 551, volume: 1200,
      provider: "fixture", observedAt: "2026-07-27T14:31:00Z",
    })).toThrow("bounds");
  });

  it("requires at least one usable option signal", () => {
    expect(() => validateOptionSignal({
      instrumentId: "QQQ", asOf: "2026-07-27T20:00:00Z",
      iv30: null, putSkew25d30: null, provider: "fixture",
      quality: "derived", observedAt: "2026-07-27T20:01:00Z",
    })).toThrow("no usable value");
  });

  it("derives strict daily RS+, RS- and signed jump from ordered minute closes", () => {
    const base = {
      instrumentId: "US:QQQ", open: 100, high: 102, low: 98,
      volume: 100, provider: "fixture", observedAt: "2026-07-27T20:01:00Z",
    };
    const [result] = dailySignedSemivariances([
      { ...base, timestamp: "2026-07-27T13:32:00Z", close: 99 },
      { ...base, timestamp: "2026-07-27T13:30:00Z", close: 100 },
      { ...base, timestamp: "2026-07-27T13:31:00Z", close: 101 },
    ]);
    const up = Math.log(101 / 100) ** 2;
    const down = Math.log(99 / 101) ** 2;
    expect(result.positiveSemivariance).toBeCloseTo(up);
    expect(result.negativeSemivariance).toBeCloseTo(down);
    expect(result.signedJump).toBeCloseTo(up - down);
    expect(result.returnObservations).toBe(2);
  });
});
