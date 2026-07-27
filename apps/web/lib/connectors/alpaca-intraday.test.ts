import { describe, expect, it, vi } from "vitest";
import { AlpacaIntradayProvider } from "./alpaca-intraday";

describe("Alpaca intraday provider", () => {
  it("paginates IEX minute bars and preserves provider provenance", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        bars: { QQQ: [{ t: "2026-07-24T13:30:00Z", o: 550, h: 551, l: 549, c: 550.5, v: 100 }] },
        next_page_token: "next",
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        bars: { QQQ: [{ t: "2026-07-24T13:31:00Z", o: 550.5, h: 552, l: 550, c: 551, v: 200 }] },
        next_page_token: null,
      })));
    const bars = await new AlpacaIntradayProvider("key", "secret", fetchImpl).fetchBars({
      symbols: ["QQQ"], start: "2026-07-24T13:30:00Z", end: "2026-07-24T20:00:00Z",
    });
    expect(bars).toHaveLength(2);
    expect(bars[0]).toMatchObject({ instrumentId: "US:QQQ", provider: "alpaca-iex" });
    expect(String(fetchImpl.mock.calls[0][0])).toContain("feed=iex");
    expect(String(fetchImpl.mock.calls[1][0])).toContain("page_token=next");
  });

  it("fails closed without credentials", () => {
    expect(() => new AlpacaIntradayProvider("", "")).toThrow("credentials");
  });
});
