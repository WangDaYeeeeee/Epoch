import { describe, expect, it } from "vitest";
import { memoryMatchScore, normalizeMemoryQuery } from "./research-memory";

describe("research memory query", () => {
  it("normalizes, deduplicates and bounds search tokens", () => {
    expect(normalizeMemoryQuery("  AI   Demand ai  ")).toEqual(["ai", "demand"]);
  });

  it("rejects empty and oversized queries", () => {
    expect(() => normalizeMemoryQuery("x")).toThrow("at least 2");
    expect(() => normalizeMemoryQuery("a".repeat(201))).toThrow("200");
  });

  it("scores results by matched token coverage", () => {
    expect(memoryMatchScore("AI infrastructure demand", ["ai", "margin", "demand"])).toBeCloseTo(2 / 3);
  });
});
