import { afterEach, describe, expect, it, vi } from "vitest";
import { analyticsUrl, getAnalyticsHealth } from "./analytics-client";

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
});
