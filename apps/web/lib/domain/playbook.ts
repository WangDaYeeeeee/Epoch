export type PlaybookBranchScope = "instrument" | "theme";
export type PlaybookRiskDirection = "decrease" | "neutral" | "increase";

export type PlaybookBranchInput = {
  scope: PlaybookBranchScope;
  scenario: string;
  trigger: string;
  action: string;
  riskDirection: PlaybookRiskDirection;
};

export type PlaybookInput = {
  eventType: string;
  status: "draft" | "ready";
  summary: string;
  asOf: string;
  branches: PlaybookBranchInput[];
};

const required = (value: string, name: string, maximum = 2000): string => {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) throw new Error(`${name} must contain 1-${maximum} characters`);
  return normalized;
};

export function validatePlaybook(input: PlaybookInput): PlaybookInput {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.asOf)) throw new Error("Playbook asOf must be an ISO date");
  const branches = input.branches.map((branch) => ({
    ...branch,
    scenario: required(branch.scenario, "branch.scenario", 300),
    trigger: required(branch.trigger, "branch.trigger"),
    action: required(branch.action, "branch.action"),
  }));
  if (input.status === "ready") {
    if (!branches.length) throw new Error("A ready playbook requires at least one branch");
    if (input.eventType === "earnings"
      && (!branches.some((branch) => branch.scope === "instrument")
        || !branches.some((branch) => branch.scope === "theme"))) {
      throw new Error("A ready earnings playbook requires instrument and theme branches");
    }
  }
  return { ...input, summary: required(input.summary, "playbook.summary"), branches };
}

export function validateException(input: {
  uncoveredReason: string;
  logicChange: string;
  action: string;
  decidedAt: string;
  executeAfter: string;
  delayWaiverReason?: string | null;
}): typeof input {
  if (!Number.isFinite(Date.parse(input.decidedAt)) || !Number.isFinite(Date.parse(input.executeAfter))) {
    throw new Error("Exception timestamps must be valid");
  }
  if (input.executeAfter.slice(0, 10) <= input.decidedAt.slice(0, 10) && !input.delayWaiverReason?.trim()) {
    throw new Error("A same-day or early execution requires a written delay waiver");
  }
  return {
    ...input,
    uncoveredReason: required(input.uncoveredReason, "exception.uncoveredReason"),
    logicChange: required(input.logicChange, "exception.logicChange"),
    action: required(input.action, "exception.action"),
    delayWaiverReason: input.delayWaiverReason?.trim() || null,
  };
}
