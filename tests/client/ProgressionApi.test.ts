import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Auth", () => ({
  getAuthHeader: vi.fn(async () => "Bearer test-token"),
}));

vi.mock("../../src/client/ApiBase", () => ({
  getApiBase: () => "https://api.test",
}));

import {
  type GameXpFetchResult,
  pollGameXp,
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
