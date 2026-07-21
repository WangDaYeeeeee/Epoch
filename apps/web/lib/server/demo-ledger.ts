import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { calculateDailyLedger, type LedgerCashFlow, type LedgerTrade, type PriceObservation } from "../domain/ledger";
import { parseCsv } from "./csv";

const instrumentIds: Record<string, string> = {
  NVDA: "XNAS:NVDA", AVGO: "XNAS:AVGO", MSFT: "XNAS:MSFT", TSM: "XNYS:TSM", ".NDX": "INDEX:.NDX",
};

function cents(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid money value: ${value}`);
  return Math.round(parsed * 100);
}

export function resolveDemoRoot(): string {
  const candidates = [resolve(process.cwd(), "data/demo"), resolve(process.cwd(), "../../data/demo")];
  const found = candidates.find((candidate) => existsSync(resolve(candidate, "trades.csv")));
  if (!found) throw new Error("Demo data directory is unavailable");
  return found;
}

export function calculateDemoLedger(root = resolveDemoRoot()) {
  const rows = (name: string) => parseCsv(readFileSync(resolve(root, name), "utf8"));
  const trades: LedgerTrade[] = rows("trades.csv").map((row) => ({
    externalId: row.external_id,
    date: row.date,
    instrumentId: instrumentIds[row.symbol] ?? `UNKNOWN:${row.symbol}`,
    quantity: Number(row.quantity),
    priceCents: cents(row.price),
    feeCents: cents(row.fee),
    currency: "USD",
  }));
  const flows: LedgerCashFlow[] = rows("cash_flows.csv").map((row) => ({
    externalId: row.external_id,
    date: row.date,
    kind: row.kind as LedgerCashFlow["kind"],
    amountCents: cents(row.amount),
    currency: "USD",
  }));
  const prices: PriceObservation[] = rows("prices.csv").map((row) => ({
    date: row.date,
    instrumentId: instrumentIds[row.symbol] ?? `UNKNOWN:${row.symbol}`,
    closeCents: cents(row.close),
    currency: "USD",
  }));
  return calculateDailyLedger({ trades, flows, prices, benchmark: "INDEX:.NDX" });
}
