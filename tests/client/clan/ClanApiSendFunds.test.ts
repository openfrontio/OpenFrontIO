import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/client/Api", () => ({
  getApiBase: vi.fn(() => "http://localhost:3000"),
}));

vi.mock("../../../src/client/Auth", () => ({
  getAuthHeader: vi.fn(async () => "Bearer test-token"),
}));

import { sendClanFunds } from "../../../src/client/ClanApi";

const res = (status: number, data: unknown = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => data,
});

const mockFetch = (impl: (...args: unknown[]) => unknown) => {
  const fn = vi.fn(impl);
  vi.stubGlobal("fetch", fn);
  return fn;
};

const sendIt = () => sendClanFunds("TST", "member-2", "500", "key-12345678");

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("sendClanFunds", () => {
  it("POSTs the recipient, amount and key", async () => {
    const fetchMock = mockFetch(() => res(201, { id: "1" }));
    expect(await sendIt()).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3000/clans/TST/fund_transfers");
    expect(JSON.parse(init.body as string)).toEqual({
      recipient: "member-2",
      amount: "500",
      idempotencyKey: "key-12345678",
    });
  });

  it("reads a key conflict as an earlier send that went through", async () => {
    mockFetch(() => res(409, { code: "idempotency_conflict" }));
    expect(await sendIt()).toEqual({
      error: "clan_modal.send_funds_error_earlier_send",
      outcome: "earlier_send",
    });
  });

  it("can't tell after a network error or a 5xx", async () => {
    const unknown = {
      error: "clan_modal.send_funds_error_unknown",
      outcome: "unknown",
    };
    mockFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    expect(await sendIt()).toEqual(unknown);
    mockFetch(() => res(503, {}));
    expect(await sendIt()).toEqual(unknown);
  });

  it("maps refusals to their own keys", async () => {
    mockFetch(() => res(400, { code: "recipient_daily_limit" }));
    expect(await sendIt()).toEqual({
      error: "clan_modal.send_funds_error_recipient_limit",
      outcome: "refused",
    });
    mockFetch(() => res(400, { code: "something_new" }));
    expect(await sendIt()).toEqual({
      error: "clan_modal.error_failed",
      outcome: "refused",
    });
    mockFetch(() => res(403, {}));
    expect(await sendIt()).toEqual({
      error: "clan_modal.send_funds_error_not_leader",
      outcome: "refused",
    });
  });
});
