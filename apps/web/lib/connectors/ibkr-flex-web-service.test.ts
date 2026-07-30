import { describe, expect, it, vi } from "vitest";
import { fetchIbkrFlexReport } from "./ibkr-flex-web-service";

const response = (text: string, contentType = "text/xml") => new Response(text, {
  status: 200,
  headers: { "content-type": contentType },
});

describe("IBKR Flex Web Service", () => {
  it("generates, polls, and retrieves a CSV report without exposing the token", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response("<FlexStatementResponse><Status>Success</Status><ReferenceCode>1234</ReferenceCode></FlexStatementResponse>"))
      .mockResolvedValueOnce(response("<FlexStatementResponse><Status>Fail</Status><ErrorCode>1019</ErrorCode><ErrorMessage>Statement generation in progress</ErrorMessage></FlexStatementResponse>"))
      .mockResolvedValueOnce(response("Trades,Header,TradeID\nTrades,Data,1\n", "text/csv"));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(fetchIbkrFlexReport({
      token: "secret-token",
      queryId: "987",
      pollIntervalMs: 1,
    }, { fetchImpl, sleep })).resolves.toMatchObject({
      referenceCode: "1234",
      contentType: "text/csv",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0][1]?.headers).toMatchObject({ "user-agent": expect.stringContaining("Epoch") });
  });

  it("reports permanent service errors with the IBKR code", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(
      "<FlexStatementResponse><Status>Fail</Status><ErrorCode>1012</ErrorCode><ErrorMessage>Token has expired</ErrorMessage></FlexStatementResponse>",
    ));
    await expect(fetchIbkrFlexReport({ token: "expired", queryId: "1" }, { fetchImpl }))
      .rejects.toThrow("1012: Token has expired");
  });
});
