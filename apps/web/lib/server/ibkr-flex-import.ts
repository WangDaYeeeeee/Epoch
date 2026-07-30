import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Sql } from "postgres";
import { parseIbkrFlexStatement } from "../connectors/ibkr-flex";

export type FlexImportResult = {
  rawImportId: string;
  contentHash: string;
  duplicateStatement: boolean;
  inserted: { instruments: number; trades: number; cashFlows: number };
  navSnapshotsInserted: number;
  positionSnapshotsInserted: number;
};

function persistRawStatement(text: string, contentHash: string, rawRoot: string): string {
  const directory = resolve(rawRoot, "ibkr-flex");
  const objectPath = resolve(directory, `${contentHash}.csv`);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    writeFileSync(objectPath, text, { encoding: "utf8", flag: "wx", mode: 0o600 });
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    const existingHash = createHash("sha256").update(readFileSync(objectPath)).digest("hex");
    if (existingHash !== contentHash) throw new Error(`Immutable raw object hash mismatch: ${objectPath}`);
  }
  return objectPath;
}

export function resolveRawDataRoot(): string {
  return process.env.EPOCH_RAW_ROOT ?? resolve(process.cwd(), process.cwd().endsWith("apps/web") ? "../../data/raw" : "data/raw");
}

export async function importIbkrFlexStatement(sql: Sql, input: {
  accountId: string;
  sourceId: string;
  text: string;
  observedAt?: Date;
  rawRoot?: string;
  fallbackDate?: string;
}): Promise<FlexImportResult> {
  if (!input.sourceId.trim()) throw new Error("IBKR Flex source id is required");
  const [accountConfiguration] = await sql<{ base_currency: string }[]>`
    SELECT base_currency FROM account
    WHERE id = ${input.accountId} AND provider = 'ibkr' AND is_read_only = true
  `;
  if (!accountConfiguration) throw new Error(`Unknown or non-read-only IBKR account: ${input.accountId}`);
  const parsed = parseIbkrFlexStatement(input.text, {
    accountId: input.accountId,
    fallbackDate: input.fallbackDate,
    baseCurrency: accountConfiguration.base_currency as "USD" | "KRW" | "HKD" | "CNY",
  });
  const objectPath = persistRawStatement(input.text, parsed.contentHash, input.rawRoot ?? resolveRawDataRoot());
  const observedAt = input.observedAt ?? new Date();

  return sql.begin(async (transaction) => {
    const [account] = await transaction<{ provider: string; is_read_only: boolean }[]>`
      SELECT provider, is_read_only FROM account WHERE id = ${input.accountId}
    `;
    if (!account) throw new Error(`Unknown account: ${input.accountId}`);
    if (account.provider !== "ibkr") throw new Error(`Account is not an IBKR account: ${input.accountId}`);
    if (!account.is_read_only) throw new Error(`IBKR account must remain read-only: ${input.accountId}`);

    const candidateId = randomUUID();
    const insertedRaw = await transaction<{ id: string }[]>`
      INSERT INTO raw_import (id, source, source_id, content_hash, observed_at, object_path)
      VALUES (${candidateId}, 'ibkr_flex', ${input.sourceId}, ${parsed.contentHash}, ${observedAt}, ${objectPath})
      ON CONFLICT (source, source_id, content_hash) DO NOTHING
      RETURNING id
    `;
    if (!insertedRaw.length) {
      const [existing] = await transaction<{ id: string }[]>`
        SELECT id FROM raw_import
        WHERE source = 'ibkr_flex' AND source_id = ${input.sourceId} AND content_hash = ${parsed.contentHash}
      `;
      if (!existing) throw new Error("Unable to resolve duplicate IBKR Flex import");
      return {
        rawImportId: existing.id,
        contentHash: parsed.contentHash,
        duplicateStatement: true,
        inserted: { instruments: 0, trades: 0, cashFlows: 0 },
        navSnapshotsInserted: 0,
        positionSnapshotsInserted: 0,
      };
    }

    let insertedInstruments = 0;
    for (const instrument of parsed.instruments) {
      const rows = await transaction`
        INSERT INTO instrument (id, ticker, name, venue, currency)
        VALUES (${instrument.id}, ${instrument.ticker}, ${instrument.name}, ${instrument.venue}, ${instrument.currency})
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      `;
      insertedInstruments += rows.length;
    }

    let insertedTrades = 0;
    for (const trade of parsed.trades) {
      const rows = await transaction`
        INSERT INTO ledger_transaction (
          external_id, account_id, instrument_id, effective_at, quantity,
          price_minor, fee_minor, currency, raw_import_id
        ) VALUES (
          ${trade.externalId}, ${input.accountId}, ${trade.instrumentId}, ${trade.effectiveAt}, ${trade.quantity},
          ${trade.priceMinor}, ${trade.feeMinor}, ${trade.currency}, ${insertedRaw[0].id}
        )
        ON CONFLICT (external_id) DO NOTHING
        RETURNING external_id
      `;
      insertedTrades += rows.length;
    }

    let insertedCashFlows = 0;
    for (const flow of parsed.cashFlows) {
      const rows = await transaction`
        INSERT INTO cash_flow (
          external_id, account_id, effective_at, kind, amount_minor, currency,
          fx_rate_to_base, raw_import_id
        ) VALUES (
          ${flow.externalId}, ${input.accountId}, ${flow.effectiveAt}, ${flow.kind},
          ${flow.amountMinor}, ${flow.currency}, ${flow.fxRateToBase}, ${insertedRaw[0].id}
        )
        ON CONFLICT (external_id) DO NOTHING
        RETURNING external_id
      `;
      insertedCashFlows += rows.length;
    }

    let navSnapshotsInserted = 0;
    const reportedNavAccounts = new Set(parsed.navSnapshots.map((snapshot) => snapshot.accountId));
    if (reportedNavAccounts.size > 1) {
      throw new Error("IBKR Flex import must contain exactly one account when Net Asset Value is enabled");
    }
    for (const snapshot of parsed.navSnapshots) {
      const rows = await transaction`
        INSERT INTO ibkr_account_nav_snapshot (
          raw_import_id, account_id, snapshot_date, nav, cash, currency, source, observed_at
        ) VALUES (
          ${insertedRaw[0].id}, ${input.accountId}, ${snapshot.date}, ${snapshot.nav},
          ${snapshot.cash}, ${snapshot.currency}, ${`ibkr_flex:${input.sourceId}`}, ${observedAt}
        )
        ON CONFLICT DO NOTHING
        RETURNING raw_import_id
      `;
      navSnapshotsInserted += rows.length;
    }

    let positionSnapshotsInserted = 0;
    for (const snapshot of parsed.positionSnapshots) {
      const rows = await transaction`
        INSERT INTO reported_position_snapshot (
          raw_import_id, snapshot_date, account_id, instrument_id, ticker, name, category,
          quantity, price, market_value, currency, cost_basis,
          base_currency, fx_to_base, market_value_base, source
        ) VALUES (
          ${insertedRaw[0].id}, ${snapshot.date}, ${input.accountId}, ${snapshot.instrumentId},
          ${snapshot.ticker}, ${snapshot.name}, ${snapshot.category}, ${snapshot.quantity},
          ${snapshot.price}, ${snapshot.marketValue}, ${snapshot.currency}, ${snapshot.costBasis},
          ${snapshot.baseCurrency}, ${snapshot.fxToBase}, ${snapshot.marketValueBase},
          ${`ibkr_flex:${input.sourceId}`}
        )
        ON CONFLICT DO NOTHING
        RETURNING raw_import_id
      `;
      positionSnapshotsInserted += rows.length;
    }

    return {
      rawImportId: insertedRaw[0].id,
      contentHash: parsed.contentHash,
      duplicateStatement: false,
      inserted: { instruments: insertedInstruments, trades: insertedTrades, cashFlows: insertedCashFlows },
      navSnapshotsInserted,
      positionSnapshotsInserted,
    };
  });
}
