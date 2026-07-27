import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import {
  AGENT_OUTPUT_SCHEMA_VERSION,
  validateAgentCompletion,
  validateAgentRunRequest,
  type AgentRunCompletion,
  type AgentRunRequest,
  type AgentTaskType,
} from "../domain/agent-gateway";
import { PostgresEventHorizonRepository } from "./event-horizon";
import { PostgresAllocationJudgmentRepository } from "./allocation-judgment";
import { PostgresResearchEvidenceRepository } from "./research-evidence";
import { PostgresReviewRepository } from "./review";
import type { FactorAssessmentInput, WeightTierInput } from "../domain/allocation-judgment";
import type { ClaimInput } from "../domain/research-evidence";
import type { PlaybookBranchInput } from "../domain/playbook";
import type { ReviewInput } from "../domain/review";
import type { RebalanceTargetWeight } from "../domain/rebalance-intent";
import { evaluateRebalanceRisk } from "./rebalance-risk";

const databaseJson = (value: unknown): Parameters<Sql["json"]>[0] => JSON.parse(JSON.stringify(value));

type AgentRunRow = {
  id: string;
  task_type: AgentTaskType;
  status: "running" | "completed" | "failed";
  model: string;
  prompt_version: string;
  strategy_version_id: string;
  parameter_set_id: string;
  output_schema_version: string;
  input_payload: Record<string, unknown>;
  data_snapshot: Record<string, unknown>;
  calculation_run_ids: string[];
  citations: unknown;
  output_payload: Record<string, unknown> | null;
  limitations: unknown;
  failure_reason: string | null;
  started_at: string;
  finished_at: string | null;
};

const toRun = (row: AgentRunRow) => ({
  id: row.id,
  taskType: row.task_type,
  status: row.status,
  model: row.model,
  promptVersion: row.prompt_version,
  strategyVersion: row.strategy_version_id,
  parameterSetVersion: row.parameter_set_id,
  outputSchemaVersion: row.output_schema_version,
  input: row.input_payload,
  dataSnapshot: row.data_snapshot,
  calculationRunIds: row.calculation_run_ids,
  citations: row.citations,
  output: row.output_payload,
  limitations: row.limitations,
  failureReason: row.failure_reason,
  startedAt: new Date(row.started_at).toISOString(),
  finishedAt: row.finished_at ? new Date(row.finished_at).toISOString() : null,
});

export class PostgresAgentGatewayRepository {
  constructor(private readonly sql: Sql) {}

  private async snapshot(asOf: string): Promise<Record<string, unknown>> {
    const [portfolio, positions, risk, candidates, events] = await Promise.all([
      this.sql`
        SELECT snapshot_date::text AS as_of, total_assets, cash, nav, benchmark
        FROM reported_performance_snapshot
        ORDER BY snapshot_date DESC, recorded_at DESC LIMIT 1
      `,
      this.sql`
        SELECT instrument_id, ticker, name, category, quantity, market_value,
               currency, snapshot_date::text AS as_of
        FROM reported_position_snapshot
        WHERE snapshot_date = (SELECT max(snapshot_date) FROM reported_position_snapshot)
        ORDER BY instrument_id
      `,
      this.sql`
        SELECT id::text, as_of::text, input_hash, model_version, status, output,
               diagnostics, warnings
        FROM calculation_run
        WHERE calculation_type = 'portfolio-risk'
          AND status IN ('succeeded', 'degraded')
        ORDER BY as_of DESC, finished_at DESC LIMIT 1
      `,
      this.sql`
        SELECT candidate.id::text, candidate.instrument_id,
               assessment.id::text AS assessment_id, assessment.status AS assessment_status,
               tier.weight_percent, tier.status AS weight_tier_status
        FROM investment_candidate candidate
        LEFT JOIN LATERAL (
          SELECT id, status FROM factor_assessment
          WHERE candidate_id = candidate.id ORDER BY as_of DESC, recorded_at DESC LIMIT 1
        ) assessment ON true
        LEFT JOIN LATERAL (
          SELECT weight_percent, status FROM weight_tier
          WHERE candidate_id = candidate.id ORDER BY as_of DESC, recorded_at DESC LIMIT 1
        ) tier ON true
        WHERE candidate.status = 'active'
        ORDER BY candidate.instrument_id
      `,
      new PostgresEventHorizonRepository(this.sql).load(asOf),
    ]);
    return {
      asOf,
      portfolio: portfolio[0] ?? null,
      positions,
      risk: risk[0] ?? null,
      candidates,
      eventHorizon: events,
      permissions: {
        query: ["portfolio_snapshot", "positions", "risk_snapshot", "event_horizon", "candidate_status"],
        writeDraft: ["research", "factor_assessment", "weight_tier_proposal", "playbook", "rebalance_intent", "review"],
        forbidden: ["ledger", "strategy", "parameter_set", "calculation_result", "investment_decision", "execution_record", "order"],
      },
    };
  }

  async start(raw: AgentRunRequest): Promise<ReturnType<typeof toRun>> {
    const request = validateAgentRunRequest(raw);
    const asOf = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
    const dataSnapshot = await this.snapshot(asOf);
    const id = randomUUID();
    const rows = await this.sql<AgentRunRow[]>`
      INSERT INTO agent_run (
        id, task_type, status, model, prompt_version, strategy_version_id,
        parameter_set_id, output_schema_version, input_payload, data_snapshot
      ) VALUES (
        ${id}, ${request.taskType}, 'running', ${request.model}, ${request.promptVersion},
        'epoch-satellite-v0.1.0', 'default-draft-v0.1.0',
        ${AGENT_OUTPUT_SCHEMA_VERSION}, ${this.sql.json(databaseJson(request.input))},
        ${this.sql.json(databaseJson(dataSnapshot))}
      )
      RETURNING id::text, task_type, status, model, prompt_version,
        strategy_version_id, parameter_set_id, output_schema_version,
        input_payload, data_snapshot, calculation_run_ids, citations,
        output_payload, limitations, failure_reason, started_at::text, finished_at::text
    `;
    return toRun(rows[0]);
  }

  async complete(raw: AgentRunCompletion): Promise<ReturnType<typeof toRun>> {
    const current = await this.load(raw.runId);
    if (!current) throw new Error("Agent run not found");
    if (current.status !== "running") throw new Error("Only a running AgentRun can be completed");
    const completion = validateAgentCompletion(current.taskType, raw);
    const evidenceIds = [...new Set(completion.citations.flatMap((citation) =>
      citation.evidenceId ? [citation.evidenceId] : []))];
    if (evidenceIds.length) {
      const evidence = await this.sql<{ id: string }[]>`
        SELECT id::text FROM research_evidence WHERE id = ANY(${evidenceIds})
      `;
      if (evidence.length !== evidenceIds.length) throw new Error("AgentRun citation references unknown evidence");
    }
    if (completion.calculationRunIds?.length) {
      const rows = await this.sql<{ id: string }[]>`
        SELECT id::text FROM calculation_run
        WHERE id = ANY(${completion.calculationRunIds})
          AND calculation_type IN ('portfolio-risk', 'portfolio-risk-rebalance')
          AND status IN ('succeeded', 'degraded')
      `;
      if (rows.length !== new Set(completion.calculationRunIds).size) {
        throw new Error("AgentRun references an unavailable or unauthorized CalculationRun");
      }
    }
    const rows = await this.sql<AgentRunRow[]>`
      UPDATE agent_run SET
        status = 'completed',
        output_payload = ${this.sql.json(databaseJson(completion.output))},
        citations = ${this.sql.json(databaseJson(completion.citations))},
        limitations = ${this.sql.json(databaseJson(completion.limitations))},
        calculation_run_ids = ${completion.calculationRunIds ?? []},
        finished_at = now()
      WHERE id = ${completion.runId} AND status = 'running'
      RETURNING id::text, task_type, status, model, prompt_version,
        strategy_version_id, parameter_set_id, output_schema_version,
        input_payload, data_snapshot, calculation_run_ids, citations,
        output_payload, limitations, failure_reason, started_at::text, finished_at::text
    `;
    if (!rows[0]) throw new Error("AgentRun completion conflict");
    return toRun(rows[0]);
  }

  async fail(runId: string, reason: string): Promise<void> {
    const normalized = reason.trim();
    if (!normalized) throw new Error("Agent failure reason is required");
    await this.sql`
      UPDATE agent_run
      SET status = 'failed', failure_reason = ${normalized}, finished_at = now()
      WHERE id = ${runId} AND status = 'running'
    `;
  }

  async feedback(input: {
    runId: string;
    disposition: "accepted" | "modified" | "rejected";
    comment: string;
    correctedOutput?: Record<string, unknown> | null;
  }): Promise<string> {
    const comment = input.comment.trim();
    if (!["accepted", "modified", "rejected"].includes(input.disposition)) throw new Error("Unsupported feedback disposition");
    if (!comment) throw new Error("Feedback comment is required");
    const id = randomUUID();
    const rows = await this.sql<{ id: string }[]>`
      INSERT INTO agent_run_feedback (
        id, agent_run_id, disposition, comment, corrected_output
      ) SELECT
        ${id}, id, ${input.disposition}, ${comment},
        ${input.correctedOutput ? this.sql.json(databaseJson(input.correctedOutput)) : null}
      FROM agent_run WHERE id = ${input.runId} AND status = 'completed'
      RETURNING id::text
    `;
    if (!rows[0]) throw new Error("Feedback requires a completed AgentRun");
    return id;
  }

  async materializeDraft(runId: string): Promise<{ objectType: string; objectIds: Record<string, unknown> }> {
    const run = await this.load(runId);
    if (!run || run.status !== "completed" || !run.output) throw new Error("Draft materialization requires a completed AgentRun");
    const existing = await this.sql<{ object_type: string; object_ids: Record<string, unknown> }[]>`
      SELECT object_type, object_ids FROM agent_run_materialization WHERE agent_run_id = ${runId}
    `;
    if (existing[0]) return { objectType: existing[0].object_type, objectIds: existing[0].object_ids };

    let objectType: "candidate_research_draft" | "playbook_draft" | "review_draft";
    let objectIds: Record<string, unknown>;
    if (run.taskType === "research_candidate") {
      const output = run.output as {
        candidateId: string;
        claims: ClaimInput[];
        factorAssessment: FactorAssessmentInput;
        weightTierProposal: WeightTierInput;
      };
      const research = new PostgresResearchEvidenceRepository(this.sql);
      const allocation = new PostgresAllocationJudgmentRepository(this.sql);
      const claimIds: string[] = [];
      for (const claim of output.claims) claimIds.push(await research.saveClaim(output.candidateId, claim));
      const assessmentId = await allocation.saveAssessment(output.candidateId, output.factorAssessment, false);
      for (const claimId of claimIds) await research.linkAssessment({ assessmentId, claimId, role: "support" });
      const weightTierId = await allocation.saveWeightTier({
        candidateId: output.candidateId,
        factorAssessmentId: assessmentId,
        tier: output.weightTierProposal,
        confirmed: false,
      });
      objectType = "candidate_research_draft";
      objectIds = { claimIds, assessmentId, weightTierId };
    } else if (run.taskType === "prepare_event") {
      const output = run.output as {
        eventId: string; summary: string; asOf?: string; branches: PlaybookBranchInput[];
      };
      const revisionId = await new PostgresEventHorizonRepository(this.sql).savePlaybook({
        eventId: output.eventId,
        status: "draft",
        summary: output.summary,
        asOf: String(output.asOf ?? run.dataSnapshot.asOf),
        branches: output.branches,
      });
      objectType = "playbook_draft";
      objectIds = { revisionId };
    } else if (run.taskType === "run_review") {
      const output = run.output as Partial<ReviewInput> & Pick<ReviewInput, "cadence" | "summary" | "whatWorked" | "whatFailed" | "followUp">;
      const reviewId = await new PostgresReviewRepository(this.sql).create({
        cadence: output.cadence,
        scope: output.scope ?? "portfolio",
        asOf: output.asOf ?? String(run.dataSnapshot.asOf),
        candidateId: output.candidateId ?? null,
        calculationRunId: output.calculationRunId ?? null,
        strategyVersion: run.strategyVersion,
        parameterSetVersion: run.parameterSetVersion,
        summary: output.summary,
        whatWorked: output.whatWorked,
        whatFailed: output.whatFailed,
        followUp: output.followUp,
        confirmed: false,
      });
      objectType = "review_draft";
      objectIds = { reviewId };
    } else {
      throw new Error("This AgentRun task has no direct write permission; keep it as an audited proposal");
    }
    await this.sql`
      INSERT INTO agent_run_materialization (agent_run_id, object_type, object_ids)
      VALUES (${runId}, ${objectType}, ${this.sql.json(databaseJson(objectIds))})
    `;
    return { objectType, objectIds };
  }

  async evaluateProposal(runId: string) {
    const run = await this.load(runId);
    if (!run || run.status !== "completed" || run.taskType !== "propose_rebalance" || !run.output) {
      throw new Error("Policy evaluation requires a completed propose_rebalance AgentRun");
    }
    const output = run.output as { targetWeights: RebalanceTargetWeight[] };
    const response = await evaluateRebalanceRisk(output.targetWeights);
    await this.sql`
      UPDATE agent_run
      SET calculation_run_ids = (
        SELECT ARRAY(
          SELECT DISTINCT item FROM unnest(calculation_run_ids || ${response.calculationId}::uuid) item
        )
      )
      WHERE id = ${runId}
    `;
    return response;
  }

  async load(runId: string): Promise<ReturnType<typeof toRun> | null> {
    const rows = await this.sql<AgentRunRow[]>`
      SELECT id::text, task_type, status, model, prompt_version,
        strategy_version_id, parameter_set_id, output_schema_version,
        input_payload, data_snapshot, calculation_run_ids, citations,
        output_payload, limitations, failure_reason, started_at::text, finished_at::text
      FROM agent_run WHERE id = ${runId}
    `;
    return rows[0] ? toRun(rows[0]) : null;
  }

  async list(limit = 20) {
    const rows = await this.sql<AgentRunRow[]>`
      SELECT id::text, task_type, status, model, prompt_version,
        strategy_version_id, parameter_set_id, output_schema_version,
        input_payload, data_snapshot, calculation_run_ids, citations,
        output_payload, limitations, failure_reason, started_at::text, finished_at::text
      FROM agent_run ORDER BY started_at DESC LIMIT ${Math.max(1, Math.min(100, limit))}
    `;
    return rows.map(toRun);
  }
}
