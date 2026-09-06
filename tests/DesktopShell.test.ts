import { afterEach, describe, expect, it, vi } from "vitest";
import {
  composeVersionDisplay,
  desktopLinkGate,
  desktopVersion,
} from "../src/client/DesktopShell";

describe("composeVersionDisplay", () => {
  it("appends the Steam shell version as subtext", () => {
    expect(composeVersionDisplay("v0.33.1", "0.2.0")).toBe(
      "v0.33.1 (Steam v0.2.0)",
    );
  });

  // The web client must be entirely unaffected.
  it("returns the game version unchanged off the desktop shell", () => {
    expect(composeVersionDisplay("v0.33.1", null)).toBe("v0.33.1");
  });

  it("tolerates a shell version that already carries a v prefix", () => {
    expect(composeVersionDisplay("v0.33.1", "v0.2.0")).toBe(
      "v0.33.1 (Steam v0.2.0)",
    );
  });

  it("returns the game version unchanged for a blank shell version", () => {
    expect(composeVersionDisplay("v0.33.1", "")).toBe("v0.33.1");
  });
});

describe("desktopVersion", () => {
  afterEach(() => {
    window.openfrontDesktop = undefined;
    vi.useRealTimers();
  });

  it("resolves null in the browser, with no bridge present", async () => {
    window.openfrontDesktop = undefined;
    await expect(desktopVersion()).resolves.toBeNull();
  });

  it("resolves null when the bridge has no version method", async () => {
    window.openfrontDesktop = {};
    await expect(desktopVersion()).resolves.toBeNull();
  });

  it("resolves null when the bridge's version() rejects", async () => {
    window.openfrontDesktop = {
      version: () => Promise.reject(new Error("boom")),
    };
    await expect(desktopVersion()).resolves.toBeNull();
  });

  it("resolves the version string when the bridge resolves", async () => {
    window.openfrontDesktop = {
      version: () => Promise.resolve("0.2.0"),
    };
    await expect(desktopVersion()).resolves.toBe("0.2.0");
  });

  it("resolves null via the timeout when the bridge never settles", async () => {
    vi.useFakeTimers();
    window.openfrontDesktop = {
      version: () => new Promise<string>(() => {}),
    };
    const result = desktopVersion();
    await vi.advanceTimersByTimeAsync(500);
    await expect(result).resolves.toBeNull();
  });
});

// The bridge Auth.ts routes every desktop provider login through (OPE-343).
// Guarded on the function actually invoked, not on the shell's presence: a
// bridge that exists but lacks a callable showLinkGate must read as "no link
// flow", so the caller falls through rather than calling undefined.
describe("desktopLinkGate", () => {
  afterEach(() => {
    window.openfrontDesktop = undefined;
  });

  it("is null in the browser, with no bridge present", () => {
    window.openfrontDesktop = undefined;
    expect(desktopLinkGate()).toBeNull();
  });

  it("is null when the bridge exists but showLinkGate is not a function", () => {
    window.openfrontDesktop = { linkGate: { requestTicket: () => null } };
    expect(desktopLinkGate()).toBeNull();
  });

  it("returns the bridge when showLinkGate is callable", async () => {
    const showLinkGate = vi.fn(async () => undefined);
    window.openfrontDesktop = { showLinkGate };
    const gate = desktopLinkGate();
    expect(gate).not.toBeNull();
    await gate!.showLinkGate();
    expect(showLinkGate).toHaveBeenCalledTimes(1);
  });
});
