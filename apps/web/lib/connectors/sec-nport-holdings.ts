import { createHash } from "node:crypto";
import {
  validateFundHoldingsSnapshot,
  type EtfHoldingsProvider,
  type FundHolding,
  type FundHoldingsSnapshot,
} from "../domain/fund-holdings";
import { canonicalMarketInstrumentId } from "../domain/market-data";

type SecFundIdentity = {
  cik: string;
  seriesId: string;
};

type SecSubmissions = {
  filings?: {
    recent?: {
      accessionNumber?: string[];
      filingDate?: string[];
      reportDate?: string[];
      form?: string[];
      primaryDocument?: string[];
    };
  };
};

export const SEC_FUND_IDENTITIES: Record<string, SecFundIdentity> = {
  "US:SOXX": { cik: "1100663", seriesId: "S000004354" },
};

const xmlText = (xml: string, tag: string): string => {
  const match = xml.match(new RegExp(`<(?:[A-Za-z0-9_-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_-]+:)?${tag}>`, "i"));
  return match?.[1]?.replace(/<[^>]+>/g, "").trim() ?? "";
};

const xmlAttribute = (xml: string, tag: string, attribute: string): string => {
  const match = xml.match(new RegExp(`<(?:[A-Za-z0-9_-]+:)?${tag}\\b[^>]*\\b${attribute}=["']([^"']+)["'][^>]*\\/?>`, "i"));
  return match?.[1]?.trim() ?? "";
};

const decimal = (raw: string): number | undefined => {
  if (!raw) return undefined;
  const parsed = Number(raw.replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : undefined;
};

export function parseSecNportHoldings(input: {
  xml: string;
  fundInstrumentId: string;
  expectedSeriesId: string;
  observedAt: string;
}): FundHoldingsSnapshot {
  const seriesId = xmlText(input.xml, "seriesId");
  if (seriesId !== input.expectedSeriesId) {
    throw new Error(`SEC N-PORT series mismatch: expected ${input.expectedSeriesId}, received ${seriesId || "missing"}`);
  }
  const asOf = xmlText(input.xml, "repPdDate") || xmlText(input.xml, "reportDate");
  const blocks = [...input.xml.matchAll(/<(?:[A-Za-z0-9_-]+:)?invstOrSec\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_-]+:)?invstOrSec>/gi)]
    .map((match) => match[1]);
  const holdings: FundHolding[] = blocks.flatMap((block) => {
    const ticker = xmlAttribute(block, "ticker", "value") || xmlText(block, "ticker");
    const percentage = decimal(xmlText(block, "pctVal"));
    if (!ticker || percentage == null || percentage <= 0) return [];
    return [{
      constituentInstrumentId: canonicalMarketInstrumentId(ticker.includes(":") ? ticker : `US:${ticker}`),
      name: xmlText(block, "name") || xmlText(block, "title") || ticker,
      weight: percentage / 100,
      shares: decimal(xmlText(block, "balance")),
      marketValue: decimal(xmlText(block, "valUSD")),
    }];
  });
  return validateFundHoldingsSnapshot({
    fundInstrumentId: canonicalMarketInstrumentId(input.fundInstrumentId),
    asOf,
    observedAt: input.observedAt,
    provider: "sec_nport",
    sourceHash: createHash("sha256").update(input.xml).digest("hex"),
    holdings,
  });
}

export class SecNportEtfHoldingsProvider implements EtfHoldingsProvider {
  readonly id = "sec_nport";

  constructor(
    private readonly userAgent: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly identities: Record<string, SecFundIdentity> = SEC_FUND_IDENTITIES,
    private readonly maximumCandidateFilings = 100,
  ) {
    if (!userAgent.trim()) throw new Error("SEC_USER_AGENT is required for SEC fair-access identification");
  }

  private async get(url: string): Promise<Response> {
    const response = await this.fetchImpl(url, {
      headers: { "user-agent": this.userAgent, accept: "application/json, application/xml;q=0.9" },
    });
    if (!response.ok) throw new Error(`SEC EDGAR request failed: HTTP ${response.status}`);
    return response;
  }

  async fetchHoldings(fundInstrumentId: string, asOf?: string): Promise<FundHoldingsSnapshot> {
    const canonicalFundId = canonicalMarketInstrumentId(fundInstrumentId);
    const identity = this.identities[canonicalFundId];
    if (!identity) throw new Error(`SEC N-PORT identity is not configured for ${canonicalFundId}`);
    const paddedCik = identity.cik.padStart(10, "0");
    const submissionsResponse = await this.get(`https://data.sec.gov/submissions/CIK${paddedCik}.json`);
    const submissions = await submissionsResponse.json() as SecSubmissions;
    const recent = submissions.filings?.recent;
    const candidates = (recent?.accessionNumber ?? []).map((accessionNumber, index) => ({
      accessionNumber,
      filingDate: recent?.filingDate?.[index] ?? "",
      reportDate: recent?.reportDate?.[index] ?? "",
      form: recent?.form?.[index] ?? "",
      primaryDocument: recent?.primaryDocument?.[index] ?? "",
    })).filter((filing) =>
      ["NPORT-P", "NPORT-P/A"].includes(filing.form)
      && filing.primaryDocument
      && (!asOf || filing.reportDate <= asOf))
      .sort((left, right) => right.reportDate.localeCompare(left.reportDate) || right.filingDate.localeCompare(left.filingDate))
      .slice(0, this.maximumCandidateFilings);

    for (const filing of candidates) {
      const accessionPath = filing.accessionNumber.replaceAll("-", "");
      const url = `https://www.sec.gov/Archives/edgar/data/${Number(identity.cik)}/${accessionPath}/${filing.primaryDocument}`;
      const xmlResponse = await this.get(url);
      const xml = await xmlResponse.text();
      if (xmlText(xml, "seriesId") !== identity.seriesId) continue;
      return parseSecNportHoldings({
        xml,
        fundInstrumentId: canonicalFundId,
        expectedSeriesId: identity.seriesId,
        observedAt: `${filing.filingDate}T00:00:00Z`,
      });
    }
    throw new Error(`No matching public SEC N-PORT filing is available for ${canonicalFundId}${asOf ? ` as of ${asOf}` : ""}`);
  }
}
