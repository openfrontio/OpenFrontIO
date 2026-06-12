import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetForTesting,
  getKeyForCode,
  loadKeyboardLayout,
  subscribeToLayoutChange,
} from "../../src/client/utilities/KeyboardLayout";

type LayoutChangeHandler = () => void;

interface FakeKeyboard {
  getLayoutMap: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  emitLayoutChange: () => void;
}

function installFakeKeyboard(layout: Record<string, string>): FakeKeyboard {
  const handlers = new Set<LayoutChangeHandler>();
  const fake: FakeKeyboard = {
    getLayoutMap: vi.fn().mockResolvedValue(new Map(Object.entries(layout))),
    addEventListener: vi.fn((type: string, handler: LayoutChangeHandler) => {
      if (type === "layoutchange") handlers.add(handler);
    }),
    removeEventListener: vi.fn((type: string, handler: LayoutChangeHandler) => {
      if (type === "layoutchange") handlers.delete(handler);
    }),
    emitLayoutChange: () => {
      for (const h of [...handlers]) h();
    },
  };
  Object.defineProperty(navigator, "keyboard", {
    configurable: true,
    value: fake,
  });
  return fake;
}

function removeFakeKeyboard(): void {
  if ("keyboard" in navigator) {
    Object.defineProperty(navigator, "keyboard", {
      configurable: true,
      value: undefined,
    });
    delete (navigator as Partial<{ keyboard: unknown }>).keyboard;
  }
}

describe("KeyboardLayout", () => {
  beforeEach(() => {
    _resetForTesting();
  });

  afterEach(() => {
    _resetForTesting();
    removeFakeKeyboard();
    vi.restoreAllMocks();
  });

  describe("getKeyForCode (before load)", () => {
    it("returns null when the layout has not been loaded yet", () => {
      installFakeKeyboard({ KeyW: "z" });
      expect(getKeyForCode("KeyW")).toBeNull();
    });

    it("returns null when the API is unavailable", () => {
      removeFakeKeyboard();
      expect(getKeyForCode("KeyW")).toBeNull();
    });
  });

  describe("loadKeyboardLayout", () => {
    it("populates the cache when the API resolves", async () => {
      installFakeKeyboard({ KeyW: "z", KeyA: "q", Digit1: "&" });
      await loadKeyboardLayout();

      expect(getKeyForCode("KeyW")).toBe("z");
      expect(getKeyForCode("KeyA")).toBe("q");
      expect(getKeyForCode("Digit1")).toBe("&");
    });

    it("returns null for unknown codes after load", async () => {
      installFakeKeyboard({ KeyW: "z" });
      await loadKeyboardLayout();

      expect(getKeyForCode("Unmapped")).toBeNull();
    });

    it("is a no-op when navigator.keyboard is unavailable", async () => {
      removeFakeKeyboard();
      await expect(loadKeyboardLayout()).resolves.toBeUndefined();
      expect(getKeyForCode("KeyW")).toBeNull();
    });

    it("dedupes concurrent calls into a single getLayoutMap invocation", async () => {
      const fake = installFakeKeyboard({ KeyW: "z" });

      const [a, b, c] = [
        loadKeyboardLayout(),
        loadKeyboardLayout(),
        loadKeyboardLayout(),
      ];
      await Promise.all([a, b, c]);

      expect(fake.getLayoutMap).toHaveBeenCalledTimes(1);
    });

    it("does not re-invoke getLayoutMap once the cache is populated", async () => {
      const fake = installFakeKeyboard({ KeyW: "z" });
      await loadKeyboardLayout();
      await loadKeyboardLayout();
      await loadKeyboardLayout();
      expect(fake.getLayoutMap).toHaveBeenCalledTimes(1);
    });

    it("treats getLayoutMap rejection as 'unavailable' without crashing", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const failing: FakeKeyboard = {
        getLayoutMap: vi.fn().mockRejectedValue(new Error("boom")),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        emitLayoutChange: () => {},
      };
      Object.defineProperty(navigator, "keyboard", {
        configurable: true,
        value: failing,
      });

      await loadKeyboardLayout();

      expect(getKeyForCode("KeyW")).toBeNull();
      expect(warn).toHaveBeenCalled();
    });
  });

  describe("subscribeToLayoutChange", () => {
    it("notifies subscribers exactly once after the initial load resolves", async () => {
      installFakeKeyboard({ KeyW: "z" });
      const cb = vi.fn();
      subscribeToLayoutChange(cb);

      await loadKeyboardLayout();

      expect(cb).toHaveBeenCalledTimes(1);
    });

    it("notifies subscribers when a layoutchange event fires", async () => {
      const fake = installFakeKeyboard({ KeyW: "z" });
      await loadKeyboardLayout();

      const cb = vi.fn();
      subscribeToLayoutChange(cb);

      fake.emitLayoutChange();
      expect(cb).toHaveBeenCalledTimes(1);

      fake.emitLayoutChange();
      expect(cb).toHaveBeenCalledTimes(2);
    });

    it("invalidates the cache when layoutchange fires so labels fall back to the QWERTY path", async () => {
      const fake = installFakeKeyboard({ KeyW: "z" });
      await loadKeyboardLayout();
      expect(getKeyForCode("KeyW")).toBe("z");

      // Simulate the user switching to QWERTY mid-session. The next
      // getLayoutMap() invocation (kicked off automatically by
      // onLayoutChange) will return the new map.
      fake.getLayoutMap.mockResolvedValueOnce(new Map([["KeyW", "w"]]));
      fake.emitLayoutChange();

      // Cache is invalidated immediately so callers see the QWERTY fallback
      // until the auto-triggered reload finishes.
      expect(getKeyForCode("KeyW")).toBeNull();
    });

    it("auto-reloads the layout map after layoutchange so subscribers receive the new layout without a manual call", async () => {
      const fake = installFakeKeyboard({ KeyW: "z" });
      await loadKeyboardLayout();
      expect(getKeyForCode("KeyW")).toBe("z");

      fake.getLayoutMap.mockResolvedValueOnce(new Map([["KeyW", "w"]]));

      // Subscribe so we can await the second (post-auto-reload) notification.
      let resolvePostReload: () => void;
      const postReload = new Promise<void>((r) => {
        resolvePostReload = r;
      });
      let count = 0;
      subscribeToLayoutChange(() => {
        count += 1;
        if (count === 2) resolvePostReload();
      });

      fake.emitLayoutChange();

      // First notification is the synchronous "cache cleared" one.
      expect(count).toBe(1);
      expect(getKeyForCode("KeyW")).toBeNull();

      // Auto-triggered reload completes and notifies again with the new
      // layout map populated.
      await postReload;
      expect(count).toBe(2);
      expect(getKeyForCode("KeyW")).toBe("w");
      // getLayoutMap was called twice: the initial load + the auto-reload.
      expect(fake.getLayoutMap).toHaveBeenCalledTimes(2);
    });

    it("does not let an older in-flight load overwrite the cache after layoutchange starts a newer load", async () => {
      const fake = installFakeKeyboard({});

      // Stage two getLayoutMap calls, both deferred so we can resolve them
      // in a controlled order.
      let resolveFirst!: (value: Map<string, string>) => void;
      let resolveSecond!: (value: Map<string, string>) => void;
      fake.getLayoutMap.mockImplementationOnce(
        () =>
          new Promise<Map<string, string>>((r) => {
            resolveFirst = r;
          }),
      );
      fake.getLayoutMap.mockImplementationOnce(
        () =>
          new Promise<Map<string, string>>((r) => {
            resolveSecond = r;
          }),
      );

      // Start load #1 — will await `resolveFirst`.
      void loadKeyboardLayout();

      // Layoutchange before #1 resolves: cache invalidates and the auto-
      // reload starts load #2, awaiting `resolveSecond`.
      fake.emitLayoutChange();

      // Resolve load #1 with stale data. The generation guard must drop it.
      resolveFirst(new Map([["KeyW", "stale"]]));
      // Flush microtasks so the .finally on load #1 runs.
      await Promise.resolve();
      await Promise.resolve();

      // Cache must NOT contain the stale value.
      expect(getKeyForCode("KeyW")).not.toBe("stale");
      expect(getKeyForCode("KeyW")).toBeNull();

      // Resolve load #2 with the correct, current layout.
      resolveSecond(new Map([["KeyW", "w"]]));
      await Promise.resolve();
      await Promise.resolve();

      expect(getKeyForCode("KeyW")).toBe("w");
      expect(fake.getLayoutMap).toHaveBeenCalledTimes(2);
    });

    it("returns a disposer that removes the subscription", async () => {
      installFakeKeyboard({ KeyW: "z" });
      const cb = vi.fn();
      const unsubscribe = subscribeToLayoutChange(cb);
      unsubscribe();

      await loadKeyboardLayout();
      expect(cb).not.toHaveBeenCalled();
    });

    it("isolates subscriber errors so one bad callback does not block others", async () => {
      installFakeKeyboard({ KeyW: "z" });
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const good = vi.fn();
      subscribeToLayoutChange(() => {
        throw new Error("oops");
      });
      subscribeToLayoutChange(good);

      await loadKeyboardLayout();

      expect(good).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalled();
    });
  });
});
