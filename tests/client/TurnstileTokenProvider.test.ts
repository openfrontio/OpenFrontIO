import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string, params?: Record<string, string | number>) =>
    `[${key}] ${JSON.stringify(params ?? {})}`,
}));
vi.mock("../../src/client/ClientEnv", () => ({
  ClientEnv: { turnstileSiteKey: () => "test-site-key" },
}));

import {
  MINT_TIMEOUT_MS,
  mintTurnstileToken,
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

  it("gives overlapping joins on a cold cache distinct tokens", async () => {
    const mint = fakeMint();
    let release: (t: TurnstileToken) => void = () => {};
    mint.mockImplementationOnce(
      () => new Promise<TurnstileToken>((resolve) => (release = resolve)),
    );
    const provider = new TurnstileTokenProvider(mint);

    provider.start();
    // Both joins arrive while the prefetch is still in flight. Tokens are
    // single-use, so only one of them may claim it; the other must mint
    // its own.
    const first = provider.take();
    const second = provider.take();
    await vi.advanceTimersByTimeAsync(0);
    expect(mint).toHaveBeenCalledTimes(2);

    release({ token: "token-slow", createdAt: Date.now() });
    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe("token-slow");
    expect(b).not.toBeNull();
    expect(b).not.toBe(a);

    // The claimed prefetch never lands in the cache: the next take() can't
    // be handed the token that already went to the first join.
    await vi.advanceTimersByTimeAsync(0);
    const third = await provider.take();
    expect(third).not.toBe(a);
    expect(third).not.toBe(b);
  });

  it("does not cache a prefetch that a join already claimed", async () => {
    const mint = fakeMint();
    let release: (t: TurnstileToken) => void = () => {};
    mint.mockImplementationOnce(
      () => new Promise<TurnstileToken>((resolve) => (release = resolve)),
    );
    const provider = new TurnstileTokenProvider(mint);

    provider.start();
    const taken = provider.take();
    release({ token: "token-slow", createdAt: Date.now() });
    expect(await taken).toBe("token-slow");

    // A replacement is minted for the cache and the next join gets it.
    await vi.advanceTimersByTimeAsync(0);
    expect(mint).toHaveBeenCalledTimes(2);
    mint.mockImplementationOnce(() => new Promise<TurnstileToken>(() => {}));
    const next = await provider.take();
    expect(next).not.toBeNull();
    expect(next).not.toBe("token-slow");
  });
});

// Stand-in for the Cloudflare script: records which element each widget was
// rendered into and exposes the execute() callbacks so a test can settle a
// challenge by hand.
function fakeTurnstile() {
  const widgets = new Map<
    string,
    { host: Element; callbacks?: Record<string, (arg?: string) => void> }
  >();
  let n = 0;
  const api = {
    render: vi.fn((host: Element) => {
      const id = `widget-${++n}`;
      widgets.set(id, { host });
      return id;
    }),
    execute: vi.fn(
      (id: string, callbacks: Record<string, (arg?: string) => void>) => {
        widgets.get(id)!.callbacks = callbacks;
      },
    ),
    remove: vi.fn((id: string) => {
      widgets.delete(id);
    }),
  };
  return { api, widgets };
}

describe("mintTurnstileToken", () => {
  let container: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    container.id = "turnstile-container";
    document.body.appendChild(container);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    container.remove();
    delete (window as { turnstile?: unknown }).turnstile;
  });

  it("gives overlapping mints their own widget and cleans both up", async () => {
    const { api, widgets } = fakeTurnstile();
    window.turnstile = api;

    const first = mintTurnstileToken();
    const second = mintTurnstileToken();
    await vi.advanceTimersByTimeAsync(0);

    // Two live widgets in two different host elements, both inside the
    // container — never two renders into the same element.
    expect(widgets.size).toBe(2);
    const hosts = [...widgets.values()].map((w) => w.host);
    expect(hosts[0]).not.toBe(hosts[1]);
    expect(hosts[0].parentElement).toBe(container);
    expect(hosts[1].parentElement).toBe(container);

    widgets.get("widget-1")!.callbacks!.callback("tok-a");
    widgets.get("widget-2")!.callbacks!.callback("tok-b");
    expect((await first).token).toBe("tok-a");
    expect((await second).token).toBe("tok-b");

    expect(api.remove).toHaveBeenCalledTimes(2);
    expect(container.childElementCount).toBe(0);
  });

  it("rejects and tears the widget down when the challenge never settles", async () => {
    const { api } = fakeTurnstile();
    window.turnstile = api;

    const minted = mintTurnstileToken();
    const outcome = minted.then(
      () => "resolved",
      (e: Error) => e.message,
    );
    await vi.advanceTimersByTimeAsync(MINT_TIMEOUT_MS);

    expect(await outcome).toBe("timeout");
    expect(api.remove).toHaveBeenCalledWith("widget-1");
    expect(container.childElementCount).toBe(0);
  });

  it("a hung prefetch cannot wedge the provider past the mint timeout", async () => {
    const { api, widgets } = fakeTurnstile();
    window.turnstile = api;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const provider = new TurnstileTokenProvider();

    provider.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(api.render).toHaveBeenCalledTimes(1);

    // The prefetch's widget is never answered (say the player entered a game
    // and the container got hidden). Once it times out, the retry brings
    // warming back on its own.
    await vi.advanceTimersByTimeAsync(MINT_TIMEOUT_MS + 60 * 1000);
    expect(api.render).toHaveBeenCalledTimes(2);

    widgets.get("widget-2")!.callbacks!.callback("tok-fresh");
    await vi.advanceTimersByTimeAsync(0);
    expect(await provider.take()).toBe("tok-fresh");
  });
});
