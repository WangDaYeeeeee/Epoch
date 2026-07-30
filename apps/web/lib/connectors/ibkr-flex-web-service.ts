const DEFAULT_BASE_URL = "https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService";
const TRANSIENT_CODES = new Set(["1001", "1003", "1004", "1005", "1006", "1007", "1008", "1009", "1019", "1021"]);

type FetchLike = typeof fetch;

export type IbkrFlexWebServiceConfig = {
  token: string;
  queryId: string;
  baseUrl?: string;
  userAgent?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
};

export type IbkrFlexReport = {
  referenceCode: string;
  text: string;
  contentType: string;
};

type FlexStatus = {
  status: string;
  referenceCode?: string;
  errorCode?: string;
  errorMessage?: string;
};

function xmlValue(xml: string, tag: string): string | undefined {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"));
  return match?.[1]?.replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">").trim();
}

function parseStatus(xml: string): FlexStatus | null {
  if (!/<FlexStatementResponse\b/i.test(xml)) return null;
  return {
    status: xmlValue(xml, "Status") ?? "",
    referenceCode: xmlValue(xml, "ReferenceCode"),
    errorCode: xmlValue(xml, "ErrorCode"),
    errorMessage: xmlValue(xml, "ErrorMessage"),
  };
}

function flexError(status: FlexStatus, stage: string): Error {
  const code = status.errorCode ? ` ${status.errorCode}` : "";
  const message = status.errorMessage ?? "unknown Flex Web Service error";
  return new Error(`IBKR Flex ${stage} failed${code}: ${message}`);
}

const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export async function fetchIbkrFlexReport(
  config: IbkrFlexWebServiceConfig,
  dependencies: { fetchImpl?: FetchLike; sleep?: (milliseconds: number) => Promise<void> } = {},
): Promise<IbkrFlexReport> {
  if (!config.token.trim()) throw new Error("IBKR_FLEX_TOKEN is required");
  if (!config.queryId.trim()) throw new Error("IBKR_FLEX_QUERY_ID is required");
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const sleep = dependencies.sleep ?? wait;
  const baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const headers = {
    accept: "text/csv, application/xml, text/xml, text/plain",
    "user-agent": config.userAgent?.trim() || "Epoch/0.1 IBKR-Flex-ReadOnly",
  };
  const request = async (path: string, params: Record<string, string>) => {
    const url = new URL(`${baseUrl}/${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const response = await fetchImpl(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(config.timeoutMs ?? 30_000),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`IBKR Flex ${path} returned HTTP ${response.status}`);
    return { text, contentType: response.headers.get("content-type") ?? "" };
  };

  const generated = await request("SendRequest", { t: config.token, q: config.queryId, v: "3" });
  const generatedStatus = parseStatus(generated.text);
  if (!generatedStatus || generatedStatus.status.toLowerCase() !== "success" || !generatedStatus.referenceCode) {
    throw generatedStatus ? flexError(generatedStatus, "SendRequest") : new Error("IBKR Flex SendRequest returned an invalid response");
  }

  const attempts = config.maxPollAttempts ?? 8;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (attempt > 1) await sleep(config.pollIntervalMs ?? 10_000);
    const retrieved = await request("GetStatement", { t: config.token, q: generatedStatus.referenceCode, v: "3" });
    const retrievedStatus = parseStatus(retrieved.text);
    if (!retrievedStatus) {
      if (!retrieved.text.trim()) throw new Error("IBKR Flex GetStatement returned an empty report");
      return {
        referenceCode: generatedStatus.referenceCode,
        text: retrieved.text,
        contentType: retrieved.contentType,
      };
    }
    if (retrievedStatus.status.toLowerCase() === "success") {
      throw new Error("IBKR Flex GetStatement returned success metadata without a report");
    }
    if (!retrievedStatus.errorCode || !TRANSIENT_CODES.has(retrievedStatus.errorCode) || attempt === attempts) {
      throw flexError(retrievedStatus, "GetStatement");
    }
  }
  throw new Error("IBKR Flex report was not ready before the polling deadline");
}
