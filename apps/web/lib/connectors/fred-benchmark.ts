export type FredObservation = { date: string; close: number };

export type FredBenchmarkConfig = {
  seriesId?: string;
  baseUrl?: string;
  startDate: string;
  endDate: string;
  timeoutMs?: number;
};

export function parseFredCsv(text: string, seriesId = "NASDAQ100"): FredObservation[] {
  const lines = text.trim().split(/\r?\n/);
  if (!lines.length) return [];
  const headers = lines[0].split(",").map((value) => value.trim());
  const dateIndex = headers.findIndex((value) => ["DATE", "observation_date"].includes(value));
  const valueIndex = headers.indexOf(seriesId);
  if (dateIndex < 0 || valueIndex < 0) {
    throw new Error(`FRED CSV is missing DATE and ${seriesId} columns`);
  }
  return lines.slice(1).flatMap((line) => {
    const values = line.split(",").map((value) => value.trim());
    const close = Number(values[valueIndex]);
    return /^\d{4}-\d{2}-\d{2}$/.test(values[dateIndex] ?? "") && Number.isFinite(close) && close > 0
      ? [{ date: values[dateIndex], close }]
      : [];
  });
}

export async function fetchFredBenchmark(
  config: FredBenchmarkConfig,
  dependencies: { fetchImpl?: typeof fetch } = {},
): Promise<FredObservation[]> {
  const seriesId = config.seriesId ?? "NASDAQ100";
  const baseUrl = config.baseUrl ?? "https://fred.stlouisfed.org/graph/fredgraph.csv";
  const url = new URL(baseUrl);
  url.searchParams.set("id", seriesId);
  url.searchParams.set("cosd", config.startDate);
  url.searchParams.set("coed", config.endDate);
  const response = await (dependencies.fetchImpl ?? fetch)(url, {
    headers: { "user-agent": "Epoch benchmark synchronization" },
    signal: AbortSignal.timeout(config.timeoutMs ?? 30_000),
  });
  if (!response.ok) throw new Error(`FRED ${seriesId} request failed with HTTP ${response.status}`);
  const observations = parseFredCsv(await response.text(), seriesId);
  if (!observations.length) throw new Error(`FRED ${seriesId} response has no observations`);
  return observations;
}
