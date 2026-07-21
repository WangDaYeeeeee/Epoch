export type AnalyticsHealth = {
  status: "ok";
  service: "epoch-analytics";
  version: string;
};

export function analyticsUrl(): string {
  return (process.env.ANALYTICS_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");
}

export async function getAnalyticsHealth(timeoutMilliseconds = 2_000): Promise<AnalyticsHealth> {
  const response = await fetch(`${analyticsUrl()}/health`, {
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMilliseconds),
  });
  if (!response.ok) throw new Error(`Analytics health check returned HTTP ${response.status}`);

  const body: unknown = await response.json();
  if (
    typeof body !== "object" || body === null ||
    (body as Record<string, unknown>).status !== "ok" ||
    (body as Record<string, unknown>).service !== "epoch-analytics" ||
    typeof (body as Record<string, unknown>).version !== "string"
  ) {
    throw new Error("Analytics health response does not match the service contract");
  }
  return body as AnalyticsHealth;
}
