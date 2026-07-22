import { createHash } from "node:crypto";
import { assertCurrency, type Currency } from "../domain/conventions";
import { parseCsvRows } from "../server/csv";

type FlexRow = Record<string, string>;

export type FlexInstrument = {
  id: string;
  ticker: string;
  name: string;
  venue: string;
  currency: Currency;
};

export type FlexTrade = {
  externalId: string;
  instrumentId: string;
  effectiveAt: string;
  quantity: number;
  priceMinor: number;
  feeMinor: number;
  currency: Currency;
};

export type FlexCashFlow = {
  externalId: string;
  effectiveAt: string;
  kind: "deposit" | "withdrawal" | "dividend" | "fee" | "interest" | "transfer";
  amountMinor: number;
  currency: Currency;
};

export type ParsedFlexStatement = {
  contentHash: string;
  instruments: FlexInstrument[];
  trades: FlexTrade[];
  cashFlows: FlexCashFlow[];
  sourceCounts: Record<string, number>;
};

function value(row: FlexRow, ...keys: string[]): string {
  for (const key of keys) {
    const found = row[key];
    if (found != null && found.trim() !== "") return found.trim();
  }
  return "";
}

function required(row: FlexRow, label: string, ...keys: string[]): string {
  const found = value(row, ...keys);
  if (!found) throw new Error(`IBKR Flex row is missing ${label}`);
  return found;
}

function currency(row: FlexRow): Currency {
  const found = required(row, "currency", "CurrencyPrimary", "Currency").toUpperCase();
  assertCurrency(found);
  return found;
}

function decimal(valueToParse: string, label: string): number {
  const parsed = Number(valueToParse.replaceAll(",", ""));
  if (!Number.isFinite(parsed)) throw new Error(`Invalid IBKR Flex ${label}: ${valueToParse}`);
  return parsed;
}

function minorUnits(valueToParse: string, label: string): number {
  return Math.round(decimal(valueToParse || "0", label) * 100);
}

function effectiveAt(row: FlexRow): string {
  const raw = required(row, "effective time", "DateTime", "TradeDate", "SettleDate", "Date");
  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})(?:;(\d{2})(\d{2})(\d{2}))?$/);
  if (compact) {
    const [, year, month, day, hour = "00", minute = "00", second = "00"] = compact;
    const result = `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
    if (Number.isNaN(Date.parse(result))) throw new Error(`Invalid IBKR Flex effective time: ${raw}`);
    return result;
  }
  const isoDate = raw.match(/^\d{4}-\d{2}-\d{2}$/) ? `${raw}T00:00:00Z` : raw;
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.valueOf())) throw new Error(`Invalid IBKR Flex effective time: ${raw}`);
  return parsed.toISOString();
}

function externalId(row: FlexRow, prefix: string): string {
  const providerId = value(row, "TradeID", "TransactionID", "OrderID");
  if (providerId) return `IBKR:${prefix.toUpperCase()}:${providerId}`;
  const digest = createHash("sha256").update(JSON.stringify(row)).digest("hex").slice(0, 24);
  return `IBKR:${prefix.toUpperCase()}:${digest}`;
}

function sectionRows(text: string): Map<string, FlexRow[]> {
  const headers = new Map<string, string[]>();
  const sections = new Map<string, FlexRow[]>();
  for (const raw of parseCsvRows(text)) {
    const section = raw[0]?.replace(/^\uFEFF/, "").trim();
    const rowType = raw[1]?.trim();
    if (!section || !rowType) continue;
    if (rowType === "Header") {
      headers.set(section, raw.slice(2));
      continue;
    }
    if (rowType !== "Data") continue;
    const sectionHeaders = headers.get(section);
    if (!sectionHeaders) throw new Error(`IBKR Flex section has data before its header: ${section}`);
    const row = Object.fromEntries(sectionHeaders.map((header, index) => [header, raw[index + 2] ?? ""]));
    const current = sections.get(section) ?? [];
    current.push(row);
    sections.set(section, current);
  }
  return sections;
}

function cashKind(section: string, row: FlexRow, amountMinor: number): FlexCashFlow["kind"] {
  const descriptor = `${section} ${value(row, "Type", "Code", "Description", "ActivityDescription")}`.toLowerCase();
  if (descriptor.includes("dividend")) return "dividend";
  if (descriptor.includes("interest")) return "interest";
  if (descriptor.includes("commission") || descriptor.includes("fee") || descriptor.includes("withholding")) return "fee";
  if (descriptor.includes("transfer")) return "transfer";
  return amountMinor < 0 ? "withdrawal" : "deposit";
}

export function parseIbkrFlexStatement(text: string): ParsedFlexStatement {
  const sections = sectionRows(text);
  const instruments = new Map<string, FlexInstrument>();
  const trades: FlexTrade[] = [];
  const cashFlows: FlexCashFlow[] = [];

  for (const row of sections.get("Trades") ?? []) {
    const conid = required(row, "Conid", "Conid", "ConidEx");
    const instrumentCurrency = currency(row);
    const instrumentId = `IBKR:${conid}`;
    const rawQuantity = decimal(required(row, "quantity", "Quantity"), "quantity");
    const side = value(row, "Buy/Sell", "BuySell").toUpperCase();
    const quantity = side === "SELL" && rawQuantity > 0 ? -rawQuantity : side === "BUY" && rawQuantity < 0 ? -rawQuantity : rawQuantity;
    instruments.set(instrumentId, {
      id: instrumentId,
      ticker: required(row, "symbol", "Symbol"),
      name: value(row, "Description") || value(row, "Symbol"),
      venue: value(row, "ListingExchange", "Exchange") || "IBKR",
      currency: instrumentCurrency,
    });
    trades.push({
      externalId: externalId(row, "trade"),
      instrumentId,
      effectiveAt: effectiveAt(row),
      quantity,
      priceMinor: minorUnits(required(row, "trade price", "TradePrice", "Price"), "trade price"),
      feeMinor: Math.abs(minorUnits(value(row, "IBCommission", "Commission") || "0", "commission")),
      currency: instrumentCurrency,
    });
  }

  const cashSections = ["Cash Transactions", "Deposits & Withdrawals", "Dividends", "Interest Accruals"];
  for (const section of cashSections) {
    for (const row of sections.get(section) ?? []) {
      const amountMinor = minorUnits(required(row, "cash amount", "Amount", "NetCash"), "cash amount");
      cashFlows.push({
        externalId: externalId(row, "cash"),
        effectiveAt: effectiveAt(row),
        kind: cashKind(section, row, amountMinor),
        amountMinor,
        currency: currency(row),
      });
    }
  }

  const uniqueIds = new Set<string>();
  for (const item of [...trades, ...cashFlows]) {
    if (uniqueIds.has(item.externalId)) throw new Error(`Duplicate IBKR Flex external id: ${item.externalId}`);
    uniqueIds.add(item.externalId);
  }

  return {
    contentHash: createHash("sha256").update(text).digest("hex"),
    instruments: [...instruments.values()].sort((left, right) => left.id.localeCompare(right.id)),
    trades: trades.sort((left, right) => left.effectiveAt.localeCompare(right.effectiveAt)),
    cashFlows: cashFlows.sort((left, right) => left.effectiveAt.localeCompare(right.effectiveAt)),
    sourceCounts: Object.fromEntries([...sections.entries()].map(([section, rows]) => [section, rows.length])),
  };
}
