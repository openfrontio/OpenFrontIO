import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TurnstileTokenProvider,
  type TurnstileToken,
} from "../../src/client/TurnstileToken";

const FRESH_MS = 4 * 60 * 1000;

// A mint stand-in that hands out numbered tokens and lets a test see how many
// challenges were run (each mint is a widget render + Cloudflare round trip).
function fakeMint() {
  let n = 0;
  const mint = vi.fn(
    async (): Promise<TurnstileToken> => ({
      token: `token-${++n}`,
      createdAt: Date.now(),
    }),
  );
  return mint;
}

describe("TurnstileTokenProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("alert", vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("hands out the prefetched token without minting at take time", async () => {
    const mint = fakeMint();
    const provider = new TurnstileTokenProvider(mint);

    provider.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(mint).toHaveBeenCalledTimes(1);

    // Freeze the mint so a token minted during take() could never resolve:
    // the token returned here has to be the prefetched one.
    mint.mockImplementationOnce(() => new Promise<TurnstileToken>(() => {}));
    await expect(provider.take()).resolves.toBe("token-1");
  });

  it("mints a replacement as soon as a token is consumed", async () => {
    const mint = fakeMint();
    const provider = new TurnstileTokenProvider(mint);

    provider.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(await provider.take()).toBe("token-1");

    // The replacement mint is kicked off by take(), not by the next join.
    await vi.advanceTimersByTimeAsync(0);
    expect(mint).toHaveBeenCalledTimes(2);

    mint.mockImplementationOnce(() => new Promise<TurnstileToken>(() => {}));
    await expect(provider.take()).resolves.toBe("token-2");
  });

  it("never hands out the same token twice", async () => {
    const mint = fakeMint();
    const provider = new TurnstileTokenProvider(mint);

    provider.start();
    await vi.advanceTimersByTimeAsync(0);

    const first = await provider.take();
    await vi.advanceTimersByTimeAsync(0);
    const second = await provider.take();
    expect(first).not.toBe(second);
  });

  it("refreshes the cached token before it ages out", async () => {
    const mint = fakeMint();
    const provider = new TurnstileTokenProvider(mint);

    provider.start();
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(FRESH_MS);
    expect(mint).toHaveBeenCalledTimes(2);

    // Idling on the menu still leaves a usable token ready.
    mint.mockImplementationOnce(() => new Promise<TurnstileToken>(() => {}));
    await expect(provider.take()).resolves.toBe("token-2");
  });

  it("mints on demand rather than handing out a stale token", async () => {
    const mint = fakeMint();
    const provider = new TurnstileTokenProvider(mint);

    provider.start();
    await vi.advanceTimersByTimeAsync(0);

    // Suspended (in a game), so no background refresh runs and the cached
    // token goes stale.
    provider.setActive(false);
    await vi.advanceTimersByTimeAsync(FRESH_MS + 1000);
    expect(mint).toHaveBeenCalledTimes(1);

    expect(await provider.take()).toBe("token-2");
  });

  it("suspends and resumes background minting", async () => {
    const mint = fakeMint();
    const provider = new TurnstileTokenProvider(mint);

    provider.start();
    await vi.advanceTimersByTimeAsync(0);
    provider.setActive(false);

    await vi.advanceTimersByTimeAsync(10 * FRESH_MS);
    expect(mint).toHaveBeenCalledTimes(1);

    provider.setActive(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(mint).toHaveBeenCalledTimes(2);
  });

  it("does not mint before start()", async () => {
    const mint = fakeMint();
    new TurnstileTokenProvider(mint).setActive(false);

    await vi.advanceTimersByTimeAsync(10 * FRESH_MS);
    expect(mint).not.toHaveBeenCalled();
  });

  it("recovers from a failed prefetch instead of poisoning the join", async () => {
    const mint = fakeMint();
    mint.mockRejectedValueOnce(new Error("network-error"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const provider = new TurnstileTokenProvider(mint);

    provider.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(await provider.take()).toBe("token-1");
  });

  it("returns null when a token cannot be minted at join time", async () => {
    const mint = fakeMint();
    mint.mockRejectedValue(new Error("network-error"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const provider = new TurnstileTokenProvider(mint);

    provider.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(await provider.take()).toBeNull();
  });

  it("shares one in-flight mint between the prefetch and a join", async () => {
    const mint = fakeMint();
    let release: (t: TurnstileToken) => void = () => {};
    mint.mockImplementationOnce(
      () => new Promise<TurnstileToken>((resolve) => (release = resolve)),
    );
    const provider = new TurnstileTokenProvider(mint);

    provider.start();
    const taken = provider.take();
    await vi.advanceTimersByTimeAsync(0);
    // The join joins the prefetch already in flight rather than starting a
    // second challenge.
    expect(mint).toHaveBeenCalledTimes(1);

    release({ token: "token-slow", createdAt: Date.now() });
    expect(await taken).toBe("token-slow");
  });
});
