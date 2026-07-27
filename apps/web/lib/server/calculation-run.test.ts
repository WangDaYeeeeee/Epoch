import { describe, expect, it } from "vitest";
import { calculationInputHash, createCalculationRequest } from "./calculation-run";

describe("calculation run snapshots", () => {
  it("hashes semantically identical object keys deterministically", () => {
    expect(calculationInputHash({ b: 2, a: { d: 4, c: 3 } }))
      .toBe(calculationInputHash({ a: { c: 3, d: 4 }, b: 2 }));
  });

  it("creates a versioned request whose hash covers the immutable payload", () => {
    const request = createCalculationRequest({
      calculationType: "portfolio-risk",
      asOf: "2026-07-16T00:00:00Z",
      codeVersion: "test",
      strategyVersion: "epoch-satellite-v0.1.0",
      parameterSetVersion: "default-draft-v0.1.0",
      payload: { schemaVersion: "portfolio-risk-input/1.0" },
    });
    expect(request).toMatchObject({
      contractVersion: "1.0",
      calculationType: "portfolio-risk",
      inputHash: calculationInputHash(request.payload),
    });
    expect(request.calculationId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
