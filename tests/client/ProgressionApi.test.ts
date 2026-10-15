import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Auth", () => ({
  getAuthHeader: vi.fn(async () => "Bearer test-token"),
}));

vi.mock("../../src/client/ApiBase", () => ({
  getApiBase: () => "https://api.test",
}));

import type { GameXpResponse } from "@openfront/shared/ApiSchemas";
import { getAuthHeader } from "../../src/client/Auth";
import {
  fetchMyGameXp,
  fetchProgressionConfig,
  fetchPublicPlayerProgress,
  type GameXpFetchResult,
  pollGameXp,
  prestigeMe,
} from "../../src/client/ProgressionApi";

const ineligible: GameXpResponse = {
  gameId: "g1",
  eligible: false,
  reason: "too_short",
};

// Answers from a queue; once it runs dry, the last answer repeats.
function fetcherOf(answers: GameXpFetchResult[]) {
  return vi.fn(async () =>
    answers.length > 1 ? answers.shift()! : answers[0],
  );
}

// Counts the abort listeners currently attached to a signal.
function trackListeners(signal: AbortSignal) {
  const live = new Set<EventListenerOrEventListenerObject>();
  const add = signal.addEventListener.bind(signal);
  const remove = signal.removeEventListener.bind(signal);
  vi.spyOn(signal, "addEventListener").mockImplementation(
    (type: string, listener, opts) => {
      if (type === "abort" && listener) live.add(listener);
      add(type, listener, opts);
    },
  );
  vi.spyOn(signal, "removeEventListener").mockImplementation(
    (type: string, listener, opts) => {
      if (type === "abort" && listener) live.delete(listener);
      remove(type, listener, opts);
    },
  );
  return () => live.size;
}

describe("pollGameXp", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("asks again until the game is processed", async () => {
    const fetcher = fetcherOf([
      { status: "pending" },
      { status: "pending" },
      { status: "ok", data: ineligible },
    ]);
    const result = pollGameXp("g1", { intervalMs: 100, fetcher });
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(result).resolves.toEqual(ineligible);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("leaves no abort listener behind on the caller's signal", async () => {
    const controller = new AbortController();
    const liveListeners = trackListeners(controller.signal);
    const fetcher = fetcherOf([
      { status: "pending" },
      { status: "pending" },
      { status: "pending" },
      { status: "pending" },
      { status: "ok", data: ineligible },
    ]);
    const result = pollGameXp("g1", {
      intervalMs: 100,
      signal: controller.signal,
      fetcher,
    });
    // Mid-poll there is at most the one wait's listener.
    await vi.advanceTimersByTimeAsync(250);
    expect(liveListeners()).toBeLessThanOrEqual(1);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(result).resolves.toEqual(ineligible);
    expect(fetcher).toHaveBeenCalledTimes(5);
    // Four waits, each one's listener removed when its timer fired.
    expect(controller.signal.addEventListener).toHaveBeenCalledTimes(4);
    expect(liveListeners()).toBe(0);
  });

  it("stops at once when the caller aborts mid-wait", async () => {
    const controller = new AbortController();
    const fetcher = fetcherOf([{ status: "pending" }]);
    const result = pollGameXp("g1", {
      intervalMs: 10_000,
      signal: controller.signal,
      fetcher,
    });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    await expect(result).resolves.toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels a request already in flight when the caller aborts", async () => {
    let requestSignal: AbortSignal | undefined;
    // A request that never answers on its own: it ends only when its signal
    // aborts, the way fetch does.
    const fetchStub = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          requestSignal = init.signal ?? undefined;
          requestSignal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    vi.stubGlobal("fetch", fetchStub);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const controller = new AbortController();
      const result = pollGameXp("g1", { signal: controller.signal });
      await vi.waitFor(() => expect(fetchStub).toHaveBeenCalledTimes(1));
      expect(requestSignal?.aborted).toBe(false);
      controller.abort();
      expect(requestSignal?.aborted).toBe(true);
      await expect(result).resolves.toBeNull();
      expect(fetchStub).toHaveBeenCalledTimes(1);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("gives up at the deadline", async () => {
    const fetcher = fetcherOf([{ status: "pending" }]);
    const result = pollGameXp("g1", {
      intervalMs: 100,
      timeoutMs: 1_000,
      fetcher,
    });
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(result).resolves.toBeNull();
    expect(fetcher.mock.calls.length).toBeLessThanOrEqual(11);
  });
});

// The mapping that keeps a retry from becoming a second prestige: only a 409
// means "you can't prestige from here"; everything else may or may not have
// gone through, so the caller retries with the same key.
describe("prestigeMe", () => {
  const PROGRESS = {
    prestige: 4,
    level: 1,
    xpInLevel: 0,
    xpForNext: 150,
    lifetimeXp: 820000,
    legend: false,
    canPrestige: false,
  };
  const REWARD = {
    id: "r1",
    currencyType: "soft",
    amount: "5000",
    reason: "prestige",
    note: null,
  };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(getAuthHeader).mockResolvedValue("Bearer test-token");
  });

  const respond = (status: number, body: unknown = {}) =>
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(body), { status }),
    );

  it("posts with the idempotency key and parses the answer", async () => {
    respond(200, { progress: PROGRESS, rewards: [REWARD] });
    const result = await prestigeMe("key-1234");
    expect(result).toEqual({
      ok: true,
      data: { progress: PROGRESS, rewards: [REWARD] },
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.test/users/@me/prestige");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer test-token",
      "Idempotency-Key": "key-1234",
    });
  });

  it("treats a missing rewards list as none", async () => {
    respond(200, { progress: PROGRESS });
    const result = await prestigeMe("key-1234");
    expect(result).toEqual({
      ok: true,
      data: { progress: PROGRESS, rewards: [] },
    });
  });

  it("reads a 409 as refused", async () => {
    respond(409, { reason: "not_eligible" });
    expect(await prestigeMe("key-1234")).toEqual({
      ok: false,
      reason: "refused",
    });
  });

  it("reads 401 and 403 as signed out", async () => {
    respond(401);
    expect(await prestigeMe("key-1234")).toEqual({
      ok: false,
      reason: "signed_out",
    });
    respond(403);
    expect(await prestigeMe("key-1234")).toEqual({
      ok: false,
      reason: "signed_out",
    });
  });

  it("doesn't call out without a session", async () => {
    vi.mocked(getAuthHeader).mockResolvedValueOnce("");
    expect(await prestigeMe("key-1234")).toEqual({
      ok: false,
      reason: "signed_out",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads anything else as a failure to retry", async () => {
    for (const status of [400, 404, 429, 500, 503]) {
      respond(status);
      expect(await prestigeMe("key-1234")).toEqual({
        ok: false,
        reason: "failed",
      });
    }
    // An answer that doesn't parse, and no answer at all.
    respond(200, { progress: { level: "high" } });
    expect(await prestigeMe("key-1234")).toEqual({
      ok: false,
      reason: "failed",
    });
    fetchMock.mockRejectedValueOnce(new TypeError("network down"));
    expect(await prestigeMe("key-1234")).toEqual({
      ok: false,
      reason: "failed",
    });
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const eligibleBody = {
  gameId: "g1",
  eligible: true,
  breakdown: {
    played: 50,
    subtotal: 50,
    gamePermille: 1000,
    subscriberPermille: 1000,
    total: 50,
  },
  before: { prestige: 0, level: 1, xpInLevel: 0, xpForNext: 100 },
  after: {
    prestige: 0,
    level: 1,
    xpInLevel: 50,
    xpForNext: 100,
    lifetimeXp: 50,
    legend: false,
    canPrestige: false,
  },
};

const configBody = {
  version: 1,
  maxLevel: 100,
  maxPrestige: 10,
  levels: [{ level: 1, xpToNext: 100, cumulativeXp: 0 }],
  flares: [],
};

describe("fetchMyGameXp", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function answer(response: () => Response) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response()),
    );
  }

  it("reads a processed game", async () => {
    answer(() => jsonResponse(eligibleBody));
    const result = await fetchMyGameXp("g1");
    expect(result.status).toBe("ok");
  });

  it("keeps asking about a game not processed yet (404)", async () => {
    answer(() => new Response("", { status: 404 }));
    await expect(fetchMyGameXp("g1")).resolves.toEqual({ status: "pending" });
  });

  it("stops asking when the session is refused (401, 403)", async () => {
    answer(() => new Response("", { status: 401 }));
    await expect(fetchMyGameXp("g1")).resolves.toEqual({
      status: "unavailable",
    });
    answer(() => new Response("", { status: 403 }));
    await expect(fetchMyGameXp("g1")).resolves.toEqual({
      status: "unavailable",
    });
  });

  it("keeps asking through a server error (500)", async () => {
    answer(() => new Response("", { status: 500 }));
    await expect(fetchMyGameXp("g1")).resolves.toEqual({ status: "pending" });
  });

  it("stops asking when the body can't be read, rather than poll it", async () => {
    answer(() => jsonResponse({ gameId: "g1", eligible: true }));
    await expect(fetchMyGameXp("g1")).resolves.toEqual({
      status: "unavailable",
    });
  });

  it("keeps asking through a network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network down");
      }),
    );
    await expect(fetchMyGameXp("g1")).resolves.toEqual({ status: "pending" });
  });
});

describe("fetchPublicPlayerProgress", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reads a player's level, and says false for anything else", async () => {
    const progress = {
      prestige: 1,
      level: 12,
      lifetimeXp: 4200,
      legend: false,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(progress)),
    );
    await expect(fetchPublicPlayerProgress("p1")).resolves.toEqual(progress);
    for (const response of [
      () => new Response("", { status: 404 }),
      () => new Response("", { status: 500 }),
      () => jsonResponse({ level: "twelve" }),
    ]) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => response()),
      );
      await expect(fetchPublicPlayerProgress("p1")).resolves.toBe(false);
    }
  });
});

describe("fetchProgressionConfig", () => {
  // The memo is module state: a fresh copy of the module per test.
  let fetchConfig: typeof fetchProgressionConfig;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.resetModules();
    ({ fetchProgressionConfig: fetchConfig } =
      await import("../../src/client/ProgressionApi"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function answers(responses: (() => Response)[]) {
    const fetchMock = vi.fn(async () =>
      (responses.length > 1 ? responses.shift()! : responses[0])(),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("asks once while the config is fresh, then again once it is stale", async () => {
    const fetchMock = answers([() => jsonResponse(configBody)]);
    await expect(fetchConfig()).resolves.toEqual(configBody);
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(fetchConfig()).resolves.toEqual(configBody);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Past the server's 60s max-age: a deploy that changed it shows up.
    await vi.advanceTimersByTimeAsync(31_000);
    await fetchConfig();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shares one request between callers while it is in flight", async () => {
    const fetchMock = answers([() => jsonResponse(configBody)]);
    const [a, b] = await Promise.all([fetchConfig(), fetchConfig()]);
    expect(a).toEqual(configBody);
    expect(b).toEqual(configBody);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("asks again after a failure, rather than remember it", async () => {
    const fetchMock = answers([
      () => new Response("", { status: 503 }),
      () => jsonResponse(configBody),
    ]);
    await expect(fetchConfig()).resolves.toBe(false);
    await expect(fetchConfig()).resolves.toEqual(configBody);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("says false when progression is off (404) or the body can't be read", async () => {
    answers([() => new Response("", { status: 404 })]);
    await expect(fetchConfig()).resolves.toBe(false);
    answers([() => jsonResponse({ version: "one" })]);
    await expect(fetchConfig()).resolves.toBe(false);
  });
});
