import { randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { createDatabaseClient, migrateDatabase } from "./database";
import { PostgresFundHoldingsRepository } from "./fund-holdings-sync";
import { importIbkrFlexStatement } from "./ibkr-flex-import";
import { runDueJobs } from "./scheduler";
import { createCalculationRequest, PostgresCalculationRunRepository } from "./calculation-run";
import { PostgresRiskDriftAnchorRepository } from "./risk-drift-anchor";
import { persistMarketDataFreshness } from "./market-data-monitor";
import { PostgresMarketRefreshRunRepository } from "./market-refresh-run";
import { PostgresEventHorizonRepository } from "./event-horizon";
import { PostgresAllocationJudgmentRepository } from "./allocation-judgment";
import { FACTOR_NAMES, type FactorAssessmentItem } from "../domain/allocation-judgment";
import { PostgresResearchEvidenceRepository } from "./research-evidence";
import { PostgresDecisionJournalRepository } from "./decision-journal";
import { PostgresRefillPlanRepository } from "./refill-plan";
import { PostgresPositionGovernanceRepository } from "./position-governance";
import { PostgresExceptionRecordRepository } from "./exception-record";
import { PostgresThemeRepository } from "./theme";
import { PostgresReviewRepository } from "./review";
import { PostgresAgentGatewayRepository } from "./agent-gateway";
import { PostgresQualityMetricsRepository } from "./quality-metrics";
import { PostgresDataSourceHealthRepository } from "./data-source-health";
import { PostgresMarketSignalRepository } from "./market-signal";
import { PostgresResearchMemoryRepository } from "./research-memory";

const databaseDescribe = process.env.DATABASE_INTEGRATION === "1" ? describe : describe.skip;

databaseDescribe("Phase 0 PostgreSQL integration", () => {
  let sql: Sql;

  beforeAll(async () => {
    sql = createDatabaseClient();
    await migrateDatabase(sql);
  });

  afterAll(async () => {
    await sql.end();
  });

  it("applies migrations idempotently and seeds immutable configuration", async () => {
    expect(await migrateDatabase(sql)).toEqual([]);
    const [migration] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM schema_migration`;
    const [strategy] = await sql<{ trading_accounts: number }[]>`SELECT count(*)::int AS trading_accounts FROM account WHERE is_read_only = true`;
    const [parameter] = await sql<{ calibration_required: boolean }[]>`
      SELECT (parameters->>'calibration_required')::boolean AS calibration_required
      FROM parameter_set WHERE id = 'default-draft-v0.1.0'
    `;
    const migrationCount = readdirSync(join(process.cwd(), "../../migrations"))
      .filter((name) => /^\d{4}_.+\.sql$/.test(name)).length;
    expect(migration.count).toBe(migrationCount);
    expect(strategy.trading_accounts).toBe(3);
    expect(parameter.calibration_required).toBe(true);
  });

  it("uses long-horizon fallback cadences for daily market data", async () => {
    const jobs = await sql<{ id: string; interval_seconds: number }[]>`
      SELECT id, interval_seconds
      FROM scheduled_job
      WHERE id IN (
        'market-data-freshness-monitor',
        'portfolio-risk-refresh',
        'quality-metrics-refresh'
      )
      ORDER BY id
    `;
    expect(jobs).toEqual([
      { id: "market-data-freshness-monitor", interval_seconds: 86400 },
      { id: "portfolio-risk-refresh", interval_seconds: 86400 },
      { id: "quality-metrics-refresh", interval_seconds: 604800 },
    ]);
  });

  it("claims and records a due deterministic calculation job", async () => {
    await sql`UPDATE scheduled_job SET next_run_at = now() WHERE id = 'demo-ledger-recalculation'`;
    expect(await runDueJobs(sql)).toContainEqual({ id: "demo-ledger-recalculation", status: "succeeded" });
    const [run] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM calculation_run
      WHERE calculation_type = 'demo-ledger' AND status = 'succeeded'
    `;
    const [job] = await sql<{ last_status: string }[]>`SELECT last_status FROM scheduled_job WHERE id = 'demo-ledger-recalculation'`;
    expect(run.count).toBe(1);
    expect(job.last_status).toBe("succeeded");
  });

  it("opens, accumulates, and resolves scheduled job failure alerts", async () => {
    const jobId = `integration-failing-job-${randomUUID()}`;
    try {
      await sql`
        INSERT INTO scheduled_job (id, handler, interval_seconds, next_run_at)
        VALUES (${jobId}, 'missing-integration-handler', 3600, now())
      `;
      expect(await runDueJobs(sql)).toContainEqual({ id: jobId, status: "failed" });
      await sql`UPDATE scheduled_job SET next_run_at = now() WHERE id = ${jobId}`;
      expect(await runDueJobs(sql)).toContainEqual({ id: jobId, status: "failed" });
      const [alert] = await sql<{ status: string; occurrence_count: number }[]>`
        SELECT status, occurrence_count
        FROM operational_alert
        WHERE source = ${`scheduled_job:${jobId}`} AND fingerprint = 'execution-failure'
      `;
      expect(alert).toEqual({ status: "open", occurrence_count: 2 });

      await sql`UPDATE scheduled_job SET handler = 'demo-ledger-recalculation', next_run_at = now() WHERE id = ${jobId}`;
      expect(await runDueJobs(sql)).toContainEqual({ id: jobId, status: "succeeded" });
      const [resolved] = await sql<{ status: string; resolved: boolean }[]>`
        SELECT status, resolved_at IS NOT NULL AS resolved
        FROM operational_alert
        WHERE source = ${`scheduled_job:${jobId}`} AND fingerprint = 'execution-failure'
      `;
      expect(resolved).toEqual({ status: "resolved", resolved: true });
    } finally {
      await sql`DELETE FROM operational_alert WHERE source = ${`scheduled_job:${jobId}`}`;
      await sql`DELETE FROM scheduled_job WHERE id = ${jobId}`;
    }
  });

  it("opens and resolves the independent market-data freshness warning", async () => {
    try {
      await persistMarketDataFreshness(sql, {
        status: "stale",
        latestEffectiveDate: "2026-07-16",
        expectedThroughDate: "2026-07-24",
        tradingDayLag: 6,
        observedAt: "2026-07-17T00:00:00Z",
        observationTimestampQuality: "authoritative",
        reason: "integration fixture is stale",
      });
      const [open] = await sql<{ status: string; severity: string; detail: string }[]>`
        SELECT status, severity, detail FROM operational_alert
        WHERE source = 'market_data:normalized' AND fingerprint = 'freshness'
      `;
      expect(open).toMatchObject({ status: "open", severity: "warning" });
      expect(open.detail).toContain("tradingDayLag=6");

      await persistMarketDataFreshness(sql, {
        status: "fresh",
        latestEffectiveDate: "2026-07-24",
        expectedThroughDate: "2026-07-24",
        tradingDayLag: 0,
        observedAt: "2026-07-25T00:00:00Z",
        observationTimestampQuality: "authoritative",
        reason: "integration fixture is fresh",
      });
      const [resolved] = await sql<{ status: string; resolved: boolean }[]>`
        SELECT status, resolved_at IS NOT NULL AS resolved FROM operational_alert
        WHERE source = 'market_data:normalized' AND fingerprint = 'freshness'
      `;
      expect(resolved).toEqual({ status: "resolved", resolved: true });
    } finally {
      await sql`
        DELETE FROM operational_alert
        WHERE source = 'market_data:normalized' AND fingerprint = 'freshness'
      `;
    }
  });

  it("records the immutable preflight and completion of a market refresh run", async () => {
    const repository = new PostgresMarketRefreshRunRepository(sql);
    const preflight = {
      fingerprint: randomUUID().replaceAll("-", ""),
      dateFrom: "2026-07-16",
      dateToExclusive: "2026-07-28",
      targets: [{ instrumentId: "US:GOOGL", provider: "fixture", providerSymbol: "GOOGL" }],
      disclosures: ["integration fixture"],
    };
    const started = await repository.start(preflight);
    try {
      expect(started).toMatchObject({ fingerprint: preflight.fingerprint, preflight, status: "running" });
      const completed = await repository.succeed(started.id, { observations: 7 });
      expect(completed).toMatchObject({
        id: started.id,
        status: "succeeded",
        result: { observations: 7 },
        failureReason: null,
      });
      expect(completed.finishedAt).not.toBeNull();
      await expect(repository.loadLatest()).resolves.toMatchObject({ id: started.id });
    } finally {
      await sql`DELETE FROM market_refresh_run WHERE id = ${started.id}`;
    }
  });

  it("retains a Flex statement and imports overlapping facts idempotently", async () => {
    const uniqueId = randomUUID();
    const rawRoot = mkdtempSync(join(tmpdir(), "epoch-flex-"));
    const statement = `Trades,Header,Currency,Symbol,Description,Conid,ListingExchange,TradeID,TradeDate,Quantity,TradePrice,IBCommission,Buy/Sell
Trades,Data,USD,NVDA,NVIDIA CORP,${uniqueId},NASDAQ,trade-${uniqueId},20260720,1,172.25,-1.00,BUY
Cash Transactions,Header,Currency,TransactionID,DateTime,Type,Description,Amount
Cash Transactions,Data,USD,cash-${uniqueId},20260719,Deposits/Withdrawals,Deposit,1000.00
Net Asset Value (NAV) Summary in Base,Header,Account ID,Report Date,Cash,Stock,Total
Net Asset Value (NAV) Summary in Base,Data,ibkr_8602,20260720,1000.00,172.25,1172.25
`;
    try {
      const first = await importIbkrFlexStatement(sql, { accountId: "ibkr_8602", sourceId: uniqueId, text: statement, rawRoot });
      const second = await importIbkrFlexStatement(sql, { accountId: "ibkr_8602", sourceId: uniqueId, text: statement, rawRoot });
      expect(first.duplicateStatement).toBe(false);
      expect(first.inserted).toEqual({ instruments: 1, trades: 1, cashFlows: 1 });
      expect(first.navSnapshotsInserted).toBe(1);
      expect(second).toMatchObject({ rawImportId: first.rawImportId, duplicateStatement: true });
      expect(second.inserted).toEqual({ instruments: 0, trades: 0, cashFlows: 0 });
    } finally {
      rmSync(rawRoot, { recursive: true, force: true });
    }
  });

  it("stores fund holdings snapshots idempotently with their constituents", async () => {
    const repository = new PostgresFundHoldingsRepository(sql);
    const sourceHash = randomUUID().replaceAll("-", "");
    const snapshot = {
      fundInstrumentId: "US:INTEGRATION-ETF",
      asOf: "2026-07-17",
      observedAt: "2026-07-18T00:00:00Z",
      provider: "integration_fixture",
      sourceHash,
      holdings: [
        { constituentInstrumentId: "US:NVDA", name: "NVIDIA Corporation", weight: 0.6, shares: 10, marketValue: 100 },
        { constituentInstrumentId: "US:AVGO", name: "Broadcom Inc.", weight: 0.4 },
      ],
    };
    await repository.save(snapshot);
    await repository.save(snapshot);
    const loaded = await repository.load([snapshot.fundInstrumentId]);
    const matching = loaded.filter((candidate) => candidate.sourceHash === sourceHash);
    expect(matching).toHaveLength(1);
    expect(matching[0]).toMatchObject({
      fundInstrumentId: snapshot.fundInstrumentId,
      asOf: snapshot.asOf,
      observedAt: new Date(snapshot.observedAt).toISOString(),
      provider: snapshot.provider,
      sourceHash,
    });
    expect(matching[0].holdings).toEqual(expect.arrayContaining(snapshot.holdings.map((holding) => expect.objectContaining(holding))));
  });

  it("stores an immutable calculation input and creates its explicit drift anchor idempotently", async () => {
    const repository = new PostgresCalculationRunRepository(sql);
    await sql`
      DELETE FROM risk_drift_anchor_instrument
      WHERE anchor_id IN (
        SELECT anchor.id
        FROM risk_drift_anchor AS anchor
        JOIN calculation_run AS run ON run.id = anchor.calculation_run_id
        WHERE run.calculation_type = 'portfolio-risk-rebalance' AND run.engine_version = 'integration'
      )
    `;
    await sql`
      DELETE FROM risk_drift_anchor
      WHERE calculation_run_id IN (
        SELECT id FROM calculation_run
        WHERE calculation_type = 'portfolio-risk-rebalance' AND engine_version = 'integration'
      )
    `;
    await sql`
      DELETE FROM calculation_run
      WHERE calculation_type = 'portfolio-risk-rebalance' AND engine_version = 'integration'
    `;
    const request = createCalculationRequest({
      calculationType: "portfolio-risk-rebalance",
      asOf: "2026-07-27T00:00:00Z",
      codeVersion: randomUUID(),
      strategyVersion: "epoch-satellite-v0.1.0",
      parameterSetVersion: "default-draft-v0.1.0",
      payload: { schemaVersion: "portfolio-risk-input/1.0", marker: randomUUID() },
    });
    let calculationId: string | undefined;
    try {
      const first = await repository.claim(request);
      calculationId = first.record.id;
      const second = await repository.claim({ ...request, calculationId: randomUUID() });
      expect(first.claimed).toBe(true);
      expect(second).toMatchObject({ claimed: false, record: { id: first.record.id, input: request.payload } });

      const completed = await repository.complete(first.record.id, {
        contractVersion: "1.0",
        calculationId: first.record.id,
        calculationType: request.calculationType,
        asOf: request.asOf,
        inputHash: request.inputHash,
        engineVersion: "integration",
        modelVersion: "integration",
        status: "degraded",
        output: {
          portfolio: { volatilityAnnualized: 0.3 },
          instruments: [{ instrumentId: "US:NVDA", weight: 1, volatilityAnnualized: 0.4, riskContribution: 0.3 }],
        },
        diagnostics: { fixture: true },
        warnings: ["integration fixture"],
        durationMs: 1,
      });
      expect(completed).toMatchObject({
        status: "degraded",
        input: request.payload,
        response: {
          calculationId: first.record.id,
          inputHash: request.inputHash,
          output: { portfolio: { volatilityAnnualized: 0.3 } },
        },
      });
      await expect(repository.complete(first.record.id, completed.response!)).resolves.toEqual(completed);
      await expect(repository.loadCompletedHistory(request.calculationType, 1)).resolves.toEqual([completed]);

      const anchors = new PostgresRiskDriftAnchorRepository(sql);
      const firstAnchor = await anchors.create(completed, "integration fixture");
      const secondAnchor = await anchors.create(completed, "ignored duplicate note");
      expect(secondAnchor).toEqual(firstAnchor);
      expect(firstAnchor).toMatchObject({
        calculationRunId: completed.id,
        portfolioVolatilityAnnualized: 0.3,
        instruments: [{ instrumentId: "US:NVDA", weight: 1, volatilityAnnualized: 0.4, riskContribution: 0.3 }],
      });
      await expect(anchors.loadByRun(completed.id)).resolves.toEqual(firstAnchor);
    } finally {
      if (calculationId) {
        await sql`
          DELETE FROM risk_drift_anchor_instrument
          WHERE anchor_id IN (
            SELECT id FROM risk_drift_anchor WHERE calculation_run_id = ${calculationId}
          )
        `;
        await sql`DELETE FROM risk_drift_anchor WHERE calculation_run_id = ${calculationId}`;
        await sql`DELETE FROM calculation_run WHERE id = ${calculationId}`;
      }
    }
  });

  it("persists an event and clears its near-zone red flag only when the playbook is ready", async () => {
    const repository = new PostgresEventHorizonRepository(sql);
    const eventId = await repository.create({
      title: `Integration earnings ${randomUUID()}`,
      instrumentId: "US:GOOGL",
      eventType: "earnings",
      scheduledDate: "2026-07-31",
      source: "integration",
      observedAt: "2026-07-27T00:00:00Z",
    });
    try {
      const missing = await repository.load("2026-07-27");
      expect(missing.items.find((item) => item.id === eventId)).toMatchObject({
        zone: "near",
        playbookStatus: "missing",
        needsPlaybook: true,
      });
      await repository.savePlaybook({
        eventId,
        status: "ready",
        summary: "Base / upside / downside branches recorded.",
        asOf: "2026-07-27",
        branches: [
          { scope: "instrument", scenario: "miss", trigger: "EPS misses", action: "Reduce", riskDirection: "decrease" },
          { scope: "theme", scenario: "thesis invalidated", trigger: "Industry demand contracts", action: "Downgrade to QQQ", riskDirection: "decrease" },
        ],
      });
      const ready = await repository.load("2026-07-27");
      expect(ready.items.find((item) => item.id === eventId)).toMatchObject({
        playbookStatus: "ready",
        needsPlaybook: false,
      });
    } finally {
      await sql`
        DELETE FROM playbook_branch
        WHERE revision_id IN (
          SELECT revision.id FROM playbook_revision revision
          JOIN event_playbook playbook ON playbook.id = revision.playbook_id
          WHERE playbook.event_id = ${eventId}
        )
      `;
      await sql`
        DELETE FROM playbook_revision
        WHERE playbook_id IN (SELECT id FROM event_playbook WHERE event_id = ${eventId})
      `;
      await sql`DELETE FROM event_playbook WHERE event_id = ${eventId}`;
      await sql`DELETE FROM investment_event WHERE id = ${eventId}`;
    }
  });

  it("versions playbook branches and records pre-plan exceptions for quarterly review", async () => {
    const events = new PostgresEventHorizonRepository(sql);
    const exceptions = new PostgresExceptionRecordRepository(sql);
    const eventId = await events.create({
      title: "Integration exceptional event",
      instrumentId: "US:GOOGL",
      eventType: "earnings",
      scheduledDate: "2026-07-31",
      source: "integration",
      observedAt: "2026-07-27T00:00:00Z",
    });
    try {
      const revisionId = await events.savePlaybook({
        eventId,
        status: "ready",
        summary: "Versioned branch plan",
        asOf: "2026-07-27",
        branches: [
          { scope: "instrument", scenario: "beat", trigger: "Guidance rises", action: "Hold", riskDirection: "neutral" },
          { scope: "theme", scenario: "thesis invalidated", trigger: "Demand collapses", action: "Downgrade group to QQQ", riskDirection: "decrease" },
        ],
      });
      const exceptionId = await exceptions.create({
        eventId,
        playbookRevisionId: revisionId,
        uncoveredReason: "The event was not represented by any existing branch.",
        logicChange: "The distribution model changed irreversibly.",
        action: "Reduce after the cooling period.",
        decidedAt: "2026-07-27T12:00:00Z",
        executeAfter: "2026-07-28T12:00:00Z",
      });
      await exceptions.review(exceptionId, "absorbed");
      const rows = await sql<{ review_status: string }[]>`
        SELECT review_status FROM exception_record WHERE id = ${exceptionId}
      `;
      expect(rows[0].review_status).toBe("absorbed");
    } finally {
      await sql`DELETE FROM exception_record WHERE event_id = ${eventId}`;
      await sql`
        DELETE FROM playbook_branch
        WHERE revision_id IN (
          SELECT revision.id FROM playbook_revision revision
          JOIN event_playbook playbook ON playbook.id = revision.playbook_id
          WHERE playbook.event_id = ${eventId}
        )
      `;
      await sql`
        DELETE FROM playbook_revision
        WHERE playbook_id IN (SELECT id FROM event_playbook WHERE event_id = ${eventId})
      `;
      await sql`DELETE FROM event_playbook WHERE event_id = ${eventId}`;
      await sql`DELETE FROM investment_event WHERE id = ${eventId}`;
    }
  });

  it("requires a confirmed six-factor assessment before confirming a weight tier", async () => {
    const repository = new PostgresAllocationJudgmentRepository(sql);
    const instrumentId = `TEST:${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
    const candidateId = await repository.createCandidate(instrumentId);
    const items: FactorAssessmentItem[] = FACTOR_NAMES.map((factor) => ({
      factor,
      conclusion: "neutral",
      confidence: 0.6,
      evidence: `${factor} supporting evidence`,
      counterEvidence: `${factor} counter evidence`,
      direction: "stable",
      impact: `${factor} affects the relative ranking`,
    }));
    try {
      const draftAssessmentId = await repository.saveAssessment(candidateId, {
        asOf: "2026-07-27",
        summary: "Integration draft",
        rankingReason: "Integration ranking reason",
        items,
      }, false);
      await expect(repository.saveWeightTier({
        candidateId,
        factorAssessmentId: draftAssessmentId,
        tier: {
          asOf: "2026-07-27",
          weightPercent: 25,
          earningsExpectation: "If earnings reach the stated anchor, expected upside is measurable.",
          primaryRisk: "Demand could weaken.",
          invalidationCondition: "Two consecutive quarters of order contraction.",
          whyThisTier: "Above standard positions but below the core holding.",
        },
        confirmed: true,
      })).rejects.toThrow("confirmed factor assessment");

      const confirmedAssessmentId = await repository.saveAssessment(candidateId, {
        asOf: "2026-07-27",
        summary: "Integration confirmed assessment",
        rankingReason: "Integration confirmed ranking reason",
        items,
      }, true);
      await repository.saveWeightTier({
        candidateId,
        factorAssessmentId: confirmedAssessmentId,
        tier: {
          asOf: "2026-07-27",
          weightPercent: 25,
          earningsExpectation: "If earnings reach the stated anchor, expected upside is measurable.",
          primaryRisk: "Demand could weaken.",
          invalidationCondition: "Two consecutive quarters of order contraction.",
          whyThisTier: "Above standard positions but below the core holding.",
        },
        confirmed: true,
      });
      await expect(repository.loadCandidate(candidateId)).resolves.toMatchObject({
        instrument_id: instrumentId,
        assessment_status: "confirmed",
        weight_percent: 25,
        weight_tier_status: "confirmed",
      });
    } finally {
      await sql`DELETE FROM weight_tier WHERE candidate_id = ${candidateId}`;
      await sql`
        DELETE FROM factor_assessment_item
        WHERE assessment_id IN (SELECT id FROM factor_assessment WHERE candidate_id = ${candidateId})
      `;
      await sql`DELETE FROM factor_assessment WHERE candidate_id = ${candidateId}`;
      await sql`DELETE FROM investment_candidate WHERE id = ${candidateId}`;
    }
  });

  it("preserves evidence roles from a claim through its factor assessment", async () => {
    const allocation = new PostgresAllocationJudgmentRepository(sql);
    const research = new PostgresResearchEvidenceRepository(sql);
    const instrumentId = `TEST:${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
    const candidateId = await allocation.createCandidate(instrumentId);
    const evidenceIds: string[] = [];
    try {
      const supportId = await research.saveEvidence({
        title: "Integration primary filing",
        sourceType: "primary",
        sourceName: `integration-${randomUUID()}`,
        sourceUrl: "https://example.com/filing",
        observedAt: "2026-07-27T00:00:00Z",
        effectiveDate: "2026-07-26",
        excerpt: "Orders increased.",
        contentHash: randomUUID().replaceAll("-", "").padEnd(64, "0"),
      });
      evidenceIds.push(supportId);
      const counterId = await research.saveEvidence({
        title: "Integration counter evidence",
        sourceType: "secondary",
        sourceName: `integration-${randomUUID()}`,
        sourceUrl: "https://example.com/counter",
        observedAt: "2026-07-27T01:00:00Z",
        effectiveDate: "2026-07-26",
        excerpt: "Lead times declined.",
        contentHash: randomUUID().replaceAll("-", "").padEnd(64, "1"),
      });
      evidenceIds.push(counterId);
      const claimId = await research.saveClaim(candidateId, {
        kind: "inference",
        statement: "Demand remains durable.",
        reasoning: "Order growth currently outweighs the lead-time counter-signal.",
        confidence: 0.7,
        asOf: "2026-07-27",
        supportingEvidenceIds: [supportId],
        counterEvidenceIds: [counterId],
      });
      const assessmentId = await allocation.saveAssessment(candidateId, {
        asOf: "2026-07-27",
        summary: "Evidence-linked assessment",
        rankingReason: "Evidence-linked ranking",
        items: FACTOR_NAMES.map((factor) => ({
          factor, conclusion: "neutral", confidence: 0.6, evidence: "See linked claim",
          counterEvidence: "See linked counter evidence", direction: "stable", impact: "Neutral impact",
        })),
      }, true);
      await research.linkAssessment({ assessmentId, claimId, role: "support" });
      await expect(research.loadClaims(candidateId)).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({ id: claimId, evidence_id: supportId, evidence_role: "support" }),
        expect.objectContaining({ id: claimId, evidence_id: counterId, evidence_role: "counter" }),
      ]));
    } finally {
      await sql`
        DELETE FROM factor_assessment_claim
        WHERE assessment_id IN (SELECT id FROM factor_assessment WHERE candidate_id = ${candidateId})
      `;
      await sql`
        DELETE FROM factor_assessment_item
        WHERE assessment_id IN (SELECT id FROM factor_assessment WHERE candidate_id = ${candidateId})
      `;
      await sql`DELETE FROM factor_assessment WHERE candidate_id = ${candidateId}`;
      await sql`
        DELETE FROM claim_evidence
        WHERE claim_id IN (SELECT id FROM research_claim WHERE candidate_id = ${candidateId})
      `;
      await sql`DELETE FROM research_claim WHERE candidate_id = ${candidateId}`;
      await sql`DELETE FROM investment_candidate WHERE id = ${candidateId}`;
      if (evidenceIds.length) await sql`DELETE FROM research_evidence WHERE id = ANY(${evidenceIds})`;
    }
  });

  it("keeps Policy Gate, owner decision and external execution as separate journal records", async () => {
    const repository = new PostgresDecisionJournalRepository(sql);
    const refills = new PostgresRefillPlanRepository(sql);
    const passingRunId = randomUUID();
    const failedRunId = randomUUID();
    await sql`
      INSERT INTO calculation_run (
        id, calculation_type, as_of, input_hash, code_version, status, input_payload, output, finished_at
      ) VALUES
        (
          ${passingRunId}, 'portfolio-risk-rebalance', '2026-07-27T00:00:00Z',
          ${randomUUID().replaceAll("-", "").padEnd(64, "a")}, ${randomUUID()}, 'degraded',
          ${sql.json({ targetWeights: [{ instrumentId: "US:GOOGL", weight: 0.25 }] })},
          ${sql.json({ policyGate: { passed: true } })}, now()
        ),
        (
          ${failedRunId}, 'portfolio-risk-rebalance', '2026-07-27T01:00:00Z',
          ${randomUUID().replaceAll("-", "").padEnd(64, "b")}, ${randomUUID()}, 'degraded',
          ${sql.json({ targetWeights: [{ instrumentId: "US:GOOGL", weight: 1 }] })},
          ${sql.json({ policyGate: { passed: false } })}, now()
        )
    `;
    const decisionIds: string[] = [];
    let refillPlanId: string | undefined;
    try {
      await expect(repository.decide({
        calculationRunId: failedRunId,
        triggerType: "risk",
        outcome: "confirmed",
        rationale: "Should not be accepted",
        monitoringNotes: "",
        decidedAt: "2026-07-27T02:00:00Z",
      })).rejects.toThrow("can only be rejected");
      decisionIds.push(await repository.decide({
        calculationRunId: failedRunId,
        triggerType: "risk",
        outcome: "rejected",
        rationale: "Policy Gate failed",
        monitoringNotes: "Prepare a lower-risk intent",
        decidedAt: "2026-07-27T02:01:00Z",
      }));
      const confirmedId = await repository.decide({
        calculationRunId: passingRunId,
        triggerType: "risk",
        outcome: "confirmed",
        rationale: "Approved after independent Policy Gate",
        monitoringNotes: "Watch the next earnings event",
        decidedAt: "2026-07-27T02:02:00Z",
      });
      decisionIds.push(confirmedId);
      const executionId = await repository.recordExecution({
        decisionId: confirmedId,
        executedAt: "2026-07-27T03:00:00Z",
        brokerReference: "integration-manual-execution",
        actualWeights: [{ instrumentId: "US:GOOGL", weight: 0.24 }],
        note: "Executed manually outside Epoch",
      });
      refillPlanId = await refills.create(confirmedId);
      await expect(refills.evaluate({
        planId: refillPlanId,
        batchNumber: 1,
        evaluation: {
          consecutiveGatePassTradingDays: 1,
          originalRiskSignalCleared: false,
          factorInvalidationTriggered: false,
          projectedPolicyGatePassed: true,
          currentTargetConfirmed: true,
        },
        targetWeights: [{ instrumentId: "US:GOOGL", weight: 0.25 }],
        calculationRunId: passingRunId,
      })).resolves.toMatchObject({ state: "eligible", mandatory: false });
      await refills.transition({ planId: refillPlanId, batchNumber: 1, to: "executed", reason: "Executed externally" });
      await expect(refills.evaluate({
        planId: refillPlanId,
        batchNumber: 2,
        evaluation: {
          consecutiveGatePassTradingDays: 5,
          originalRiskSignalCleared: true,
          factorInvalidationTriggered: false,
          projectedPolicyGatePassed: true,
          currentTargetConfirmed: true,
        },
        targetWeights: [{ instrumentId: "US:GOOGL", weight: 0.25 }],
        calculationRunId: passingRunId,
      })).resolves.toMatchObject({ state: "eligible", mandatory: false });
      await expect(refills.load(refillPlanId)).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({ batchNumber: 1, state: "executed" }),
        expect.objectContaining({ batchNumber: 2, state: "eligible" }),
        expect.objectContaining({ batchNumber: 3, state: "pending" }),
      ]));
      await expect(repository.load()).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: confirmedId,
          rebalanceRecord: expect.objectContaining({
            trigger_type: "risk",
            strategy_version_id: "epoch-satellite-v0.1.0",
            parameter_set_id: "default-draft-v0.1.0",
          }),
          execution: expect.objectContaining({
            id: executionId,
            brokerReference: "integration-manual-execution",
          }),
        }),
        expect.objectContaining({ calculationRunId: failedRunId, outcome: "rejected", execution: null }),
      ]));
    } finally {
      if (refillPlanId) {
        await sql`
          DELETE FROM refill_batch_transition
          WHERE batch_id IN (SELECT id FROM refill_batch WHERE plan_id = ${refillPlanId})
        `;
        await sql`DELETE FROM refill_batch WHERE plan_id = ${refillPlanId}`;
        await sql`DELETE FROM refill_plan WHERE id = ${refillPlanId}`;
      }
      if (decisionIds.length) {
        await sql`DELETE FROM execution_record WHERE decision_id = ANY(${decisionIds})`;
        await sql`DELETE FROM rebalance_record WHERE decision_id = ANY(${decisionIds})`;
        await sql`DELETE FROM investment_decision WHERE id = ANY(${decisionIds})`;
      }
      await sql`DELETE FROM calculation_run WHERE id IN (${passingRunId}, ${failedRunId})`;
    }
  });

  it("records catalysts and invalidation while exempting risk reductions from the 90-day restriction", async () => {
    const allocation = new PostgresAllocationJudgmentRepository(sql);
    const governance = new PostgresPositionGovernanceRepository(sql);
    const instrumentId = `TEST:${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
    const candidateId = await allocation.createCandidate(instrumentId);
    try {
      await governance.saveCatalyst(candidateId, {
        title: "Integration catalyst",
        expectedDate: "2026-08-01",
        validThrough: "2026-08-08",
        status: "planned",
        observableOutcome: "Guidance exceeds the explicit threshold",
      });
      await governance.saveInvalidation(candidateId, {
        statement: "Demand thesis fails",
        observableMetric: "Quarterly order growth",
        trigger: "Negative growth for two consecutive quarters",
      });
      await expect(governance.recordExit({
        candidateId, exitType: "risk_reduction", exitDate: "2026-07-27",
      })).resolves.toBeNull();
      await expect(governance.recordExit({
        candidateId, exitType: "active_exit", exitDate: "2026-07-27",
      })).resolves.toEqual(expect.any(String));
      await expect(governance.load(candidateId, "2026-07-27")).resolves.toMatchObject({
        catalysts: [expect.objectContaining({ status: "planned" })],
        invalidations: [expect.objectContaining({ status: "active" })],
        restrictions: [expect.objectContaining({ restricted_until: "2026-10-25" })],
      });
    } finally {
      await sql`DELETE FROM exit_restriction WHERE candidate_id = ${candidateId}`;
      await sql`DELETE FROM invalidation_condition WHERE candidate_id = ${candidateId}`;
      await sql`DELETE FROM candidate_catalyst WHERE candidate_id = ${candidateId}`;
      await sql`DELETE FROM investment_candidate WHERE id = ${candidateId}`;
    }
  });

  it("versions an investment theme and links its candidate and evidence", async () => {
    const themes = new PostgresThemeRepository(sql);
    const allocation = new PostgresAllocationJudgmentRepository(sql);
    const research = new PostgresResearchEvidenceRepository(sql);
    const marker = randomUUID();
    const instrumentId = `TEST:${marker.replaceAll("-", "").slice(0, 12).toUpperCase()}`;
    const candidateId = await allocation.createCandidate(instrumentId);
    const evidenceId = await research.saveEvidence({
      title: "Integration theme evidence",
      sourceType: "primary",
      sourceName: `integration-theme-${marker}`,
      sourceUrl: "https://example.com/theme-evidence",
      observedAt: "2026-07-27T00:00:00Z",
      effectiveDate: "2026-07-26",
      excerpt: "Deployment demand crossed the stated threshold.",
      contentHash: marker.replaceAll("-", "").padEnd(64, "e"),
    });
    let themeId: string | undefined;
    try {
      themeId = await themes.create(`Integration theme ${marker}`);
      const versionId = await themes.saveVersion(themeId, {
        asOf: "2026-07-27",
        phase: "deployment",
        thesis: "Infrastructure investment is moving from installation to deployment.",
        profitPath: "Utilization growth expands recurring revenue and operating leverage.",
        invalidationCondition: "Utilization remains below the declared threshold for two quarters.",
        confirmed: true,
      });
      await themes.linkCandidate(themeId, candidateId, "primary beneficiary");
      await themes.linkEvidence(versionId, evidenceId, "support");

      await expect(themes.load()).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: themeId,
          version_id: versionId,
          phase: "deployment",
          version_status: "confirmed",
          candidate_count: 1,
        }),
      ]));
      const links = await sql<{ candidate_count: number; evidence_count: number }[]>`
        SELECT
          (SELECT count(*)::int FROM theme_candidate WHERE theme_id = ${themeId}) AS candidate_count,
          (SELECT count(*)::int FROM theme_version_evidence WHERE theme_version_id = ${versionId}) AS evidence_count
      `;
      expect(links[0]).toEqual({ candidate_count: 1, evidence_count: 1 });
    } finally {
      if (themeId) {
        await sql`
          DELETE FROM theme_version_evidence
          WHERE theme_version_id IN (SELECT id FROM theme_version WHERE theme_id = ${themeId})
        `;
        await sql`DELETE FROM theme_candidate WHERE theme_id = ${themeId}`;
        await sql`DELETE FROM theme_version WHERE theme_id = ${themeId}`;
        await sql`DELETE FROM investment_theme WHERE id = ${themeId}`;
      }
      await sql`DELETE FROM research_evidence WHERE id = ${evidenceId}`;
      await sql`DELETE FROM investment_candidate WHERE id = ${candidateId}`;
    }
  });

  it("records each review cadence and limits exception absorption to confirmed quarterly reviews", async () => {
    const reviews = new PostgresReviewRepository(sql);
    const eventId = randomUUID();
    const exceptionId = randomUUID();
    const reviewIds: string[] = [];
    try {
      await sql`
        INSERT INTO investment_event (
          id, title, event_type, scheduled_date, source, observed_at
        ) VALUES (
          ${eventId}, 'Integration review event', 'other', '2026-07-27',
          'integration', '2026-07-27T00:00:00Z'
        )
      `;
      await sql`
        INSERT INTO exception_record (
          id, event_id, uncovered_reason, logic_change, action, decided_at, execute_after
        ) VALUES (
          ${exceptionId}, ${eventId}, 'Unexpected fact', 'Changed decision logic',
          'Hold pending confirmation', '2026-07-27T01:00:00Z', '2026-07-28T01:00:00Z'
        )
      `;
      const base = {
        scope: "portfolio" as const,
        asOf: "2026-07-27",
        strategyVersion: "epoch-satellite-v0.1.0",
        parameterSetVersion: "default-draft-v0.1.0",
        summary: "Integration review",
        whatWorked: "The deterministic gate worked.",
        whatFailed: "The playbook missed a branch.",
        followUp: "Add the missing branch.",
        confirmed: true,
      };
      for (const cadence of ["daily", "weekly", "monthly", "quarterly", "post_exit"] as const) {
        reviewIds.push(await reviews.create({ ...base, cadence }));
      }
      await expect(reviews.absorb({
        reviewId: reviewIds[1],
        sourceType: "exception",
        sourceId: exceptionId,
        disposition: "absorbed",
        rationale: "Weekly reviews cannot absorb policy learning.",
      })).rejects.toThrow("quarterly");
      await reviews.absorb({
        reviewId: reviewIds[3],
        sourceType: "exception",
        sourceId: exceptionId,
        disposition: "absorbed",
        rationale: "The missing branch is incorporated into the next playbook revision.",
      });
      await expect(reviews.load()).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({ id: reviewIds[3], cadence: "quarterly", absorption_count: 1 }),
      ]));
      const [exception] = await sql<{ review_status: string }[]>`
        SELECT review_status FROM exception_record WHERE id = ${exceptionId}
      `;
      expect(exception.review_status).toBe("absorbed");
    } finally {
      if (reviewIds.length) {
        await sql`DELETE FROM review_absorption WHERE review_id = ANY(${reviewIds})`;
        await sql`DELETE FROM investment_review WHERE id = ANY(${reviewIds})`;
      }
      await sql`DELETE FROM exception_record WHERE id = ${exceptionId}`;
      await sql`DELETE FROM investment_event WHERE id = ${eventId}`;
    }
  });

  it("audits an AgentRun without exposing forbidden data or accepting a model-authored decision", async () => {
    const gateway = new PostgresAgentGatewayRepository(sql);
    const run = await gateway.start({
      taskType: "review_portfolio",
      model: "integration-agent",
      promptVersion: "epoch-agent-prompt/1.0",
      input: { objective: "Review portfolio risks" },
    });
    try {
      expect(run.status).toBe("running");
      expect(run.dataSnapshot).toMatchObject({
        permissions: {
          forbidden: expect.arrayContaining(["ledger", "investment_decision", "order"]),
        },
      });
      expect(JSON.stringify(run.dataSnapshot)).not.toContain("broker_reference");
      const completed = await gateway.complete({
        runId: run.id,
        output: {
          summary: "Portfolio remains below the mechanical risk gate.",
          findings: ["Issuer coverage remains incomplete."],
          recommendations: ["Refresh the missing fund holdings snapshot."],
        },
        citations: [],
        limitations: ["This integration run does not invoke an external model."],
      });
      expect(completed).toMatchObject({
        status: "completed",
        strategyVersion: "epoch-satellite-v0.1.0",
        parameterSetVersion: "default-draft-v0.1.0",
      });
      await expect(gateway.feedback({
        runId: run.id,
        disposition: "accepted",
        comment: "Accepted as an integration fixture.",
      })).resolves.toEqual(expect.any(String));
    } finally {
      await sql`DELETE FROM agent_run_feedback WHERE agent_run_id = ${run.id}`;
      await sql`DELETE FROM agent_run WHERE id = ${run.id}`;
    }
  });

  it("materializes an Agent review only as an idempotent draft", async () => {
    const gateway = new PostgresAgentGatewayRepository(sql);
    const run = await gateway.start({
      taskType: "run_review",
      model: "integration-agent",
      promptVersion: "epoch-agent-prompt/1.0",
      input: { cadence: "weekly" },
    });
    let reviewId: string | undefined;
    try {
      await gateway.complete({
        runId: run.id,
        output: {
          cadence: "weekly",
          summary: "Weekly integration review.",
          whatWorked: "The risk gate remained independent.",
          whatFailed: "No external model was invoked.",
          followUp: "Retain the fixed evidence fixture.",
        },
        citations: [],
        limitations: ["Integration fixture only."],
      });
      const first = await gateway.materializeDraft(run.id);
      const second = await gateway.materializeDraft(run.id);
      expect(second).toEqual(first);
      reviewId = String(first.objectIds.reviewId);
      const rows = await sql<{ status: string }[]>`
        SELECT status FROM investment_review WHERE id = ${reviewId}
      `;
      expect(rows[0].status).toBe("draft");
    } finally {
      await sql`DELETE FROM agent_run_materialization WHERE agent_run_id = ${run.id}`;
      if (reviewId) await sql`DELETE FROM investment_review WHERE id = ${reviewId}`;
      await sql`DELETE FROM agent_run WHERE id = ${run.id}`;
    }
  });

  it("materializes cited candidate research as draft claims, assessment and proposed tier", async () => {
    const gateway = new PostgresAgentGatewayRepository(sql);
    const allocation = new PostgresAllocationJudgmentRepository(sql);
    const research = new PostgresResearchEvidenceRepository(sql);
    const marker = randomUUID();
    const candidateId = await allocation.createCandidate(`TEST:${marker.replaceAll("-", "").slice(0, 12).toUpperCase()}`);
    const evidenceId = await research.saveEvidence({
      title: "Fixed Agent research evidence",
      sourceType: "primary",
      sourceName: `agent-integration-${marker}`,
      sourceUrl: "https://example.com/agent-evidence",
      observedAt: "2026-07-27T00:00:00Z",
      effectiveDate: "2026-07-26",
      excerpt: "Orders increased in the fixed fixture.",
      contentHash: marker.replaceAll("-", "").padEnd(64, "a"),
    });
    const run = await gateway.start({
      taskType: "research_candidate",
      model: "integration-agent",
      promptVersion: "epoch-agent-prompt/1.0",
      input: { candidateId },
    });
    let assessmentId: string | undefined;
    let weightTierId: string | undefined;
    try {
      await gateway.complete({
        runId: run.id,
        output: {
          candidateId,
          claims: [{
            kind: "fact",
            statement: "Orders increased.",
            reasoning: "",
            confidence: 0.9,
            asOf: "2026-07-27",
            supportingEvidenceIds: [evidenceId],
            counterEvidenceIds: [],
          }],
          factorAssessment: {
            asOf: "2026-07-27",
            summary: "Fixed Agent assessment",
            rankingReason: "Qualitative comparison only",
            items: FACTOR_NAMES.map((factor) => ({
              factor,
              conclusion: "neutral",
              confidence: 0.6,
              evidence: "See cited primary evidence.",
              counterEvidence: "No additional counterevidence in the fixture.",
              direction: "stable",
              impact: "Neutral pending owner review.",
            })),
          },
          weightTierProposal: {
            asOf: "2026-07-27",
            weightPercent: 20,
            earningsExpectation: "Orders convert into measurable earnings.",
            primaryRisk: "Orders fail to convert.",
            invalidationCondition: "Orders contract for two quarters.",
            whyThisTier: "Positive evidence with material remaining uncertainty.",
          },
        },
        citations: [{
          evidenceId,
          title: "Fixed Agent research evidence",
          supports: "Order-growth fact.",
        }],
        limitations: ["Fixed evidence set only."],
      });
      const materialized = await gateway.materializeDraft(run.id);
      assessmentId = String(materialized.objectIds.assessmentId);
      weightTierId = String(materialized.objectIds.weightTierId);
      await expect(allocation.loadCandidate(candidateId)).resolves.toMatchObject({
        assessment_id: assessmentId,
        assessment_status: "draft",
        weight_tier_id: weightTierId,
        weight_tier_status: "proposed",
      });
    } finally {
      await sql`DELETE FROM agent_run_materialization WHERE agent_run_id = ${run.id}`;
      if (assessmentId) await sql`DELETE FROM factor_assessment_claim WHERE assessment_id = ${assessmentId}`;
      if (weightTierId) await sql`DELETE FROM weight_tier WHERE id = ${weightTierId}`;
      if (assessmentId) {
        await sql`DELETE FROM factor_assessment_item WHERE assessment_id = ${assessmentId}`;
        await sql`DELETE FROM factor_assessment WHERE id = ${assessmentId}`;
      }
      await sql`
        DELETE FROM claim_evidence
        WHERE claim_id IN (SELECT id FROM research_claim WHERE candidate_id = ${candidateId})
      `;
      await sql`DELETE FROM research_claim WHERE candidate_id = ${candidateId}`;
      await sql`DELETE FROM agent_run WHERE id = ${run.id}`;
      await sql`DELETE FROM research_evidence WHERE id = ${evidenceId}`;
      await sql`DELETE FROM investment_candidate WHERE id = ${candidateId}`;
    }
  });

  it("tracks claim outcomes and confidence calibration without overwriting the claim", async () => {
    const allocation = new PostgresAllocationJudgmentRepository(sql);
    const research = new PostgresResearchEvidenceRepository(sql);
    const quality = new PostgresQualityMetricsRepository(sql);
    const marker = randomUUID();
    const candidateId = await allocation.createCandidate(`TEST:${marker.replaceAll("-", "").slice(0, 12).toUpperCase()}`);
    const evidenceId = await research.saveEvidence({
      title: "Claim outcome evidence",
      sourceType: "primary",
      sourceName: `claim-outcome-${marker}`,
      sourceUrl: "https://example.com/claim-outcome",
      observedAt: "2026-07-27T00:00:00Z",
      effectiveDate: "2026-07-27",
      excerpt: "The observable threshold was reached.",
      contentHash: marker.replaceAll("-", "").padEnd(64, "b"),
    });
    const claimId = await research.saveClaim(candidateId, {
      kind: "hypothesis",
      statement: "The threshold will be reached.",
      reasoning: "The leading indicator crossed its stated anchor.",
      confidence: 0.8,
      asOf: "2026-07-20",
      supportingEvidenceIds: [evidenceId],
      counterEvidenceIds: [],
    });
    try {
      await quality.recordClaimOutcome({
        claimId,
        outcome: "verified_true",
        evaluatedAsOf: "2026-07-27",
        rationale: "The fixed observable threshold was reached.",
        evidenceId,
      });
      const dashboard = await quality.loadDashboard();
      expect(dashboard.confidenceCalibration).toEqual(expect.arrayContaining([
        expect.objectContaining({ observations: expect.any(Number), verified_rate: expect.any(Number) }),
      ]));
      expect(dashboard.unresolvedClaims).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ id: claimId }),
      ]));
    } finally {
      await sql`DELETE FROM claim_outcome WHERE claim_id = ${claimId}`;
      await sql`DELETE FROM claim_evidence WHERE claim_id = ${claimId}`;
      await sql`DELETE FROM research_claim WHERE id = ${claimId}`;
      await sql`DELETE FROM research_evidence WHERE id = ${evidenceId}`;
      await sql`DELETE FROM investment_candidate WHERE id = ${candidateId}`;
    }
  });

  it("classifies configured data sources from append-only health observations", async () => {
    const sources = new PostgresDataSourceHealthRepository(sql);
    const observationId = await sources.observe({
      sourceId: "daily-market-bars",
      status: "degraded",
      effectiveAt: "2026-07-27T00:00:00Z",
      observedAt: "2099-07-27T01:00:00Z",
      detail: "Integration fixture retains data but reports degraded provenance.",
    });
    try {
      await expect(sources.load()).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: "daily-market-bars",
          configured_status: "active",
          observation_status: "degraded",
          health_status: "degraded",
        }),
        expect.objectContaining({
          id: "options-iv",
          configured_status: "unavailable",
          health_status: "unavailable",
        }),
      ]));
    } finally {
      await sql`DELETE FROM data_source_observation WHERE id = ${observationId}`;
    }
  });

  it("derives and persists strict daily semivariance from idempotent minute bars", async () => {
    const signals = new PostgresMarketSignalRepository(sql);
    const instrumentId = `TEST:${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
    const provider = "integration-semivariance";
    const common = {
      instrumentId, open: 100, high: 102, low: 98, volume: 100,
      provider, observedAt: "2026-07-27T20:01:00Z",
    };
    try {
      expect(await signals.ingestIntradayBars([
        { ...common, timestamp: "2026-07-27T13:30:00Z", close: 100 },
        { ...common, timestamp: "2026-07-27T13:31:00Z", close: 101 },
        { ...common, timestamp: "2026-07-27T13:32:00Z", close: 99 },
      ])).toBe(3);
      expect(await signals.ingestIntradayBars([
        { ...common, timestamp: "2026-07-27T13:30:00Z", close: 100 },
      ])).toBe(0);
      expect(await signals.refreshDailySemivariance(provider)).toBe(1);
      const [metric] = await sql<{
        positive_semivariance: number; negative_semivariance: number;
        signed_jump: number; return_observations: number;
      }[]>`
        SELECT positive_semivariance, negative_semivariance, signed_jump, return_observations
        FROM intraday_semivariance_daily
        WHERE instrument_id = ${instrumentId} AND provider = ${provider}
      `;
      expect(metric.return_observations).toBe(2);
      expect(metric.signed_jump).toBeCloseTo(
        Math.log(101 / 100) ** 2 - Math.log(99 / 101) ** 2,
      );
    } finally {
      await sql`DELETE FROM intraday_semivariance_daily WHERE instrument_id = ${instrumentId}`;
      await sql`DELETE FROM intraday_bar_observation WHERE instrument_id = ${instrumentId}`;
    }
  });

  it("retrieves research memory across claims and evidence without exposing writes", async () => {
    const allocation = new PostgresAllocationJudgmentRepository(sql);
    const research = new PostgresResearchEvidenceRepository(sql);
    const memory = new PostgresResearchMemoryRepository(sql);
    const marker = randomUUID().replaceAll("-", "");
    const phrase = `memory-${marker.slice(0, 12)}`;
    const candidateId = await allocation.createCandidate(`TEST:${marker.slice(0, 12).toUpperCase()}`);
    const evidenceId = await research.saveEvidence({
      title: `${phrase} primary observation`,
      sourceType: "primary",
      sourceName: phrase,
      sourceUrl: "https://example.com/memory",
      observedAt: "2026-07-27T00:00:00Z",
      effectiveDate: "2026-07-27",
      excerpt: "A fixed observation for cross-object memory retrieval.",
      contentHash: marker.padEnd(64, "c"),
    });
    const claimId = await research.saveClaim(candidateId, {
      kind: "fact",
      statement: `${phrase} demand increased`,
      reasoning: "Supported by the fixed primary observation.",
      confidence: 0.9,
      asOf: "2026-07-27",
      supportingEvidenceIds: [evidenceId],
      counterEvidenceIds: [],
    });
    try {
      const results = await memory.search(`${phrase} demand`);
      expect(results).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: claimId, kind: "claim", candidate_id: candidateId }),
        expect.objectContaining({ id: evidenceId, kind: "evidence", source: phrase }),
      ]));
      expect(results[0].score).toBeGreaterThanOrEqual(results.at(-1)!.score);
    } finally {
      await sql`DELETE FROM claim_evidence WHERE claim_id = ${claimId}`;
      await sql`DELETE FROM research_claim WHERE id = ${claimId}`;
      await sql`DELETE FROM research_evidence WHERE id = ${evidenceId}`;
      await sql`DELETE FROM investment_candidate WHERE id = ${candidateId}`;
    }
  });
});
