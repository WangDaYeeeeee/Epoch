# Agent Gateway reference

Default endpoint: `http://127.0.0.1:3000/api/v1/agent`

Output schema: `GET /api/v1/agent/schema`

## Start

```json
{
  "action": "start",
  "request": {
    "taskType": "review_portfolio",
    "model": "model-name",
    "promptVersion": "epoch-agent-prompt/1.0",
    "input": {}
  }
}
```

The returned run contains the immutable authorized `dataSnapshot`, strategy and parameter versions, output schema version, and permission manifest.

## Complete

```json
{
  "action": "complete",
  "completion": {
    "runId": "uuid",
    "output": {
      "summary": "..."
    },
    "citations": [
      {
        "evidenceId": "uuid",
        "title": "Primary filing",
        "supports": "Claim supported by this evidence"
      }
    ],
    "limitations": ["No current IV source"],
    "calculationRunIds": []
  }
}
```

Task-specific validation is stricter than the generic JSON Schema. Candidate research requires claims, exactly six factor assessments, a weight-tier proposal, and citations. Rebalance output must not contain `policyGatePassed` or `compliant`.

## Fail or add feedback

Use `action: "fail"` with `runId` and `reason` when the task cannot finish. Use `action: "feedback"` with `runId`, `disposition` (`accepted`, `modified`, or `rejected`), `comment`, and optional `correctedOutput`.

For a completed `propose_rebalance` run, use `action: "evaluate_proposal"` with `runId`. Epoch—not the Agent—builds the risk input, calls Analytics, stores the CalculationRun, and returns Policy Gate results.

## Local CLI

```bash
pnpm agent start request.json
pnpm agent complete completion.json
```

The payload file omits `action`; the CLI adds it from the command.
