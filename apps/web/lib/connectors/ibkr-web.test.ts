import { describe, expect, it, vi } from "vitest";
import { checkIbkrReadOnlyConnection } from "./ibkr-web";

describe("IBKR read-only Web API connection", () => {
  it("stays explicitly unconfigured without contacting a broker", async () => {
    const fetchImpl = vi.fn();
    expect(await checkIbkrReadOnlyConnection({ fetchImpl, checkedAt: "2026-07-23T02:00:00Z" })).toEqual({
      provider: "ibkr",
      capability: "read_only",
      status: "not_configured",
      checkedAt: "2026-07-23T02:00:00Z",
      endpoint: null,
      session: null,
      reason: "IBKR_WEB_API_URL is not configured; historical Flex imports remain available.",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports an authenticated connection without exposing trading capability", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      connected: true, authenticated: true, competing: false,
    }), { status: 200 }));
    const result = await checkIbkrReadOnlyConnection({
      baseUrl: "https://127.0.0.1:5000/v1/api/",
      fetchImpl: fetchImpl as typeof fetch,
      checkedAt: "2026-07-23T02:00:00Z",
    });
    expect(fetchImpl).toHaveBeenCalledWith("https://127.0.0.1:5000/v1/api/iserver/auth/status", expect.objectContaining({ method: "GET" }));
    expect(result).toMatchObject({
      status: "connected",
      capability: "read_only",
      session: { connected: true, authenticated: true, competing: false },
    });
  });

  it("distinguishes an authentication timeout from an unreachable gateway", async () => {
    const authenticationRequired = await checkIbkrReadOnlyConnection({
      baseUrl: "https://127.0.0.1:5000/v1/api",
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({
        connected: true, authenticated: false, competing: false,
      }), { status: 200 })) as typeof fetch,
    });
    expect(authenticationRequired.status).toBe("authentication_required");

    const unavailable = await checkIbkrReadOnlyConnection({
      baseUrl: "https://127.0.0.1:5000/v1/api",
      fetchImpl: vi.fn(async () => { throw new Error("gateway offline"); }) as typeof fetch,
    });
    expect(unavailable).toMatchObject({ status: "unavailable", reason: "gateway offline" });
  });
});
