import { afterEach, describe, expect, it, vi } from "vitest";
import { analyticsUrl, getAnalyticsHealth, runAnalyticsCalculation, type AnalyticsCalculationRequest } from "./analytics-client";

const calculationRequest: AnalyticsCalculationRequest = {
  contractVersion: "1.0",
  calculationId: "76cc25cc-ad83-426d-9494-b699f4825b6a",
  calculationType: "portfolio-risk",
  asOf: "2026-07-27T00:00:00Z",
  inputHash: "a".repeat(64),
  codeVersion: "test",
  payload: {},
};

const calculationResponse = {
  contractVersion: "1.0",
  calculationId: calculationRequest.calculationId,
  calculationType: calculationRequest.calculationType,
  asOf: calculationRequest.asOf,
  inputHash: calculationRequest.inputHash,
  engineVersion: "epoch-analytics@0.1.0",
  modelVersion: "portfolio-risk-gk@1.0.0",
  status: "degraded",
  output: { schemaVersion: "portfolio-risk-output/1.0" },
  diagnostics: {},
  warnings: ["fallback"],
  durationMs: 1,
};

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ANALYTICS_URL;
});

describe("analytics client", () => {
  it("normalizes the configured internal service URL", () => {
    process.env.ANALYTICS_URL = "http://analytics:8000/";
    expect(analyticsUrl()).toBe("http://analytics:8000");
  });

  it("accepts the versioned health response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: "ok",
      service: "epoch-analytics",
      version: "epoch-analytics@0.1.0",
    }), { status: 200 })));

    await expect(getAnalyticsHealth()).resolves.toEqual({
      status: "ok",
      service: "epoch-analytics",
      version: "epoch-analytics@0.1.0",
    });
  });

  it("rejects a malformed health response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "ok" }), { status: 200 })));
    await expect(getAnalyticsHealth()).rejects.toThrow("does not match");
  });

  it("runs a versioned calculation and verifies response identity", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(calculationResponse), { status: 200 })));
    await expect(runAnalyticsCalculation(calculationRequest)).resolves.toEqual(calculationResponse);
  });

  it("retries a server failure but does not retry a validation failure", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("temporary", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(calculationResponse), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(runAnalyticsCalculation(calculationRequest)).resolves.toEqual(calculationResponse);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockReset().mockResolvedValue(new Response("invalid", { status: 422 }));
    await expect(runAnalyticsCalculation(calculationRequest)).rejects.toThrow("HTTP 422");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a response belonging to another calculation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ...calculationResponse,
      inputHash: "b".repeat(64),
    }), { status: 200 })));
    await expect(runAnalyticsCalculation(calculationRequest, { retries: 0 })).rejects.toThrow("identity");
  });
});
