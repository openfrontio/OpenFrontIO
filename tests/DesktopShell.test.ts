// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  composeVersionDisplay,
  desktopGoogleSignIn,
  desktopLinkGate,
  desktopPlayBilling,
  desktopQuit,
  desktopSteamLocale,
  desktopVersion,
  isDesktopShell,
  isSteamShell,
  requestDesktopQuit,
} from "../src/client/DesktopShell";

describe("isDesktopShell / isSteamShell", () => {
  afterEach(() => {
    window.openfrontDesktop = undefined;
  });

  it("are both false on the web, with no bridge present", () => {
    window.openfrontDesktop = undefined;
    expect(isDesktopShell()).toBe(false);
    expect(isSteamShell()).toBe(false);
  });

  // The Steam preload exposes `steam` whether or not Steam itself is running,
  // so on the Steam build the two predicates always agree.
  it("are both true in the Steam shell", () => {
    window.openfrontDesktop = {
      steam: {},
      shell: { version: "0.2.0", api: 7 },
    };
    expect(isDesktopShell()).toBe(true);
    expect(isSteamShell()).toBe(true);
  });

  // The Android shell's bridge carries the shell and updater, but no Steam.
  it("is a desktop shell but not a Steam shell on Android", () => {
    (window as { openfrontDesktop?: unknown }).openfrontDesktop = {
      shell: { version: "1.0.0", api: 7, platform: "android" },
      version: () => Promise.resolve("1.0.0"),
      update: {},
    };
    expect(isDesktopShell()).toBe(true);
    expect(isSteamShell()).toBe(false);
  });
});

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

// The Android shell's native Google sheet. Detected on the function actually
// called, and whatever it hands back is checked: the shell is another repo on
// another release schedule, so a malformed or newer answer is a failure, never
// a crash or an unchecked token.
describe("desktopGoogleSignIn", () => {
  afterEach(() => {
    window.openfrontDesktop = undefined;
  });

  it("is null in the browser, with no bridge present", () => {
    window.openfrontDesktop = undefined;
    expect(desktopGoogleSignIn()).toBeNull();
  });

  it("is null on a shell without google.signIn", () => {
    window.openfrontDesktop = { shell: { platform: "android" }, update: {} };
    expect(desktopGoogleSignIn()).toBeNull();
    window.openfrontDesktop = { google: {} };
    expect(desktopGoogleSignIn()).toBeNull();
    window.openfrontDesktop = { google: { signIn: true } };
    expect(desktopGoogleSignIn()).toBeNull();
  });

  it("calls signIn on the bridge object and passes a token through", async () => {
    const google = {
      signIn: vi.fn(async function (this: unknown) {
        expect(this).toBe(google);
        return { status: "ok", idToken: "id-token" };
      }),
    };
    window.openfrontDesktop = { google };
    const signIn = desktopGoogleSignIn();
    expect(signIn).not.toBeNull();
    await expect(signIn!()).resolves.toEqual({
      status: "ok",
      idToken: "id-token",
    });
    expect(google.signIn).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ status: "cancelled" }, { status: "cancelled" }],
    [
      { status: "error", code: "no_account" },
      { status: "error", code: "no_account" },
    ],
    [
      { status: "error", code: "unavailable" },
      { status: "error", code: "unavailable" },
    ],
    [
      { status: "error", code: "failed" },
      { status: "error", code: "failed" },
    ],
  ])("passes %j through", async (raw, expected) => {
    window.openfrontDesktop = { google: { signIn: async () => raw } };
    await expect(desktopGoogleSignIn()!()).resolves.toEqual(expected);
  });

  it.each([
    ["an unknown error code", { status: "error", code: "something_new" }],
    ["ok without a token", { status: "ok" }],
    ["ok with an empty token", { status: "ok", idToken: "" }],
    ["ok with a non-string token", { status: "ok", idToken: 42 }],
    ["an unknown status", { status: "maybe" }],
    ["null", null],
    ["a string", "ok"],
  ])("answers failed for %s", async (_label, raw) => {
    window.openfrontDesktop = { google: { signIn: async () => raw } };
    await expect(desktopGoogleSignIn()!()).resolves.toEqual({
      status: "error",
      code: "failed",
    });
  });

  it("answers failed when signIn rejects or throws", async () => {
    window.openfrontDesktop = {
      google: { signIn: () => Promise.reject(new Error("ipc")) },
    };
    await expect(desktopGoogleSignIn()!()).resolves.toEqual({
      status: "error",
      code: "failed",
    });
    window.openfrontDesktop = {
      google: {
        signIn: () => {
          throw new Error("sync");
        },
      },
    };
    await expect(desktopGoogleSignIn()!()).resolves.toEqual({
      status: "error",
      code: "failed",
    });
  });
});

// The Android app's Play billing bridge. Same rule as desktopGoogleSignIn:
// found by its methods, and every answer is checked before it is believed.
describe("desktopPlayBilling", () => {
  afterEach(() => {
    window.openfrontDesktop = undefined;
  });

  function install(overrides: Record<string, unknown> = {}) {
    const playBilling = {
      products: vi.fn(async () => ({ status: "ok", products: [] })),
      purchase: vi.fn(async () => ({ status: "cancelled" })),
      unconsumed: vi.fn(async () => ({ status: "ok", purchaseTokens: [] })),
      ...overrides,
    };
    window.openfrontDesktop = { playBilling };
    return playBilling;
  }

  it("is null in the browser, with no bridge present", () => {
    window.openfrontDesktop = undefined;
    expect(desktopPlayBilling()).toBeNull();
  });

  it("is null unless all three methods are functions", () => {
    window.openfrontDesktop = { shell: { platform: "android" } };
    expect(desktopPlayBilling()).toBeNull();
    install({ unconsumed: undefined });
    expect(desktopPlayBilling()).toBeNull();
    install({ purchase: true });
    expect(desktopPlayBilling()).toBeNull();
    install();
    expect(desktopPlayBilling()).not.toBeNull();
  });

  it("calls the methods on the bridge object", async () => {
    const playBilling = install();
    expect(
      await desktopPlayBilling()!.purchase({
        productId: "pack_1",
        accountId: "pub-1",
      }),
    ).toEqual({ status: "cancelled" });
    expect(playBilling.purchase).toHaveBeenCalledWith({
      productId: "pack_1",
      accountId: "pub-1",
    });
    expect(playBilling.purchase.mock.contexts[0]).toBe(playBilling);
  });

  it("keeps only well-formed products", async () => {
    install({
      products: async () => ({
        status: "ok",
        products: [
          { productId: "pack_1", formattedPrice: "€1,99" },
          { productId: "", formattedPrice: "€1,99" },
          { productId: "pack_2", formattedPrice: "" },
          { productId: "pack_3" },
          { productId: 4, formattedPrice: "€4" },
          null,
          "pack_5",
        ],
      }),
    });
    await expect(desktopPlayBilling()!.products(["pack_1"])).resolves.toEqual({
      status: "ok",
      products: [{ productId: "pack_1", formattedPrice: "€1,99" }],
    });
  });

  it("keeps only non-empty string tokens", async () => {
    install({
      unconsumed: async () => ({
        status: "ok",
        purchaseTokens: ["t1", "", 2, null, "t2"],
      }),
    });
    await expect(desktopPlayBilling()!.unconsumed()).resolves.toEqual({
      status: "ok",
      purchaseTokens: ["t1", "t2"],
    });
  });

  it.each([
    [
      { status: "ok", purchaseToken: "tok" },
      { status: "ok", purchaseToken: "tok" },
    ],
    [{ status: "cancelled" }, { status: "cancelled" }],
    [
      { status: "error", code: "already_owned" },
      { status: "error", code: "already_owned" },
    ],
    [
      { status: "error", code: "unavailable" },
      { status: "error", code: "unavailable" },
    ],
    [
      { status: "error", code: "busy" },
      { status: "error", code: "busy" },
    ],
    [
      { status: "error", code: "failed" },
      { status: "error", code: "failed" },
    ],
  ])("purchase passes %j through", async (raw, expected) => {
    install({ purchase: async () => raw });
    await expect(
      desktopPlayBilling()!.purchase({ productId: "p", accountId: "a" }),
    ).resolves.toEqual(expected);
  });

  it("passes unavailable through from products and unconsumed", async () => {
    const unavailable = { status: "error", code: "unavailable" };
    install({
      products: async () => unavailable,
      unconsumed: async () => unavailable,
    });
    const billing = desktopPlayBilling()!;
    await expect(billing.products(["p"])).resolves.toEqual(unavailable);
    await expect(billing.unconsumed()).resolves.toEqual(unavailable);
  });

  it.each([
    ["an unknown error code", { status: "error", code: "something_new" }],
    ["ok without a token", { status: "ok" }],
    ["ok with an empty token", { status: "ok", purchaseToken: "" }],
    ["ok with a non-string token", { status: "ok", purchaseToken: 42 }],
    ["an unknown status", { status: "maybe" }],
    ["null", null],
    ["a string", "ok"],
  ])("purchase answers failed for %s", async (_label, raw) => {
    install({ purchase: async () => raw });
    await expect(
      desktopPlayBilling()!.purchase({ productId: "p", accountId: "a" }),
    ).resolves.toEqual({ status: "error", code: "failed" });
  });

  it.each([
    ["an unknown error code", { status: "error", code: "busy" }],
    ["ok without a list", { status: "ok" }],
    ["null", null],
  ])("products and unconsumed answer failed for %s", async (_label, raw) => {
    install({ products: async () => raw, unconsumed: async () => raw });
    const billing = desktopPlayBilling()!;
    const failed = { status: "error", code: "failed" };
    await expect(billing.products(["p"])).resolves.toEqual(failed);
    await expect(billing.unconsumed()).resolves.toEqual(failed);
  });

  it("answers failed when a method rejects or throws", async () => {
    install({
      products: () => Promise.reject(new Error("ipc")),
      purchase: () => {
        throw new Error("sync");
      },
      unconsumed: () => Promise.reject(new Error("ipc")),
    });
    const billing = desktopPlayBilling()!;
    const failed = { status: "error", code: "failed" };
    await expect(billing.products(["p"])).resolves.toEqual(failed);
    await expect(
      billing.purchase({ productId: "p", accountId: "a" }),
    ).resolves.toEqual(failed);
    await expect(billing.unconsumed()).resolves.toEqual(failed);
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

describe("desktopSteamLocale", () => {
  afterEach(() => {
    window.openfrontDesktop = undefined;
  });

  it("returns the locale the shell reports", () => {
    window.openfrontDesktop = { steamLocale: "pt-BR" };
    expect(desktopSteamLocale()).toBe("pt-BR");
  });

  // "Not on desktop" and "Steam told the shell nothing" are deliberately the
  // same answer: both mean nothing better than navigator.language is known,
  // and both must leave it deciding rather than pinning the player to English.
  it("is null off the desktop shell", () => {
    window.openfrontDesktop = undefined;
    expect(desktopSteamLocale()).toBeNull();
  });

  it("is null when the shell reports no locale", () => {
    window.openfrontDesktop = { steamLocale: null };
    expect(desktopSteamLocale()).toBeNull();
  });

  it("is null when the bridge predates the field", () => {
    window.openfrontDesktop = {};
    expect(desktopSteamLocale()).toBeNull();
  });

  // The value reaches the shell as a process-argv string and is about to be
  // interpolated into an asset URL by loadLanguage, so it is validated rather
  // than trusted for arriving from our own preload.
  it("rejects anything that is not a language tag", () => {
    for (const locale of [
      "../../etc/passwd",
      "en_US",
      "e",
      "en-",
      "en US",
      "",
      42,
      {},
      // Well-shaped but not a real tag: "12" is neither a region nor a
      // variant. Caught by getCanonicalLocales, not the shape check -- and
      // worth a case of its own, because getClosestSupportedLang would narrow
      // it to "en" and let it beat a valid navigator.language.
      "en-12",
    ]) {
      window.openfrontDesktop = { steamLocale: locale };
      expect(desktopSteamLocale(), String(locale)).toBeNull();
    }
  });

  it("accepts the shapes the mapping actually emits", () => {
    for (const locale of ["en", "fr", "zh-CN", "pt-BR", "sv-SE", "es-419"]) {
      window.openfrontDesktop = { steamLocale: locale };
      expect(desktopSteamLocale(), locale).toBe(locale);
    }
  });
});
