import { afterEach, describe, expect, it, vi } from "vitest";
import {
  composeVersionDisplay,
  desktopLinkGate,
  desktopQuit,
  desktopVersion,
  requestDesktopQuit,
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

  // An untagged shell build reports its 7-char commit rather than a version
  // (OPE-358). Prefixing that would render "va1b2c3d", a version that does
  // not exist.
  it("does not prefix a shell commit with a v", () => {
    expect(composeVersionDisplay("bf739f8", "a1b2c3d")).toBe(
      "bf739f8 (Steam a1b2c3d)",
    );
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

// The in-app exit (OPE-402). Same feature-detection rule as desktopLinkGate
// above, and the same reason: the shell ships in the Steam depot on Steam's
// schedule while this client updates at runtime, so a client that is newer
// than its shell must hide the control rather than wire a button to nothing.
describe("desktopQuit", () => {
  afterEach(() => {
    window.openfrontDesktop = undefined;
  });

  it("is null in the browser, with no bridge present", () => {
    window.openfrontDesktop = undefined;
    expect(desktopQuit()).toBeNull();
  });

  // A shell at api 3 -- display.* but no quit(). Not hypothetical: that shell
  // is in the depot now, and a client carrying this change reaches it first.
  it("is null on a shell older than quit()", () => {
    window.openfrontDesktop = { shell: { api: 3 }, display: {} };
    expect(desktopQuit()).toBeNull();
  });

  it("is null when quit exists but is not callable", () => {
    window.openfrontDesktop = { quit: true };
    expect(desktopQuit()).toBeNull();
  });

  it("returns the bridge when quit is callable", async () => {
    const quit = vi.fn(async () => undefined);
    window.openfrontDesktop = { quit };
    const bridge = desktopQuit();
    expect(bridge).not.toBeNull();
    await bridge!.quit();
    expect(quit).toHaveBeenCalledTimes(1);
  });
});

describe("requestDesktopQuit", () => {
  afterEach(() => {
    window.openfrontDesktop = undefined;
  });

  it("does nothing at all with no bridge", () => {
    window.openfrontDesktop = undefined;
    expect(() => requestDesktopQuit()).not.toThrow();
  });

  it("calls the bridge's quit", () => {
    const quit = vi.fn(async () => undefined);
    window.openfrontDesktop = { quit };
    requestDesktopQuit();
    expect(quit).toHaveBeenCalledTimes(1);
  });

  // The whole reason this wrapper exists rather than callers invoking the
  // bridge directly. The main process starts shutting down inside its handler,
  // so the invoke commonly never settles and can reject when the renderer is
  // torn down mid-call. An unhandled rejection from a click handler would
  // surface as a renderer-wide error over an action that already succeeded.
  it("swallows a rejected quit rather than leaving it unhandled", async () => {
    window.openfrontDesktop = {
      quit: () => Promise.reject(new Error("channel closed")),
    };
    expect(() => requestDesktopQuit()).not.toThrow();
    // Let the rejection settle; an unhandled one fails the run.
    await Promise.resolve();
    await Promise.resolve();
  });

  it("swallows a bridge that throws synchronously", () => {
    window.openfrontDesktop = {
      quit: () => {
        throw new Error("boom");
      },
    };
    expect(() => requestDesktopQuit()).not.toThrow();
  });
});
