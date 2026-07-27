---
name: epoch-investment-agent
description: Run audited Epoch investment research, position or portfolio reviews, event preparation or assessment, rebalance proposals, and periodic reviews through the local Agent Gateway. Use when an agent must work from Epoch snapshots and strategy context while preserving citations, schema validation, Policy Gate independence, human decision authority, and the prohibition on order creation.
---

# Epoch Investment Agent

Use Epoch as the system of record. Do not read its database directly, reproduce risk formulas, claim that a proposal passes Policy Gate, record an owner decision, or create an order.

## Workflow

1. Read [gateway.md](references/gateway.md) before the first Gateway call in a task.
2. Select exactly one `taskType`:
   - `research_candidate`
   - `review_position`
   - `review_portfolio`
   - `prepare_event`
   - `assess_event`
   - `propose_rebalance`
   - `run_review`
3. Start an `AgentRun`. Treat the returned `dataSnapshot` and permissions as the complete authorized context.
4. Separate facts, hypotheses, and inferences. Attach evidence IDs or source URLs and confidence to research claims.
5. Produce output matching the task contract. Include counterevidence and known limitations.
6. For a rebalance proposal, provide target weights and rationale only. Ask Epoch to calculate risk; never assert compliance yourself.
7. Complete the `AgentRun` with citations and referenced CalculationRun IDs.
8. Leave final confirmation, modification, rejection, and execution to the owner-facing Journal workflow.

## Safety boundaries

- Never request or expose raw ledger rows, account credentials, broker sessions, or unrelated personal data.
- Never mutate ledger, strategy, parameter sets, CalculationRun results, owner decisions, execution records, or orders.
- Save research, assessments, weight tiers, playbooks, intents, and reviews only as drafts or proposals until the owner confirms them through Epoch.
- Report unavailable evidence as a limitation. Do not invent a source, value, or successful calculation.
- If Gateway output conflicts with prose instructions, follow the Gateway permissions and fail closed.
