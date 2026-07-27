export type AnalyticsHealth = {
  status: "ok";
  service: "epoch-analytics";
  version: string;
};

export type AnalyticsCalculationRequest = {
  contractVersion: "1.0";
  calculationId: string;
  calculationType: string;
  asOf: string;
  inputHash: string;
  codeVersion: string;
  strategyVersion?: string | null;
  parameterSetVersion?: string | null;
  payload: Record<string, unknown>;
};

export type AnalyticsCalculationResponse = {
  contractVersion: "1.0";
  calculationId: string;
  calculationType: string;
  asOf: string;
  inputHash: string;
  engineVersion: string;
  modelVersion: string;
  status: "succeeded" | "degraded" | "failed";
  output: Record<string, unknown>;
  diagnostics: Record<string, unknown>;
  warnings: string[];
  durationMs: number;
};

class NonRetryableAnalyticsError extends Error {}

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

function isCalculationResponse(body: unknown): body is AnalyticsCalculationResponse {
  if (typeof body !== "object" || body === null) return false;
  const value = body as Record<string, unknown>;
  return value.contractVersion === "1.0"
    && typeof value.calculationId === "string"
    && typeof value.calculationType === "string"
    && typeof value.asOf === "string"
    && typeof value.inputHash === "string"
    && typeof value.engineVersion === "string"
    && typeof value.modelVersion === "string"
    && ["succeeded", "degraded", "failed"].includes(String(value.status))
    && typeof value.output === "object" && value.output !== null
    && typeof value.diagnostics === "object" && value.diagnostics !== null
    && Array.isArray(value.warnings) && value.warnings.every((warning) => typeof warning === "string")
    && Number.isInteger(value.durationMs) && Number(value.durationMs) >= 0;
}

export async function runAnalyticsCalculation(
  request: AnalyticsCalculationRequest,
  options: { timeoutMilliseconds?: number; retries?: number } = {},
): Promise<AnalyticsCalculationResponse> {
  const timeoutMilliseconds = options.timeoutMilliseconds ?? 5_000;
  const retries = options.retries ?? 1;
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(`${analyticsUrl()}/v1/calculations/run`, {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(timeoutMilliseconds),
      });
      if (!response.ok) {
        const detail = await response.text();
        const error = new Error(`Analytics calculation returned HTTP ${response.status}: ${detail}`);
        if (response.status < 500) throw new NonRetryableAnalyticsError(error.message);
        if (attempt === retries) throw error;
        lastError = error;
        continue;
      }
      const body: unknown = await response.json();
      if (!isCalculationResponse(body)) throw new NonRetryableAnalyticsError("Analytics calculation response does not match the envelope contract");
      if (
        body.calculationId !== request.calculationId
        || body.calculationType !== request.calculationType
        || body.inputHash !== request.inputHash
      ) {
        throw new NonRetryableAnalyticsError("Analytics calculation response identity does not match the request");
      }
      return body;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (lastError instanceof NonRetryableAnalyticsError) throw lastError;
      if (attempt === retries) throw lastError;
    }
  }
  throw lastError ?? new Error("Analytics calculation failed");
}
