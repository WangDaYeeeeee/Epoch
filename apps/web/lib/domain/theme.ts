export type ThemePhase = "installation" | "deployment";
export type ThemeVersionInput = {
  asOf: string;
  phase: ThemePhase;
  thesis: string;
  profitPath: string;
  invalidationCondition: string;
  confirmed: boolean;
};

const required = (value: string, name: string, maximum = 5000): string => {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) throw new Error(`${name} must contain 1-${maximum} characters`);
  return normalized;
};

export function validateThemeVersion(input: ThemeVersionInput): ThemeVersionInput {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.asOf)) throw new Error("Theme version asOf must be an ISO date");
  if (!["installation", "deployment"].includes(input.phase)) throw new Error("Unsupported theme phase");
  return {
    ...input,
    thesis: required(input.thesis, "theme.thesis"),
    profitPath: required(input.profitPath, "theme.profitPath"),
    invalidationCondition: required(input.invalidationCondition, "theme.invalidationCondition"),
  };
}
