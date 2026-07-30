import { describe, expect, it } from "vitest";
import {
  deckStackOrder,
  dockCardScale,
  dockCardShift,
  dockHoverIndex,
  effectiveHoldingCount,
  sortRiskCardsByWeight,
} from "./risk-instrument-details";

describe("effectiveHoldingCount", () => {
  it("equals the actual count for equal contributions", () => {
    expect(effectiveHoldingCount([0.25, 0.25, 0.25, 0.25])).toBe(4);
  });

  it("reveals concentration and prevents negative contributions from cancelling", () => {
    expect(effectiveHoldingCount([0.8, 0.1, 0.1])).toBeCloseTo(1.515, 3);
    expect(effectiveHoldingCount([0.5, -0.5])).toBe(2);
  });

  it("returns unavailable when there is no effective exposure", () => {
    expect(effectiveHoldingCount([0, Number.NaN])).toBeNull();
  });
});

describe("dock card magnification", () => {
  it("keeps the idle cards small and magnifies the hovered card and its neighbors", () => {
    expect(dockCardScale(null)).toBe(0.72);
    expect(dockCardScale(0)).toBe(1.16);
    expect(dockCardScale(-1)).toBe(0.82);
    expect(dockCardScale(2)).toBe(0.72);
  });

  it("moves the surrounding cards away from the hovered card", () => {
    expect(dockCardShift(-1)).toBe(-46);
    expect(dockCardShift(0)).toBe(0);
    expect(dockCardShift(3)).toBe(46);
  });

  it("selects a stable nearest slot without following the animated cards", () => {
    expect(dockHoverIndex(450, 900, 5)).toBe(2);
    expect(dockHoverIndex(300, 900, 5)).toBe(1);
    expect(dockHoverIndex(20, 900, 5)).toBe(-1);
  });
});

describe("deckStackOrder", () => {
  it("places every card to the right above the card immediately to its left", () => {
    expect([0, 1, 2, 3, 4].map((offset) => deckStackOrder(offset, 5))).toEqual([5, 6, 7, 8, 9]);
  });
});

describe("sortRiskCardsByWeight", () => {
  it("orders cards from the largest portfolio weight to the smallest", () => {
    const cards = [{ id: "MU", weight: 0.12 }, { id: "TSM", weight: 0.28 }, { id: "KLAC", weight: 0.15 }];
    expect(sortRiskCardsByWeight(cards).map((card) => card.id)).toEqual(["TSM", "KLAC", "MU"]);
  });
});
