import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Auth", () => ({
  getAuthHeader: vi.fn(async () => "Bearer test-token"),
}));

vi.mock("../../src/client/ApiBase", () => ({
  getApiBase: () => "https://api.test",
}));

import { getAuthHeader } from "../../src/client/Auth";
import {
  type GameXpFetchResult,
  pollGameXp,
  prestigeMe,
} from "../../src/client/ProgressionApi";
import type { GameXpResponse } from "../../src/core/ApiSchemas";

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
