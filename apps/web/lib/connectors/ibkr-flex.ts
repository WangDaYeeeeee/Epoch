import { createHash } from "node:crypto";
import { assertCurrency, type Currency } from "../domain/conventions";
import { parseCsvRows } from "../server/csv";

type FlexRow = Record<string, string>;

const FLEX_SECTION_NAMES: Record<string, string> = {
  TRNT: "Trades",
  TRNS: "Trades",
  CTRN: "Cash Transactions",
  EQUT: "Net Asset Value (NAV) Summary in Base",
  EQUS: "Net Asset Value (NAV) Summary in Base",
  OPOS: "Open Positions",
  POST: "Open Positions",
};

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
  fxRateToBase: number | null;
};

export type FlexNavSnapshot = {
  accountId: string;
  date: string;
  nav: number;
  cash: number | null;
  currency: Currency;
};

export type FlexPositionSnapshot = {
  accountId: string;
  date: string;
  instrumentId: string;
  ticker: string;
  name: string;
  category: string;
  quantity: number;
  price: number;
  marketValue: number;
  currency: Currency;
  costBasis: number | null;
  baseCurrency: Currency;
  fxToBase: number;
  marketValueBase: number;
};

export type ParsedFlexStatement = {
  contentHash: string;
  instruments: FlexInstrument[];
  trades: FlexTrade[];
  cashFlows: FlexCashFlow[];
  navSnapshots: FlexNavSnapshot[];
  positionSnapshots: FlexPositionSnapshot[];
  sourceCounts: Record<string, number>;
};

export type ParseIbkrFlexOptions = {
  accountId?: string;
  fallbackDate?: string;
  baseCurrency?: Currency;
};

function value(row: FlexRow, ...keys: string[]): string {
  for (const key of keys) {
    const found = row[key];
    if (found != null && found.trim() !== "") return found.trim();
  }
  return "";
}

const normalizedKey = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, "");

function flexibleValue(row: FlexRow, ...keys: string[]): string {
  const wanted = new Set(keys.map(normalizedKey));
  const found = Object.entries(row).find(([key, candidate]) => wanted.has(normalizedKey(key)) && candidate.trim() !== "");
  return found?.[1]?.trim() ?? "";
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
  const raw = required(row, "effective time", "DateTime", "Date/Time", "TradeDate", "SettleDate", "Date");
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

function flexDate(raw: string): string | null {
  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  const candidate = compact ? `${compact[1]}-${compact[2]}-${compact[3]}` : raw.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(candidate) && !Number.isNaN(Date.parse(`${candidate}T00:00:00Z`))
    ? candidate
    : null;
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
    const first = raw[0]?.replace(/^\uFEFF/, "").trim();
    const second = raw[1]?.trim();
    const descriptorFirst = ["header", "data"].includes(first?.toLowerCase());
    const rawSection = descriptorFirst ? second : first;
    const section = FLEX_SECTION_NAMES[rawSection?.toUpperCase()] ?? rawSection;
    const rowType = (descriptorFirst ? first : second)?.toLowerCase();
    if (!section || !rowType) continue;
    if (rowType === "header") {
      headers.set(section, raw.slice(2));
      continue;
    }
    if (rowType !== "data") continue;
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

function positionCategory(assetClass: string): string {
  const normalized = assetClass.toUpperCase();
  if (["STK", "STOCK", "STOCKS"].includes(normalized)) return "stock";
  if (["ETF", "FUND", "MF"].includes(normalized)) return "fund";
  if (["OPT", "OPTION", "OPTIONS"].includes(normalized)) return "option";
  if (["FUT", "FUTURE", "FUTURES"].includes(normalized)) return "future";
  if (["BOND", "BONDS"].includes(normalized)) return "bond";
  return normalized.toLowerCase() || "unclassified";
}

export function parseIbkrFlexStatement(text: string, options: ParseIbkrFlexOptions = {}): ParsedFlexStatement {
  const sections = sectionRows(text);
  const instruments = new Map<string, FlexInstrument>();
  const trades: FlexTrade[] = [];
  const cashFlows: FlexCashFlow[] = [];
  const navSnapshots: FlexNavSnapshot[] = [];
  const positionSnapshots: FlexPositionSnapshot[] = [];

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
        fxRateToBase: flexibleValue(row, "FXRateToBase")
          ? decimal(flexibleValue(row, "FXRateToBase"), "FX rate to base")
          : null,
      });
    }
  }

  const statementDate = [...sections.values()].flatMap((rows) => rows)
    .map((row) => flexDate(flexibleValue(row, "ToDate", "ReportDate", "Date")))
    .find((candidate): candidate is string => candidate != null)
    ?? options.fallbackDate;
  const groupedPositions = new Map<string, FlexPositionSnapshot>();
  for (const row of sections.get("Open Positions") ?? []) {
    const date = flexDate(flexibleValue(row, "ReportDate", "Date")) ?? statementDate;
    if (!date) throw new Error("IBKR Flex Open Positions row is missing Report Date");
    const conid = required(row, "Open Positions Conid", "Conid", "ConidEx");
    const positionCurrency = currency(row);
    const baseCurrency = options.baseCurrency;
    if (!baseCurrency) throw new Error("IBKR Flex Open Positions import requires the account base currency");
    const rawFx = flexibleValue(row, "FXRateToBase");
    if (positionCurrency !== baseCurrency && !rawFx) {
      throw new Error("IBKR Flex Open Positions row is missing FX Rate to Base");
    }
    const fxToBase = rawFx ? decimal(rawFx, "position FX rate to base") : 1;
    const quantity = decimal(required(row, "position quantity", "Position", "Quantity"), "position quantity");
    const price = decimal(required(row, "mark price", "MarkPrice", "Mark Price", "ClosePrice"), "mark price");
    const marketValue = decimal(
      required(row, "position value", "PositionValue", "Position Value", "MarketValue"),
      "position value",
    );
    const rawCostBasis = flexibleValue(row, "CostBasisMoney", "Cost Basis Money", "CostBasis");
    const instrumentId = `IBKR:${conid}`;
    const ticker = required(row, "position symbol", "Symbol");
    const name = flexibleValue(row, "Description") || ticker;
    const key = `${date}|${instrumentId}`;
    const current = groupedPositions.get(key);
    if (current) {
      current.quantity += quantity;
      current.marketValue += marketValue;
      current.marketValueBase += marketValue * fxToBase;
      if (rawCostBasis) current.costBasis = (current.costBasis ?? 0) + decimal(rawCostBasis, "position cost basis");
      continue;
    }
    groupedPositions.set(key, {
      accountId: flexibleValue(row, "ClientAccountID", "AccountId", "Account ID", "Account") || options.accountId || "",
      date,
      instrumentId,
      ticker,
      name,
      category: positionCategory(flexibleValue(row, "AssetClass", "Asset Category", "AssetCategory")),
      quantity,
      price,
      marketValue,
      currency: positionCurrency,
      costBasis: rawCostBasis ? decimal(rawCostBasis, "position cost basis") : null,
      baseCurrency,
      fxToBase,
      marketValueBase: marketValue * fxToBase,
    });
    instruments.set(instrumentId, {
      id: instrumentId,
      ticker,
      name,
      venue: flexibleValue(row, "ListingExchange", "Listing Exchange", "Exchange") || "IBKR",
      currency: positionCurrency,
    });
  }
  positionSnapshots.push(...groupedPositions.values());
  for (const [section, rows] of sections) {
    if (!normalizedKey(section).includes("netassetvalue")) continue;
    const totalRows = rows.filter((row) => normalizedKey(flexibleValue(row, "AssetClass", "Category", "Type")) === "total");
    const candidates = totalRows.length ? totalRows : rows;
    const grouped = new Map<string, { nav: number; cash: number | null; currency: Currency; date: string }>();
    for (const row of candidates) {
      const rawNav = flexibleValue(
        row,
        "CurrentTotal",
        "CurrentTotalInBase",
        "EndingNAV",
        "EndingNetAssetValue",
        "EndingValue",
        "Total",
      );
      if (!rawNav) continue;
      const date = flexDate(flexibleValue(row, "ToDate", "ReportDate", "Date")) ?? statementDate;
      if (!date) continue;
      const accountId = flexibleValue(row, "ClientAccountID", "AccountId", "Account") || options.accountId;
      if (!accountId) continue;
      const rawCurrency = flexibleValue(row, "BaseCurrency", "Currency").toUpperCase();
      const resolvedCurrency = /^[A-Z]{3}$/.test(rawCurrency) ? rawCurrency : options.baseCurrency;
      if (!resolvedCurrency) continue;
      assertCurrency(resolvedCurrency);
      const key = `${accountId}|${date}|${resolvedCurrency}`;
      const current = grouped.get(key) ?? { nav: 0, cash: null, currency: resolvedCurrency, date };
      current.nav += decimal(rawNav, "NAV");
      grouped.set(key, current);
    }
    if (!totalRows.length) {
      for (const row of rows) {
        const wideCash = flexibleValue(row, "Cash");
        if (wideCash) {
          const date = flexDate(flexibleValue(row, "ToDate", "ReportDate", "Date")) ?? statementDate;
          const accountId = flexibleValue(row, "ClientAccountID", "AccountId", "Account") || options.accountId;
          const rawCurrency = flexibleValue(row, "BaseCurrency", "Currency").toUpperCase();
          const resolvedCurrency = /^[A-Z]{3}$/.test(rawCurrency) ? rawCurrency : options.baseCurrency;
          if (date && accountId && resolvedCurrency) {
            const current = grouped.get(`${accountId}|${date}|${resolvedCurrency}`);
            if (current) current.cash = decimal(wideCash, "cash NAV");
          }
        }
        if (normalizedKey(flexibleValue(row, "AssetClass", "Category", "Type")) !== "cash") continue;
        const rawCash = flexibleValue(row, "CurrentTotal", "CurrentTotalInBase", "EndingValue");
        const date = flexDate(flexibleValue(row, "ToDate", "ReportDate", "Date")) ?? statementDate;
        const accountId = flexibleValue(row, "ClientAccountID", "AccountId", "Account") || options.accountId;
        const rawCurrency = flexibleValue(row, "BaseCurrency", "Currency").toUpperCase();
        const resolvedCurrency = /^[A-Z]{3}$/.test(rawCurrency) ? rawCurrency : options.baseCurrency;
        if (!rawCash || !date || !accountId || !resolvedCurrency) continue;
        const current = grouped.get(`${accountId}|${date}|${resolvedCurrency}`);
        if (current) current.cash = decimal(rawCash, "cash NAV");
      }
    } else {
      const cashRow = rows.find((row) => normalizedKey(flexibleValue(row, "AssetClass", "Category", "Type")) === "cash");
      const rawCash = cashRow && flexibleValue(cashRow, "CurrentTotal", "CurrentTotalInBase", "EndingValue");
      if (cashRow && rawCash) {
        for (const current of grouped.values()) current.cash = decimal(rawCash, "cash NAV");
      }
    }
    for (const [key, snapshot] of grouped) {
      navSnapshots.push({
        accountId: key.split("|")[0],
        date: snapshot.date,
        nav: snapshot.nav,
        cash: snapshot.cash,
        currency: snapshot.currency,
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
    navSnapshots: navSnapshots.sort((left, right) => left.date.localeCompare(right.date)),
    positionSnapshots: positionSnapshots.sort((left, right) =>
      left.date.localeCompare(right.date) || left.instrumentId.localeCompare(right.instrumentId)),
    sourceCounts: Object.fromEntries([...sections.entries()].map(([section, rows]) => [section, rows.length])),
  };
}
