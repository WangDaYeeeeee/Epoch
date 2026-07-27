export type CatalystStatus = "planned" | "realized" | "invalidated" | "expired";
export type ExitType = "active_exit" | "risk_reduction";

export type CatalystInput = {
  title: string;
  expectedDate: string;
  validThrough: string;
  status: CatalystStatus;
  observableOutcome: string;
};

export type InvalidationConditionInput = {
  statement: string;
  observableMetric: string;
  trigger: string;
};

const isoDate = (value: string, name: string): string => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`${name} must be an ISO date`);
  }
  return value;
};

const required = (value: string, name: string, maximum = 2000): string => {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) throw new Error(`${name} must contain 1-${maximum} characters`);
  return normalized;
};

export function validateCatalyst(input: CatalystInput): CatalystInput {
  const expectedDate = isoDate(input.expectedDate, "expectedDate");
  const validThrough = isoDate(input.validThrough, "validThrough");
  if (validThrough < expectedDate) throw new Error("Catalyst validThrough cannot precede expectedDate");
  return {
    ...input,
    title: required(input.title, "catalyst.title", 300),
    observableOutcome: required(input.observableOutcome, "catalyst.observableOutcome"),
    expectedDate,
    validThrough,
  };
}

export function validateInvalidationCondition(input: InvalidationConditionInput): InvalidationConditionInput {
  return {
    statement: required(input.statement, "invalidation.statement"),
    observableMetric: required(input.observableMetric, "invalidation.observableMetric", 500),
    trigger: required(input.trigger, "invalidation.trigger", 1000),
  };
}

const addCalendarDays = (date: string, days: number): string => {
  const value = new Date(`${isoDate(date, "exitDate")}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

export function exitRestriction(input: {
  exitType: ExitType;
  exitDate: string;
}): { restricted: boolean; restrictedUntil: string | null } {
  return input.exitType === "active_exit"
    ? { restricted: true, restrictedUntil: addCalendarDays(input.exitDate, 90) }
    : { restricted: false, restrictedUntil: null };
}
