import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoreEventsBody } from "../../packages/shared/src/ApiSchemas";
import { StoreTracker } from "../../src/client/StoreTracking";

type Entry = { target: Element; isIntersecting: boolean };

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
  trigger(el: Element, isIntersecting: boolean) {
    this.cb([{ target: el, isIntersecting }]);
  }
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
    const el = document.createElement("div");
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

  it("no impression when the card leaves before 1s", () => {
    const el = document.createElement("div");
    tracker.observe(el, "flag:a", placement);
    FakeIO.last.trigger(el, true);
    vi.advanceTimersByTime(500);
    FakeIO.last.trigger(el, false);
    vi.advanceTimersByTime(2000);
    tracker.flush();
    expect(send).not.toHaveBeenCalled();
  });

  it("dedupes within a page view", () => {
    const el = document.createElement("div");
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
    const el = document.createElement("div");
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

  it("splits batches over 200", () => {
    for (let i = 0; i < 450; i++) tracker.click(`flag:${i}`, placement);
    tracker.flush();
    expect(send.mock.calls.map((c) => c[0].events.length)).toEqual([
      200, 200, 50,
    ]);
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

  it("no send when empty", () => {
    tracker.flush();
    vi.advanceTimersByTime(60_000);
    expect(send).not.toHaveBeenCalled();
  });
});
