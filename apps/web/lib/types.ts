export type PortfolioPayload = {
  meta: { account: string; asOf: string; baseCurrency: string; benchmark: string; strategyVersion: string };
  summary: { nav: number; cash: number; portfolioReturn: number; benchmarkReturn: number; activeReturn: number; maxDrawdown?: number };
  series: { date: string; portfolio: number; benchmark: number; nav: number; drawdown?: number; benchmarkDrawdown?: number }[];
  events?: { date: string; type: string; label: string; details?: string[] }[];
  positions: { symbol: string; name?: string; quantity: number; marketValue: number; currency?: string }[];
  health: { status: string; ledgerBalanced: boolean; reconciliationDifference: number; source: string; message: string };
};
