export type IbkrConnectionStatus = {
  provider: "ibkr";
  capability: "read_only";
  status: "not_configured" | "connected" | "authentication_required" | "unavailable";
  checkedAt: string;
  endpoint: string | null;
  session: {
    connected: boolean;
    authenticated: boolean;
    competing: boolean;
  } | null;
  reason: string;
};

type FetchLike = typeof fetch;

export async function checkIbkrReadOnlyConnection(input: {
  baseUrl?: string;
  fetchImpl?: FetchLike;
  checkedAt?: string;
  timeoutMs?: number;
} = {}): Promise<IbkrConnectionStatus> {
  const checkedAt = input.checkedAt ?? new Date().toISOString();
  const baseUrl = input.baseUrl?.replace(/\/+$/, "");
  if (!baseUrl) {
    return {
      provider: "ibkr",
      capability: "read_only",
      status: "not_configured",
      checkedAt,
      endpoint: null,
      session: null,
      reason: "IBKR_WEB_API_URL is not configured; historical Flex imports remain available.",
    };
  }

  const endpoint = `${baseUrl}/iserver/auth/status`;
  try {
    const response = await (input.fetchImpl ?? fetch)(endpoint, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(input.timeoutMs ?? 3_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json() as { connected?: boolean; authenticated?: boolean; competing?: boolean };
    const session = {
      connected: payload.connected === true,
      authenticated: payload.authenticated === true,
      competing: payload.competing === true,
    };
    return {
      provider: "ibkr",
      capability: "read_only",
      status: session.connected && session.authenticated ? "connected" : "authentication_required",
      checkedAt,
      endpoint,
      session,
      reason: session.connected && session.authenticated
        ? "IBKR session is connected and authenticated; Epoch remains read-only."
        : "IBKR gateway is reachable but the brokerage session is not fully authenticated.",
    };
  } catch (error) {
    return {
      provider: "ibkr",
      capability: "read_only",
      status: "unavailable",
      checkedAt,
      endpoint,
      session: null,
      reason: error instanceof Error ? error.message : "Unknown IBKR connection error",
    };
  }
}
