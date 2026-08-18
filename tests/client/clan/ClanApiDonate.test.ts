import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/client/Api", () => ({
  getApiBase: vi.fn(() => "http://localhost:3000"),
}));

vi.mock("../../../src/client/Auth", () => ({
  getAuthHeader: vi.fn(async () => "Bearer test-token"),
}));

import { donateToClan } from "../../../src/client/ClanApi";

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

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("donateToClan", () => {
  it("POSTs the amount as a string with the idempotency key and auth", async () => {
    const fetchMock = mockFetch(() => res(201, { id: "1" }));
    const result = await donateToClan("tst", "soft", "300", "key-1234567");
    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3000/clans/tst/donate");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      currencyType: "soft",
      amount: "300",
      idempotencyKey: "key-1234567",
    });
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers.Authorization).toBe("Bearer test-token");
  });

  it("keeps a bigint-sized amount exact on the wire", async () => {
    const fetchMock = mockFetch(() => res(201, {}));
    await donateToClan("TST", "soft", "9007199254740993", "k".repeat(8));
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toContain('"amount":"9007199254740993"');
  });

  it("maps 400 'Insufficient balance' to the insufficient key", async () => {
    mockFetch(() =>
      res(400, { error: "Bad request", message: "Insufficient balance" }),
    );
    expect(await donateToClan("TST", "hard", "5", "k".repeat(8))).toEqual({
      error: "clan_modal.donate_insufficient",
    });
  });

  it("maps other 400s to the generic failure key", async () => {
    mockFetch(() => res(400, { error: "amount: must be positive" }));
    expect(await donateToClan("TST", "hard", "0", "k".repeat(8))).toEqual({
      error: "clan_modal.error_failed",
    });
  });

  it("maps 401 to the sign-in key", async () => {
    mockFetch(() => res(401, { error: "Unauthorized" }));
    expect(await donateToClan("TST", "soft", "1", "k".repeat(8))).toEqual({
      error: "clan_modal.sign_in_for_clans",
    });
  });

  it("maps 403 to the not-a-member key", async () => {
    mockFetch(() => res(403, { error: "Forbidden" }));
    expect(await donateToClan("TST", "soft", "1", "k".repeat(8))).toEqual({
      error: "clan_modal.donate_not_member",
    });
  });

  it("maps 404 to the generic failure key", async () => {
    mockFetch(() => res(404, { error: "Not found" }));
    expect(await donateToClan("NOPE", "soft", "1", "k".repeat(8))).toEqual({
      error: "clan_modal.error_failed",
    });
  });

  it("retries a dead network with the same idempotency key, then succeeds", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const fetchMock = mockFetch(() => {
      calls++;
      if (calls < 3) throw new TypeError("Failed to fetch");
      return res(201, {});
    });
    const pending = donateToClan("TST", "soft", "42", "same-key-1");
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const bodies = fetchMock.mock.calls.map(
      (c) => (c[1] as RequestInit).body as string,
    );
    expect(new Set(bodies).size).toBe(1);
    expect(bodies[0]).toContain('"idempotencyKey":"same-key-1"');
  });

  it("gives up with the network key after the retries are exhausted", async () => {
    vi.useFakeTimers();
    const fetchMock = mockFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    const pending = donateToClan("TST", "soft", "42", "same-key-1");
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toEqual({ error: "clan_modal.error_network" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry a real error response", async () => {
    const fetchMock = mockFetch(() => res(403, {}));
    await donateToClan("TST", "soft", "1", "k".repeat(8));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
