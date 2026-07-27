import type { Sql } from "postgres";
import type { OperationItem } from "../domain/operations";

export class PostgresOperationsRepository {
  constructor(private readonly sql: Sql) {}

  async loadWorkflowItems(asOf: string): Promise<OperationItem[]> {
    const rows = await this.sql<{
      id: string;
      priority: OperationItem["priority"];
      category: OperationItem["category"];
      title: string;
      detail: string;
      evidence: string;
    }[]>`
      WITH latest_batch AS (
        SELECT DISTINCT ON (batch.id)
          batch.id, batch.batch_number, plan.id AS plan_id,
          COALESCE(transition.to_state, 'pending') AS state,
          transition.reason, transition.recorded_at
        FROM refill_batch batch
        JOIN refill_plan plan ON plan.id = batch.plan_id AND plan.status = 'active'
        LEFT JOIN refill_batch_transition transition ON transition.batch_id = batch.id
        ORDER BY batch.id, transition.recorded_at DESC NULLS LAST, transition.id DESC NULLS LAST
      ),
      due_review(cadence, maximum_age) AS (
        VALUES ('daily', 1), ('weekly', 7), ('monthly', 31), ('quarterly', 92)
      ),
      latest_review AS (
        SELECT cadence, max(as_of) AS latest_as_of
        FROM investment_review WHERE status = 'confirmed' AND scope = 'portfolio'
        GROUP BY cadence
      )
      SELECT
        'refill:' || id::text AS id,
        CASE WHEN batch_number = 3 AND state = 'eligible' THEN 'critical'
             WHEN state = 'eligible' THEN 'action' ELSE 'review' END AS priority,
        'refill' AS category,
        CASE WHEN state = 'eligible' THEN '回补批次已满足条件'
             WHEN state = 'blocked' THEN '回补批次仍被阻断'
             ELSE '未执行回补需要季度复盘' END AS title,
        '计划 ' || plan_id::text || ' · 第 ' || batch_number || ' 批 · ' || state AS detail,
        COALESCE(reason, '等待新的确定性评估') AS evidence
      FROM latest_batch
      WHERE state IN ('eligible', 'blocked', 'not_executed')

      UNION ALL

      SELECT
        'catalyst-expired:' || catalyst.id::text, 'action', 'governance',
        '催化剂有效期已过',
        candidate.instrument_id || ' · ' || catalyst.title,
        '有效至 ' || catalyst.valid_through::text
      FROM candidate_catalyst catalyst
      JOIN investment_candidate candidate ON candidate.id = catalyst.candidate_id
      WHERE catalyst.status = 'planned' AND catalyst.valid_through < ${asOf}::date

      UNION ALL

      SELECT
        'exception-review:' || exception.id::text, 'review', 'review',
        '特事特看等待季度复盘',
        exception.action,
        '决定于 ' || exception.decided_at::date::text
      FROM exception_record exception
      WHERE exception.review_status = 'pending'

      UNION ALL

      SELECT
        'review-due:' || due.cadence, 'review', 'review',
        due.cadence || ' 组合复盘到期',
        '需要形成结构化复盘并绑定当时的策略、参数和计算版本',
        CASE WHEN latest.latest_as_of IS NULL THEN '尚无已确认复盘'
             ELSE '最近复盘 ' || latest.latest_as_of::text END
      FROM due_review due
      LEFT JOIN latest_review latest ON latest.cadence = due.cadence
      WHERE latest.latest_as_of IS NULL
         OR latest.latest_as_of < ${asOf}::date - due.maximum_age

      UNION ALL

      SELECT
        'theme-approval:' || version.id::text, 'review', 'approval',
        '主题版本等待确认',
        theme.name || ' · ' || version.phase,
        '草稿日期 ' || version.as_of::text
      FROM theme_version version
      JOIN investment_theme theme ON theme.id = version.theme_id
      WHERE version.status = 'draft' AND theme.status = 'active'

      UNION ALL

      SELECT
        'claim-outcome:' || claim.id::text, 'review', 'review',
        '长期命题等待验证',
        candidate.instrument_id || ' · ' || claim.statement,
        '置信度 ' || round(claim.confidence * 100)::text || '% · 已等待 '
          || (${asOf}::date - claim.as_of)::text || ' 天'
      FROM research_claim claim
      JOIN investment_candidate candidate ON candidate.id = claim.candidate_id
      WHERE claim.as_of <= ${asOf}::date - 90
        AND NOT EXISTS (
          SELECT 1 FROM claim_outcome outcome WHERE outcome.claim_id = claim.id
        )

      UNION ALL

      SELECT
        'data-source:' || definition.id,
        CASE WHEN definition.required THEN 'critical' ELSE 'review' END,
        'data',
        '数据源需要处理',
        definition.capability || ' · ' || definition.provider,
        CASE
          WHEN observation.id IS NULL THEN '尚无健康观测'
          WHEN observation.status = 'failure' THEN observation.detail
          ELSE '有效数据已超过 ' || definition.maximum_age_hours::text || ' 小时'
        END
      FROM data_source_definition definition
      LEFT JOIN LATERAL (
        SELECT * FROM data_source_observation
        WHERE source_id = definition.id ORDER BY observed_at DESC, recorded_at DESC LIMIT 1
      ) observation ON true
      WHERE definition.status = 'active'
        AND (
          observation.id IS NULL
          OR observation.status = 'failure'
          OR (
            definition.maximum_age_hours IS NOT NULL
            AND observation.effective_at < now() - (definition.maximum_age_hours * interval '1 hour')
          )
        )

      ORDER BY priority, category, id
    `;
    return rows;
  }
}
