import { describe, expect, it, vi } from "vitest";
import { fetchFredBenchmark, parseFredCsv } from "./fred-benchmark";

describe("FRED benchmark connector", () => {
  it("parses daily NASDAQ-100 closes and skips missing observations", () => {
    expect(parseFredCsv("observation_date,NASDAQ100\n2026-07-24,28128.340\n2026-07-25,.\n"))
      .toEqual([{ date: "2026-07-24", close: 28128.34 }]);
  });

  it("requests a bounded public CSV series without an API key", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(
      "DATE,NASDAQ100\n2026-07-27,28039.210\n",
      { status: 200 },
    ));
    await expect(fetchFredBenchmark({
      startDate: "2026-07-20",
      endDate: "2026-07-29",
    }, { fetchImpl })).resolves.toHaveLength(1);
    expect(String(fetchImpl.mock.calls[0][0])).toContain("id=NASDAQ100");
    expect(String(fetchImpl.mock.calls[0][0])).toContain("cosd=2026-07-20");
  });
});
