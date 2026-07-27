export type ResearchMemoryKind = "claim" | "evidence" | "theme" | "review";

export function normalizeMemoryQuery(value: string): string[] {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length < 2) throw new Error("Research memory query requires at least 2 characters");
  if (normalized.length > 200) throw new Error("Research memory query exceeds 200 characters");
  return [...new Set(normalized.toLocaleLowerCase().split(" ").filter((token) => token.length >= 2))].slice(0, 10);
}

export function memoryMatchScore(text: string, tokens: string[]): number {
  const haystack = text.toLocaleLowerCase();
  return tokens.reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0) / tokens.length;
}
