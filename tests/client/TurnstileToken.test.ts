/**
 * OPE-456. The join path used to hang with "Turnstile error: 300030" because
 * the widget was rendered in Turnstile's default `execution: "render"` mode --
 * it started a challenge by itself -- and the callbacks were only attached to
 * the execute() call that Turnstile then refused ("Call to execute() on a
 * widget that is already executing"). Nothing settled the promise the boot
 * prefetch handed to the join.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  requestTurnstileToken,
  resolveTurnstileToken,
  TURNSTILE_TIMEOUT_CODE,
  TURNSTILE_TOKEN_TIMEOUT_MS,
  TURNSTILE_TOKEN_TTL_MS,
  TurnstileError,
  type TurnstileApi,
  type TurnstileRenderOptions,
  type TurnstileToken,
} from "../../src/client/TurnstileToken";

function fakeTurnstile() {
  const renders: TurnstileRenderOptions[] = [];
  const api: TurnstileApi = {
    // Like the real one, refuses an element that already holds a widget.
    render: vi.fn(
      (host: string | HTMLElement, options: TurnstileRenderOptions) => {
        if (typeof host === "string" || host.childElementCount > 0) {
          throw new Error("already rendered in this container");
        }
        renders.push(options);
        host.appendChild(document.createElement("iframe"));
        return `widget-${renders.length}`;
      },
    ),
    execute: vi.fn(),
    remove: vi.fn(),
  };
  return {
    api,
    renders,
    options: () => renders[renders.length - 1],
    render: api.render as ReturnType<typeof vi.fn>,
    execute: api.execute as ReturnType<typeof vi.fn>,
    remove: api.remove as ReturnType<typeof vi.fn>,
  };
}

let container: HTMLElement;

function request(turnstile: TurnstileApi, timeoutMs?: number) {
  return requestTurnstileToken(turnstile, {
    sitekey: "site-key",
    container,
    timeoutMs,
  });
}

describe("requestTurnstileToken runs exactly one challenge", () => {
  beforeEach(() => {
    container = document.createElement("div");
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // The defect itself: with execution left at its default the widget starts a
  // challenge on render, and the execute() that carries the callbacks is
  // refused -- so no callback is ever attached to anything.
  it("holds the challenge until execute and attaches callbacks on render", () => {
    const fake = fakeTurnstile();

    const promise = request(fake.api);

    expect(fake.render).toHaveBeenCalledTimes(1);
    const options = fake.options();
    expect(options.execution).toBe("execute");
    expect(typeof options.callback).toBe("function");
    expect(typeof options["error-callback"]).toBe("function");
    expect(options.sitekey).toBe("site-key");

    options.callback?.("tok");
    return expect(promise).resolves.toMatchObject({ token: "tok" });
  });

  it("executes once, with no options of its own", async () => {
    const fake = fakeTurnstile();

    const promise = request(fake.api);
    fake.options().callback?.("tok");
    await promise;

    expect(fake.execute).toHaveBeenCalledTimes(1);
    // Options on execute() are what made the callbacks belong to the call
    // rather than the widget. The widget id is the whole argument list now.
    expect(fake.execute.mock.calls[0]).toEqual(["widget-1"]);
  });

  it("resolves with a timestamped token and removes the widget", async () => {
    const fake = fakeTurnstile();

    const promise = requestTurnstileToken(fake.api, {
      sitekey: "site-key",
      container,
      now: () => 1000,
    });
    fake.options().callback?.("tok");

    await expect(promise).resolves.toEqual({ token: "tok", createdAt: 1000 });
    expect(fake.remove).toHaveBeenCalledWith("widget-1");
  });

  it("rejects with the Turnstile code and removes the widget", async () => {
    const fake = fakeTurnstile();

    const promise = request(fake.api);
    fake.options()["error-callback"]?.("300030");

    await expect(promise).rejects.toMatchObject({ code: "300030" });
    expect(fake.remove).toHaveBeenCalledWith("widget-1");
  });

  it("rejects and removes the widget when nothing answers in time", async () => {
    vi.useFakeTimers();
    const fake = fakeTurnstile();

    const promise = request(fake.api);
    const assertion = expect(promise).rejects.toMatchObject({
      code: TURNSTILE_TIMEOUT_CODE,
    });
    vi.advanceTimersByTime(TURNSTILE_TOKEN_TIMEOUT_MS);
    await assertion;

    expect(fake.remove).toHaveBeenCalledWith("widget-1");
  });

  // Turnstile's own watchdog reports the hung widget at ~30s as 300030, which
  // is the error this bug surfaced as. Failing first is the point.
  it("gives up before Turnstile's own watchdog", () => {
    expect(TURNSTILE_TOKEN_TIMEOUT_MS).toBeLessThan(30_000);
  });

  it("ignores a callback that arrives after the widget is gone", async () => {
    vi.useFakeTimers();
    const fake = fakeTurnstile();

    const promise = request(fake.api);
    const assertion = expect(promise).rejects.toBeInstanceOf(TurnstileError);
    vi.advanceTimersByTime(TURNSTILE_TOKEN_TIMEOUT_MS);
    await assertion;

    // A late success and a late error both land on a widget id Turnstile no
    // longer knows; neither may re-settle the promise or throw.
    expect(() => fake.options().callback?.("late")).not.toThrow();
    expect(() => fake.options()["error-callback"]?.("300030")).not.toThrow();
    expect(fake.remove).toHaveBeenCalledTimes(1);
  });

  it("rejects when execute throws", async () => {
    const fake = fakeTurnstile();
    fake.execute.mockImplementation(() => {
      throw new Error("boom");
    });

    await expect(request(fake.api)).rejects.toThrow("boom");
    expect(fake.remove).toHaveBeenCalledWith("widget-1");
    expect(container.childElementCount).toBe(0);
  });

  // CrazyGames: every join requests a fresh token while the boot prefetch may
  // still be running. Both used to render into #turnstile-container itself;
  // Turnstile refused the second, its execute() hit the first widget, and the
  // join timed out.
  it("gives overlapping requests their own host elements", async () => {
    const fake = fakeTurnstile();

    const first = request(fake.api);
    const second = request(fake.api);

    expect(fake.renders).toHaveLength(2);
    expect(container.childElementCount).toBe(2);
    const firstHost = container.children[0];
    fake.renders[1].callback?.("second");
    await expect(second).resolves.toMatchObject({ token: "second" });
    expect(container.children).toHaveLength(1);
    expect(container.children[0]).toBe(firstHost);
    fake.renders[0].callback?.("first");
    await expect(first).resolves.toMatchObject({ token: "first" });
  });

  // Turnstile sometimes loses track of a widget id ("Nothing to remove found
  // for the provided container") and leaves the widget in the page. Dropping
  // its host takes it out regardless, so it cannot block the next render.
  it("removes the widget's host even when Turnstile cannot", async () => {
    const fake = fakeTurnstile();
    fake.remove.mockImplementation(() => {
      throw new Error("Nothing to remove found");
    });

    const promise = request(fake.api);
    fake.options().callback?.("tok");
    await promise;

    expect(container.childElementCount).toBe(0);
    const next = request(fake.api);
    fake.options().callback?.("next");
    await expect(next).resolves.toMatchObject({ token: "next" });
  });

  it("removes the host when render throws", async () => {
    const fake = fakeTurnstile();
    fake.render.mockImplementation(() => {
      throw new Error("boom");
    });

    await expect(request(fake.api)).rejects.toThrow("boom");
    expect(container.childElementCount).toBe(0);
  });

  it("removes the host when a callback fires during render", async () => {
    const fake = fakeTurnstile();
    fake.render.mockImplementation(
      (host: HTMLElement, options: TurnstileRenderOptions) => {
        host.appendChild(document.createElement("iframe"));
        options.callback?.("early");
        return "widget-1";
      },
    );

    await expect(request(fake.api)).resolves.toMatchObject({ token: "early" });
    expect(fake.execute).not.toHaveBeenCalled();
    expect(fake.remove).toHaveBeenCalledWith("widget-1");
    expect(container.childElementCount).toBe(0);
  });

  it("synchronously clears timer, removes widget, and rejects on AbortSignal", async () => {
    vi.useFakeTimers();
    const fake = fakeTurnstile();
    const controller = new AbortController();
    const timerCountBefore = vi.getTimerCount();

    const promise = requestTurnstileToken(fake.api, {
      sitekey: "site-key",
      container,
      signal: controller.signal,
    });

    expect(fake.render).toHaveBeenCalledTimes(1);
    expect(container.childElementCount).toBe(1);

    controller.abort();

    expect(vi.getTimerCount()).toBe(timerCountBefore);
    expect(fake.remove).toHaveBeenCalledWith("widget-1");
    expect(container.childElementCount).toBe(0);

    vi.advanceTimersByTime(TURNSTILE_TOKEN_TIMEOUT_MS * 2);

    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  });

  it("immediately rejects and cleans host if signal is already aborted", async () => {
    const fake = fakeTurnstile();
    const controller = new AbortController();
    controller.abort();

    const promise = requestTurnstileToken(fake.api, {
      sitekey: "site-key",
      container,
      signal: controller.signal,
    });

    expect(container.childElementCount).toBe(0);
    expect(fake.render).not.toHaveBeenCalled();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("resolveTurnstileToken picks the token a join uses", () => {
  const makeOnError = () => vi.fn((_code?: string) => undefined);
  let onError: ReturnType<typeof makeOnError>;

  beforeEach(() => {
    onError = makeOnError();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  const fresh = (token = "fresh") =>
    vi.fn(async () => ({ token, createdAt: 0 }));

  it("uses a prefetched token that is still good", async () => {
    const requestFresh = fresh();

    await expect(
      resolveTurnstileToken({
        prefetch: Promise.resolve({ token: "pre", createdAt: 0 }),
        requestFresh,
        onError,
        now: () => TURNSTILE_TOKEN_TTL_MS - 1,
      }),
    ).resolves.toBe("pre");
    expect(requestFresh).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("refetches a prefetched token that has expired", async () => {
    const requestFresh = fresh();

    await expect(
      resolveTurnstileToken({
        prefetch: Promise.resolve({ token: "pre", createdAt: 0 }),
        requestFresh,
        onError,
        now: () => TURNSTILE_TOKEN_TTL_MS + 1,
      }),
    ).resolves.toBe("fresh");
    expect(requestFresh).toHaveBeenCalledTimes(1);
  });

  it("always mints a new token when the caller forces it", async () => {
    const requestFresh = fresh();

    await expect(
      resolveTurnstileToken({
        prefetch: Promise.resolve({ token: "pre", createdAt: 0 }),
        requestFresh,
        forceFresh: true,
        onError,
        now: () => 0,
      }),
    ).resolves.toBe("fresh");
    expect(requestFresh).toHaveBeenCalledTimes(1);
  });

  // The join half of OPE-456: a prefetch that died at boot must not be the
  // thing a join reports, and must not cost the join its retry.
  it("drops a rejected prefetch and succeeds on one fresh fetch", async () => {
    const requestFresh = fresh();

    await expect(
      resolveTurnstileToken({
        prefetch: Promise.reject(new TurnstileError("300030")),
        requestFresh,
        onError,
      }),
    ).resolves.toBe("fresh");
    expect(requestFresh).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it("alerts only for the fresh fetch when both attempts fail", async () => {
    const requestFresh = vi.fn(async () => {
      throw new TurnstileError("300031");
    });

    await expect(
      resolveTurnstileToken({
        prefetch: Promise.reject(new TurnstileError("300030")),
        requestFresh,
        onError,
      }),
    ).rejects.toMatchObject({ code: "300031" });
    expect(requestFresh).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith("300031");
  });

  it("fetches fresh when there is no prefetch at all", async () => {
    const requestFresh = fresh();

    await expect(
      resolveTurnstileToken({ prefetch: null, requestFresh, onError }),
    ).resolves.toBe("fresh");
    expect(requestFresh).toHaveBeenCalledTimes(1);
  });

  it("retries requestFresh exactly once on TURNSTILE_TIMEOUT_CODE and succeeds", async () => {
    const requestFresh = vi
      .fn<() => Promise<TurnstileToken>>()
      .mockRejectedValueOnce(new TurnstileError(TURNSTILE_TIMEOUT_CODE))
      .mockResolvedValueOnce({ token: "retried", createdAt: 0 });

    await expect(
      resolveTurnstileToken({
        prefetch: null,
        requestFresh,
        onError,
      }),
    ).resolves.toBe("retried");
    expect(requestFresh).toHaveBeenCalledTimes(2);
    expect(onError).not.toHaveBeenCalled();
  });

  it("invokes onError if both attempts fail with TURNSTILE_TIMEOUT_CODE", async () => {
    const requestFresh = vi
      .fn<() => Promise<TurnstileToken>>()
      .mockRejectedValueOnce(new TurnstileError(TURNSTILE_TIMEOUT_CODE))
      .mockRejectedValueOnce(new TurnstileError(TURNSTILE_TIMEOUT_CODE));

    await expect(
      resolveTurnstileToken({
        prefetch: null,
        requestFresh,
        onError,
      }),
    ).rejects.toMatchObject({ code: TURNSTILE_TIMEOUT_CODE });
    expect(requestFresh).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(TURNSTILE_TIMEOUT_CODE);
  });

  it("does not retry if requestFresh fails with a non-timeout error", async () => {
    const requestFresh = vi
      .fn<() => Promise<TurnstileToken>>()
      .mockRejectedValueOnce(new TurnstileError("300030"));

    await expect(
      resolveTurnstileToken({
        prefetch: null,
        requestFresh,
        onError,
      }),
    ).rejects.toMatchObject({ code: "300030" });
    expect(requestFresh).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith("300030");
  });

  it("skips retry, suppresses onError, and returns null when aborted", async () => {
    const controller = new AbortController();
    const requestFresh = vi.fn(
      (signal?: AbortSignal) =>
        new Promise<TurnstileToken>((_, reject) => {
          signal?.addEventListener("abort", () => {
            const err = new Error("The operation was aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    );

    const promise = resolveTurnstileToken({
      prefetch: null,
      requestFresh,
      signal: controller.signal,
      onError,
    });

    controller.abort();

    await expect(promise).resolves.toBeNull();
    expect(requestFresh).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it("returns null immediately and skips requestFresh if signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const requestFresh = fresh();

    const result = await resolveTurnstileToken({
      prefetch: null,
      requestFresh,
      signal: controller.signal,
      onError,
    });

    expect(result).toBeNull();
    expect(requestFresh).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("skips retry and suppresses onError if aborted after first timeout", async () => {
    const controller = new AbortController();
    let secondAttemptStarted!: () => void;
    const secondAttemptStartedPromise = new Promise<void>((resolve) => {
      secondAttemptStarted = resolve;
    });

    const requestFresh = vi
      .fn<(signal?: AbortSignal) => Promise<TurnstileToken>>()
      .mockRejectedValueOnce(new TurnstileError(TURNSTILE_TIMEOUT_CODE))
      .mockImplementationOnce(
        (signal?: AbortSignal) =>
          new Promise<TurnstileToken>((_, reject) => {
            secondAttemptStarted();
            signal?.addEventListener("abort", () => {
              const err = new Error("The operation was aborted");
              err.name = "AbortError";
              reject(err);
            });
          }),
      );

    const promise = resolveTurnstileToken({
      prefetch: null,
      requestFresh,
      signal: controller.signal,
      onError,
    });

    await secondAttemptStartedPromise;
    controller.abort();

    await expect(promise).resolves.toBeNull();
    expect(requestFresh).toHaveBeenCalledTimes(2);
    expect(requestFresh).toHaveBeenNthCalledWith(2, controller.signal);
    expect(onError).not.toHaveBeenCalled();
  });

  it("returns null and suppresses onError if aborted before initial requestFresh resolves", async () => {
    const controller = new AbortController();
    let resolveFresh!: (token: TurnstileToken) => void;
    const requestFresh = vi.fn(
      (_signal?: AbortSignal) =>
        new Promise<TurnstileToken>((resolve) => {
          resolveFresh = resolve;
        }),
    );

    const promise = resolveTurnstileToken({
      prefetch: null,
      requestFresh,
      signal: controller.signal,
      onError,
    });

    controller.abort();
    resolveFresh({ token: "late-token", createdAt: 0 });

    await expect(promise).resolves.toBeNull();
    expect(requestFresh).toHaveBeenCalledTimes(1);
    expect(requestFresh).toHaveBeenCalledWith(controller.signal);
    expect(onError).not.toHaveBeenCalled();
  });

  it("returns null and suppresses onError if aborted before retry requestFresh resolves", async () => {
    const controller = new AbortController();
    let resolveRetry!: (token: TurnstileToken) => void;
    let retryStarted!: () => void;
    const retryStartedPromise = new Promise<void>((resolve) => {
      retryStarted = resolve;
    });

    const requestFresh = vi
      .fn<(signal?: AbortSignal) => Promise<TurnstileToken>>()
      .mockRejectedValueOnce(new TurnstileError(TURNSTILE_TIMEOUT_CODE))
      .mockImplementationOnce(
        () =>
          new Promise<TurnstileToken>((resolve) => {
            retryStarted();
            resolveRetry = resolve;
          }),
      );

    const promise = resolveTurnstileToken({
      prefetch: null,
      requestFresh,
      signal: controller.signal,
      onError,
    });

    await retryStartedPromise;
    controller.abort();
    resolveRetry({ token: "late-retry-token", createdAt: 0 });

    await expect(promise).resolves.toBeNull();
    expect(requestFresh).toHaveBeenCalledTimes(2);
    expect(requestFresh).toHaveBeenNthCalledWith(2, controller.signal);
    expect(onError).not.toHaveBeenCalled();
  });

  it("wraps non-TurnstileError failures in TurnstileError after calling onError", async () => {
    const requestFresh = vi.fn(async () => {
      throw new Error("render failed");
    });

    await expect(
      resolveTurnstileToken({
        prefetch: null,
        requestFresh,
        onError,
      }),
    ).rejects.toBeInstanceOf(TurnstileError);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith("unknown");
  });

  it("forces fresh fetch when gamePortal is on portal", async () => {
    const requestFresh = fresh("portal-token");

    await expect(
      resolveTurnstileToken({
        prefetch: Promise.resolve({ token: "pre", createdAt: 0 }),
        requestFresh,
        gamePortal: { isOnGamePortal: () => true },
        onError,
        now: () => 0,
      }),
    ).resolves.toBe("portal-token");
    expect(requestFresh).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });
});
