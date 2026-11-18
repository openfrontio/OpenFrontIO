import { base64url } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  StoreEventsBodySchema,
  type StoreEventsBody,
} from "../../packages/shared/src/ApiSchemas";
import { uuidToBase64url } from "../../packages/shared/src/Base64";
import { getApiBase } from "../../src/client/ApiBase";
import {
  clearLocalSession,
  peekAuthHeader,
  userAuth,
} from "../../src/client/Auth";
import { ClientEnv } from "../../src/client/ClientEnv";
import {
  sendStoreEvents,
  storeItemKey,
  StoreTracker,
} from "../../src/client/StoreTracking";

type Entry = {
  target: Element;
  isIntersecting: boolean;
  intersectionRatio: number;
};

class FakeIO {
  static last: FakeIO;
  observed = new Set<Element>();
  constructor(
    public cb: (entries: Entry[]) => void,
    public opts: IntersectionObserverInit,
  ) {
    FakeIO.last = this;
  }
  observe(el: Element) {
    this.observed.add(el);
  }
  unobserve(el: Element) {
    this.observed.delete(el);
  }
  disconnect() {
    this.observed.clear();
  }
  trigger(
    el: Element,
    isIntersecting: boolean,
    intersectionRatio = isIntersecting ? 1 : 0,
  ) {
    this.cb([{ target: el, isIntersecting, intersectionRatio }]);
  }
}

function mount(): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
}

const placement = { kind: "tab", tab: "cosmetics" } as const;

describe("StoreTracker", () => {
  let send: ReturnType<typeof vi.fn<(b: StoreEventsBody) => void>>;
  let tracker: StoreTracker;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IntersectionObserver", FakeIO);
    send = vi.fn();
    tracker = new StoreTracker({ send });
  });
  afterEach(() => {
    tracker.dispose();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("queues an impression after 1s at 50% visibility", () => {
    const el = mount();
    tracker.observe(el, "flag:a", placement);
    expect(FakeIO.last.opts.threshold).toBe(0.5);
    FakeIO.last.trigger(el, true);
    vi.advanceTimersByTime(999);
    tracker.flush();
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    tracker.flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toEqual({
      platform: "web",
      events: [{ type: "impression", item: "flag:a", placement }],
    });
  });

  it("watches a reused element afresh when it shows another item", () => {
    const el = mount();
    tracker.observe(el, "flag:a", placement);
    FakeIO.last.trigger(el, true);
    vi.advanceTimersByTime(500);
    tracker.observe(el, "flag:b", placement);
    FakeIO.last.trigger(el, true);
    vi.advanceTimersByTime(1000);
    tracker.flush();
    expect(send.mock.calls[0][0].events).toEqual([
      { type: "impression", item: "flag:b", placement },
    ]);
  });

  it("releases a detached card, and its pending impression never queues", () => {
    const gone = mount();
    tracker.observe(gone, "flag:a", placement);
    FakeIO.last.trigger(gone, true);
    gone.remove();
    tracker.releaseDetached();
    expect(FakeIO.last.observed.has(gone)).toBe(false);
    vi.advanceTimersByTime(2000);
    tracker.flush();
    expect(send).not.toHaveBeenCalled();
  });

  it("observe() leaves pruning to one releaseDetached() per pass", () => {
    // Pruning inside every observe() walked every watched card per card: O(n²)
    // for each store update.
    const gone = mount();
    tracker.observe(gone, "flag:a", placement);
    gone.remove();
    tracker.observe(mount(), "flag:b", placement);
    expect(FakeIO.last.observed.has(gone)).toBe(true);
    tracker.releaseDetached();
    expect(FakeIO.last.observed.has(gone)).toBe(false);
  });

  it("tracks a pattern palette under its pattern card", () => {
    const el = mount();
    tracker.observe(el, "pattern:stripes:red", placement);
    FakeIO.last.trigger(el, true);
    vi.advanceTimersByTime(1000);
    tracker.click("pattern:stripes:blue", placement);
    tracker.click("pattern:stripes", placement);
    tracker.flush();
    expect(send.mock.calls[0][0].events).toEqual([
      { type: "impression", item: "pattern:stripes", placement },
      { type: "click", item: "pattern:stripes", placement },
    ]);
  });

  it("drops an event whose item key is over 120 characters, keeping the rest", () => {
    const long = `flag:${"x".repeat(116)}`;
    expect(long.length).toBe(121);
    const el = mount();
    tracker.observe(el, long, placement);
    FakeIO.last.trigger(el, true);
    vi.advanceTimersByTime(1000);
    tracker.click(long, placement);
    tracker.click(`flag:${"x".repeat(115)}`, placement);
    tracker.click("flag:a", placement);
    tracker.flush();
    expect(send.mock.calls[0][0].events.map((e) => e.item)).toEqual([
      `flag:${"x".repeat(115)}`,
      "flag:a",
    ]);
  });

  it("no impression when the card leaves before 1s", () => {
    const el = mount();
    tracker.observe(el, "flag:a", placement);
    FakeIO.last.trigger(el, true);
    vi.advanceTimersByTime(500);
    FakeIO.last.trigger(el, false);
    vi.advanceTimersByTime(2000);
    tracker.flush();
    expect(send).not.toHaveBeenCalled();
  });

  it("dedupes within a page view", () => {
    const el = mount();
    tracker.observe(el, "flag:a", placement);
    for (let i = 0; i < 2; i++) {
      FakeIO.last.trigger(el, true);
      vi.advanceTimersByTime(1000);
      FakeIO.last.trigger(el, false);
    }
    tracker.flush();
    expect(send.mock.calls[0][0].events).toHaveLength(1);
  });

  it("counts again after reset", () => {
    const el = mount();
    tracker.observe(el, "flag:a", placement);
    FakeIO.last.trigger(el, true);
    vi.advanceTimersByTime(1000);
    tracker.beginPageView();
    FakeIO.last.trigger(el, false);
    FakeIO.last.trigger(el, true);
    vi.advanceTimersByTime(1000);
    tracker.flush();
    expect(send.mock.calls[0][0].events).toHaveLength(2);
  });

  it("click is deduped per page view", () => {
    tracker.click("flag:a", placement);
    tracker.click("flag:a", placement);
    tracker.flush();
    expect(send.mock.calls[0][0].events).toEqual([
      { type: "click", item: "flag:a", placement },
    ]);
    tracker.beginPageView();
    tracker.click("flag:a", placement);
    tracker.flush();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("flushes every 30s", () => {
    tracker.click("flag:a", placement);
    vi.advanceTimersByTime(30_000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toEqual({
      platform: "web",
      events: [{ type: "click", item: "flag:a", placement }],
    });
  });

  it("splits batches over 50, the API's limit", () => {
    for (let i = 0; i < 120; i++) tracker.click(`flag:${i}`, placement);
    tracker.flush();
    expect(send.mock.calls.map((c) => c[0].events.length)).toEqual([
      50, 50, 20,
    ]);
    for (const [body] of send.mock.calls) {
      expect(StoreEventsBodySchema.safeParse(body).success).toBe(true);
    }
  });

  it("flushes once on pagehide", () => {
    tracker.click("flag:a", placement);
    window.dispatchEvent(new Event("pagehide"));
    expect(send).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event("pagehide"));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("flushes when the page becomes hidden", () => {
    tracker.click("flag:a", placement);
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("no impression while less than half the card is in view", () => {
    const el = mount();
    tracker.observe(el, "flag:a", placement);
    FakeIO.last.trigger(el, true, 0.3);
    vi.advanceTimersByTime(2000);
    tracker.flush();
    expect(send).not.toHaveBeenCalled();
  });

  it("a drop below half the card cancels the pending impression", () => {
    const el = mount();
    tracker.observe(el, "flag:a", placement);
    FakeIO.last.trigger(el, true, 0.6);
    vi.advanceTimersByTime(500);
    FakeIO.last.trigger(el, true, 0.1);
    vi.advanceTimersByTime(2000);
    tracker.flush();
    expect(send).not.toHaveBeenCalled();
  });

  it("hiding the tab cancels a pending impression; coming back needs a fresh second", () => {
    const setVisibility = (value: string) => {
      Object.defineProperty(document, "visibilityState", {
        value,
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    };
    try {
      const el = mount();
      tracker.observe(el, "flag:a", placement);
      FakeIO.last.trigger(el, true);
      vi.advanceTimersByTime(100);
      setVisibility("hidden");
      vi.advanceTimersByTime(5000);
      tracker.flush();
      expect(send).not.toHaveBeenCalled();
      setVisibility("visible");
      vi.advanceTimersByTime(999);
      tracker.flush();
      expect(send).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      tracker.flush();
      expect(send.mock.calls[0][0].events).toEqual([
        { type: "impression", item: "flag:a", placement },
      ]);
    } finally {
      Object.defineProperty(document, "visibilityState", {
        value: "visible",
        configurable: true,
      });
    }
  });

  it("no send when empty", () => {
    tracker.flush();
    vi.advanceTimersByTime(60_000);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("storeItemKey", () => {
  it.each([
    ["pattern:stripes:red", "pattern:stripes"],
    ["pattern:stripes", "pattern:stripes"],
    ["pattern:default", "pattern:default"],
    ["effect:nukeTrail:blue", "effect:nukeTrail:blue"],
    ["skin:mtn", "skin:mtn"],
  ])("%s -> %s", (key, base) => {
    expect(storeItemKey(key)).toBe(base);
  });
});

function jwt(): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    jti: "j",
    sub: uuidToBase64url("123e4567-e89b-12d3-a456-426614174000"),
    iat: now,
    iss: getApiBase(),
    aud: "localhost",
    exp: now + 3600,
  };
  return [
    base64url.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })),
    base64url.encode(JSON.stringify(payload)),
    base64url.encode("sig"),
  ].join(".");
}

describe("sendStoreEvents and peekAuthHeader", () => {
  const body: StoreEventsBody = {
    platform: "web",
    events: [{ type: "click", item: "flag:a", placement }],
  };

  beforeEach(() => {
    localStorage.clear();
    (window as unknown as { BOOTSTRAP_CONFIG: unknown }).BOOTSTRAP_CONFIG = {
      gameEnv: "dev",
      numWorkers: 1,
      turnstileSiteKey: "x",
      jwtAudience: "localhost",
      instanceId: "test",
      gitCommit: "test",
    };
    ClientEnv.reset();
  });
  afterEach(() => {
    clearLocalSession();
    vi.unstubAllGlobals();
    delete (window as unknown as { BOOTSTRAP_CONFIG?: unknown })
      .BOOTSTRAP_CONFIG;
    ClientEnv.reset();
    localStorage.clear();
  });

  it("calls fetch synchronously, keepalive, without Authorization when signed out", () => {
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    expect(peekAuthHeader()).toBe("");
    sendStoreEvents(body);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(`${getApiBase()}/store/events`);
    expect(init.keepalive).toBe(true);
    expect(init.method).toBe("POST");
    expect(
      (init.headers as Record<string, string>).Authorization,
    ).toBeUndefined();
    expect(JSON.parse(init.body as string)).toEqual(body);
  });

  it("sends the cached token and makes no refresh call", async () => {
    const token = jwt();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        status: 200,
        json: async () => ({ jwt: token, expiresIn: 3600 }),
      })),
    );
    await userAuth();
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    expect(peekAuthHeader()).toBe(`Bearer ${token}`);
    sendStoreEvents(body);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = (
      fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    )[1];
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${token}`,
    );
  });

  it("keeps the token until 30 seconds before it expires", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const token = jwt();
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({
          status: 200,
          json: async () => ({ jwt: token, expiresIn: 3600 }),
        })),
      );
      await userAuth();
      vi.advanceTimersByTime((3600 - 120) * 1000);
      expect(peekAuthHeader()).toBe(`Bearer ${token}`);
      vi.advanceTimersByTime(100 * 1000);
      expect(peekAuthHeader()).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });

  it("swallows a rejected fetch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );
    expect(() => sendStoreEvents(body)).not.toThrow();
    await Promise.resolve();
  });
});
