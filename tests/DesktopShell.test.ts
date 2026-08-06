import { afterEach, describe, expect, it, vi } from "vitest";
import {
  composeVersionDisplay,
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
