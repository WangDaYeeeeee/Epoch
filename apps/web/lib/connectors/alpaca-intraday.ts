import type { IntradayBar } from "../domain/market-signal";

type AlpacaBar = { t?: string; o?: number; h?: number; l?: number; c?: number; v?: number };
type AlpacaResponse = {
  bars?: Record<string, AlpacaBar[]>;
  next_page_token?: string | null;
};

export class AlpacaIntradayProvider {
  readonly id = "alpaca-iex";

  constructor(
    private readonly keyId: string,
    private readonly secretKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly baseUrl = "https://data.alpaca.markets",
  ) {
    if (!keyId || !secretKey) throw new Error("Alpaca API credentials are required");
  }

  async fetchBars(input: { symbols: string[]; start: string; end: string }): Promise<IntradayBar[]> {
    if (!input.symbols.length) throw new Error("At least one Alpaca symbol is required");
    const observedAt = new Date().toISOString();
    const output: IntradayBar[] = [];
    let pageToken: string | null = null;
    do {
      const url = new URL("/v2/stocks/bars", this.baseUrl);
      url.searchParams.set("symbols", input.symbols.join(","));
      url.searchParams.set("timeframe", "1Min");
      url.searchParams.set("start", input.start);
      url.searchParams.set("end", input.end);
      url.searchParams.set("feed", "iex");
      url.searchParams.set("adjustment", "raw");
      url.searchParams.set("limit", "10000");
      if (pageToken) url.searchParams.set("page_token", pageToken);
      const response = await this.fetchImpl(url, {
        headers: {
          "APCA-API-KEY-ID": this.keyId,
          "APCA-API-SECRET-KEY": this.secretKey,
        },
      });
      if (!response.ok) throw new Error(`Alpaca intraday request failed: HTTP ${response.status}`);
      const body = await response.json() as AlpacaResponse;
      for (const [symbol, bars] of Object.entries(body.bars ?? {})) {
        for (const bar of bars) {
          if (!bar.t || [bar.o, bar.h, bar.l, bar.c, bar.v].some((value) => value == null)) {
            throw new Error(`Alpaca returned an incomplete bar for ${symbol}`);
          }
          output.push({
            instrumentId: `US:${symbol}`,
            timestamp: bar.t,
            open: bar.o!,
            high: bar.h!,
            low: bar.l!,
            close: bar.c!,
            volume: bar.v!,
            provider: this.id,
            observedAt,
          });
        }
      }
      pageToken = body.next_page_token ?? null;
    } while (pageToken);
    return output;
  }
}
