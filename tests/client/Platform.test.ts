import { afterEach, describe, expect, it, vi } from "vitest";

type NavigatorOverride = {
  userAgent: string;
  userAgentData?: { platform?: string };
  maxTouchPoints?: number;
};

const setInnerWidth = (value: number) => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value,
  });
};

const loadPlatform = async ({
  userAgent,
  userAgentData,
  maxTouchPoints,
}: NavigatorOverride) => {
  vi.resetModules();
  vi.stubGlobal("navigator", {
    userAgent,
    userAgentData,
    maxTouchPoints,
  });
  const { Platform } = await import("../../src/client/Platform");
  return Platform;
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("Platform", () => {
  it("detects iOS before macOS for iPhone-like user agents", async () => {
    const platform = await loadPlatform({
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    });

    expect(platform.os).toBe("iOS");
    expect(platform.isIOS).toBe(true);
    expect(platform.isMac).toBe(false);
  });

  it("detects macOS for Macintosh user agents", async () => {
    const platform = await loadPlatform({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
    });

    expect(platform.os).toBe("macOS");
    expect(platform.isMac).toBe(true);
    expect(platform.isIOS).toBe(false);
  });

  it("detects iOS for iPad desktop-mode user agents with touch support", async () => {
    const platform = await loadPlatform({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
      maxTouchPoints: 5,
    });

    expect(platform.os).toBe("iOS");
    expect(platform.isIOS).toBe(true);
    expect(platform.isMac).toBe(false);
  });

  it("uses userAgentData platform when available", async () => {
    const platform = await loadPlatform({
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15",
      userAgentData: { platform: "Android" },
    });

    expect(platform.os).toBe("Android");
    expect(platform.isAndroid).toBe(true);
  });

  it("normalizes non-canonical userAgentData platform values", async () => {
    const macPlatform = await loadPlatform({
      userAgent: "Mozilla/5.0",
      userAgentData: { platform: "Macintosh" },
    });

    expect(macPlatform.os).toBe("macOS");
    expect(macPlatform.isMac).toBe(true);

    const chromeOsPlatform = await loadPlatform({
      userAgent: "Mozilla/5.0",
      userAgentData: { platform: "Chrome OS" },
    });

    expect(chromeOsPlatform.os).toBe("Linux");
    expect(chromeOsPlatform.isLinux).toBe(true);

    const unknownPlatform = await loadPlatform({
      userAgent: "Mozilla/5.0",
      userAgentData: { platform: "PlayStation" },
    });

    expect(unknownPlatform.os).toBe("Unknown");
    expect(unknownPlatform.isMac).toBe(false);
    expect(unknownPlatform.isWindows).toBe(false);
    expect(unknownPlatform.isIOS).toBe(false);
    expect(unknownPlatform.isAndroid).toBe(false);
    expect(unknownPlatform.isLinux).toBe(false);
  });

  it("reports viewport breakpoint helpers from window.innerWidth", async () => {
    const platform = await loadPlatform({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15",
    });

    setInnerWidth(767);
    expect(platform.isMobileWidth).toBe(true);
    expect(platform.isTabletWidth).toBe(false);
    expect(platform.isDesktopWidth).toBe(false);

    setInnerWidth(768);
    expect(platform.isMobileWidth).toBe(false);
    expect(platform.isTabletWidth).toBe(true);
    expect(platform.isDesktopWidth).toBe(false);

    setInnerWidth(1024);
    expect(platform.isMobileWidth).toBe(false);
    expect(platform.isTabletWidth).toBe(false);
    expect(platform.isDesktopWidth).toBe(true);
  });
});
