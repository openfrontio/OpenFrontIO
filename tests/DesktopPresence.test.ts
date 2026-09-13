import { beforeEach, describe, expect, it, vi } from "vitest";
import { desktopPresence } from "../src/client/DesktopPresence";

beforeEach(() => {
  delete (window as any).openfrontDesktop;
});

describe("DesktopPresence", () => {
  it("degrades to safe defaults without the bridge", async () => {
    expect(desktopPresence.isAvailable()).toBe(false);
    expect(() => desktopPresence.set({ state: "menu" })).not.toThrow();
    expect(await desktopPresence.consumePendingInvite()).toBeNull();
    expect(await desktopPresence.openInviteDialog()).toBe(false);
  });

  it("isAvailable is false when shell.api is 1 (older depot)", () => {
    (window as any).openfrontDesktop = { shell: { api: 1 } };
    expect(desktopPresence.isAvailable()).toBe(false);
  });

  // The capability signal is what the shell DECLARES, not what happens to be
  // reachable. A shell that exposed the namespaces without bumping shell.api
  // is advertising a contract it has not committed to, so refuse it rather
  // than half-drive it.
  it("refuses a shell exposing the namespaces at api 1", async () => {
    const setFn = vi.fn().mockResolvedValue(undefined);
    const consumeFn = vi.fn().mockResolvedValue("abc123");
    const subscribeFn = vi.fn(() => () => undefined);
    const dialogFn = vi.fn().mockResolvedValue(true);
    (window as any).openfrontDesktop = {
      shell: { api: 1 },
      presence: { set: setFn },
      invite: {
        consumePending: consumeFn,
        subscribe: subscribeFn,
        openInviteDialog: dialogFn,
      },
    };

    desktopPresence.set({ state: "menu" });
    expect(await desktopPresence.consumePendingInvite()).toBeNull();
    expect(await desktopPresence.openInviteDialog()).toBe(false);
    expect(() =>
      desktopPresence.subscribeInvites(() => undefined)(),
    ).not.toThrow();

    expect(setFn).not.toHaveBeenCalled();
    expect(consumeFn).not.toHaveBeenCalled();
    expect(subscribeFn).not.toHaveBeenCalled();
    expect(dialogFn).not.toHaveBeenCalled();
  });

  it("isAvailable is true and passes through with a full bridge at api 2", async () => {
    const setFn = vi.fn().mockResolvedValue(undefined);
    (window as any).openfrontDesktop = {
      shell: { api: 2 },
      presence: { set: setFn },
      invite: {
        consumePending: vi.fn().mockResolvedValue("abc123"),
        subscribe: vi.fn(() => () => undefined),
        openInviteDialog: vi.fn().mockResolvedValue(true),
      },
    };
    expect(desktopPresence.isAvailable()).toBe(true);
    desktopPresence.set({ state: "lobby", lobbyId: "abc123" });
    expect(setFn).toHaveBeenCalledWith({ state: "lobby", lobbyId: "abc123" });
    expect(await desktopPresence.consumePendingInvite()).toBe("abc123");
    expect(await desktopPresence.openInviteDialog()).toBe(true);
  });

  it("consumePendingInvite degrades to null when bridge rejects", async () => {
    (window as any).openfrontDesktop = {
      shell: { api: 2 },
      invite: { consumePending: vi.fn().mockRejectedValue(new Error("boom")) },
    };
    expect(await desktopPresence.consumePendingInvite()).toBeNull();
  });

  it("openInviteDialog degrades to false when bridge rejects", async () => {
    (window as any).openfrontDesktop = {
      shell: { api: 2 },
      invite: {
        openInviteDialog: vi.fn().mockRejectedValue(new Error("boom")),
      },
    };
    expect(await desktopPresence.openInviteDialog()).toBe(false);
  });

  it("set does not propagate when presence.set throws synchronously", () => {
    (window as any).openfrontDesktop = {
      shell: { api: 2 },
      presence: {
        set: vi.fn(() => {
          throw new Error("boom");
        }),
      },
    };
    expect(() => desktopPresence.set({ state: "menu" })).not.toThrow();
  });

  it("subscribeInvites always returns a callable unsubscribe, no bridge", () => {
    const unsubscribe = desktopPresence.subscribeInvites(() => undefined);
    expect(typeof unsubscribe).toBe("function");
    expect(() => unsubscribe()).not.toThrow();
  });

  it("subscribeInvites always returns a callable unsubscribe, bridge without invite namespace", () => {
    (window as any).openfrontDesktop = { shell: { api: 2 } };
    const unsubscribe = desktopPresence.subscribeInvites(() => undefined);
    expect(typeof unsubscribe).toBe("function");
    expect(() => unsubscribe()).not.toThrow();
  });

  it("subscribeInvites always returns a callable unsubscribe, real bridge", () => {
    const innerUnsubscribe = vi.fn();
    const subscribeFn = vi.fn(() => innerUnsubscribe);
    (window as any).openfrontDesktop = {
      shell: { api: 2 },
      invite: { subscribe: subscribeFn },
    };
    const cb = vi.fn();
    const unsubscribe = desktopPresence.subscribeInvites(cb);
    expect(subscribeFn).toHaveBeenCalledWith(cb);
    expect(typeof unsubscribe).toBe("function");
    expect(() => unsubscribe()).not.toThrow();
    expect(innerUnsubscribe).toHaveBeenCalled();
  });

  it("subscribeInvites returns a callable unsubscribe when subscribe throws synchronously", () => {
    (window as any).openfrontDesktop = {
      shell: { api: 2 },
      invite: {
        subscribe: vi.fn(() => {
          throw new Error("boom");
        }),
      },
    };
    // The caller wires up navigation listeners after this call, so a throwing
    // bridge must not abort it.
    let unsubscribe: (() => void) | undefined;
    expect(() => {
      unsubscribe = desktopPresence.subscribeInvites(() => undefined);
    }).not.toThrow();
    expect(typeof unsubscribe).toBe("function");
    expect(() => unsubscribe!()).not.toThrow();
  });
});
