import { Howler } from "howler";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PokiSDK } from "../../src/client/PokiSDK";

type FakePoki = NonNullable<Window["PokiSDK"]>;

function fakePoki(overrides: Partial<FakePoki> = {}): FakePoki {
  return {
    init: vi.fn(async () => {}),
    gameLoadingFinished: vi.fn(),
    gameplayStart: vi.fn(),
    gameplayStop: vi.fn(),
    commercialBreak: vi.fn(async () => {}),
    shareableURL: vi.fn(async () => "https://poki.com/en/g/openfront"),
    getURLParam: vi.fn(() => ""),
    openExternalLink: vi.fn(),
    login: vi.fn(async () => {}),
    getUser: vi.fn(async () => null),
    getToken: vi.fn(async () => null),
    ...overrides,
  };
}

// Frames the page under `parent`, as Poki's game frame does.
function framedBy(parent: string): void {
  vi.spyOn(window, "top", "get").mockReturnValue({} as Window);
  vi.spyOn(document, "referrer", "get").mockReturnValue(parent);
}

// maybeInit() injects the SDK script; stand in for it loading.
async function initWith(sdk: PokiSDK, poki: FakePoki): Promise<void> {
  vi.spyOn(document.head, "appendChild").mockImplementation((node) => {
    window.PokiSDK = poki;
    queueMicrotask(() =>
      (node as HTMLScriptElement).onload?.(new Event("load")),
    );
    return node;
  });
  await sdk.maybeInit();
}

describe("PokiSDK", () => {
  let sdk: PokiSDK;

  beforeEach(() => {
    sdk = new PokiSDK();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete window.PokiSDK;
  });

  describe("isOnPoki", () => {
    it("is false when not framed", () => {
      vi.spyOn(document, "referrer", "get").mockReturnValue(
        "https://games.poki.com/",
      );
      expect(sdk.isOnPoki()).toBe(false);
    });

    it.each([
      "https://games.poki.com/458768/openfront",
      "https://abc123.poki-gdn.com/",
      "https://inspector.poki.dev/",
    ])("is true framed by %s", (parent) => {
      framedBy(parent);
      expect(sdk.isOnPoki()).toBe(true);
    });

    it.each([
      "https://www.crazygames.com/game/openfront",
      "https://notpoki.com/",
      "https://poki.com.example.net/",
      "",
    ])("is false framed by %s", (parent) => {
      framedBy(parent);
      expect(sdk.isOnPoki()).toBe(false);
    });
  });

  describe("once initialized on Poki", () => {
    let poki: FakePoki;

    beforeEach(async () => {
      framedBy("https://games.poki.com/458768/openfront");
      poki = fakePoki();
      await initWith(sdk, poki);
    });

    it("reports loading finished after init", () => {
      expect(poki.init).toHaveBeenCalledOnce();
      expect(poki.gameLoadingFinished).toHaveBeenCalledOnce();
      expect(sdk.isReady()).toBe(true);
    });

    it("maps the Poki user onto the portal user shape", async () => {
      poki.getUser = vi.fn(async () => ({
        username: "Pokey",
        avatarUrl: "https://poki.com/a.png",
      }));
      expect(await sdk.getUserProfile()).toEqual({
        username: "Pokey",
        profilePictureUrl: "https://poki.com/a.png",
      });
      expect(await sdk.getUsername()).toBe("Pokey");
    });

    it("treats an unavailable account feature as signed out", async () => {
      poki.getUser = vi.fn(async () => {
        throw new Error("opted out");
      });
      poki.getToken = vi.fn(async () => {
        throw new Error("opted out");
      });
      expect(await sdk.getUserProfile()).toBeNull();
      expect(await sdk.getUserToken()).toBeNull();
    });

    it("notifies auth listeners after a completed login", async () => {
      poki.getUser = vi.fn(async () => ({ username: "Pokey", avatarUrl: "" }));
      const listener = vi.fn();
      await sdk.addAuthListener(listener);
      await sdk.showAuthPrompt();
      expect(listener).toHaveBeenCalledWith({
        username: "Pokey",
        profilePictureUrl: "",
      });
    });

    it("does not notify auth listeners when login is dismissed", async () => {
      poki.login = vi.fn(async () => {
        throw new Error("cancelled");
      });
      const listener = vi.fn();
      await sdk.addAuthListener(listener);
      await sdk.showAuthPrompt();
      expect(listener).not.toHaveBeenCalled();
    });

    it("reports gameplay start and stop once each", async () => {
      await sdk.gameplayStart();
      await sdk.gameplayStart();
      await sdk.gameplayStop();
      await sdk.gameplayStop();
      expect(poki.gameplayStart).toHaveBeenCalledOnce();
      expect(poki.gameplayStop).toHaveBeenCalledOnce();
    });

    it("stops gameplay and mutes audio for a commercial break", async () => {
      const mute = vi.spyOn(Howler, "mute");
      poki.commercialBreak = vi.fn(async (onStart?: () => void) => {
        onStart?.();
        expect(mute).toHaveBeenLastCalledWith(true);
      });
      await sdk.gameplayStart();
      await sdk.requestMidgameAd();
      expect(poki.gameplayStop).toHaveBeenCalledOnce();
      expect(mute).toHaveBeenLastCalledWith(false);
    });

    it("unmutes even when the commercial break fails", async () => {
      const mute = vi.spyOn(Howler, "mute");
      poki.commercialBreak = vi.fn(async () => {
        throw new Error("ad error");
      });
      await sdk.requestMidgameAd();
      expect(mute).toHaveBeenLastCalledWith(false);
    });

    it("reads the invite game id from the Poki URL param", async () => {
      expect(await sdk.getInviteGameId()).toBeNull();
      poki.getURLParam = vi.fn(() => "abcd1234");
      expect(await sdk.getInviteGameId()).toBe("abcd1234");
      expect(poki.getURLParam).toHaveBeenCalledWith("gameId");
    });

    it("builds invite links through shareableURL", async () => {
      expect(await sdk.createInviteLink("abcd1234")).toBe(
        "https://poki.com/en/g/openfront",
      );
      expect(poki.shareableURL).toHaveBeenCalledWith({ gameId: "abcd1234" });
    });

    it("routes new-tab links through openExternalLink", () => {
      const external = document.createElement("a");
      external.href = "https://discord.gg/openfront";
      external.target = "_blank";
      const internal = document.createElement("a");
      internal.href = "#page-play";
      document.body.append(external, internal);

      const externalClick = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
      });
      external.dispatchEvent(externalClick);
      const internalClick = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
      });
      internal.dispatchEvent(internalClick);

      expect(externalClick.defaultPrevented).toBe(true);
      expect(poki.openExternalLink).toHaveBeenCalledWith(
        "https://discord.gg/openfront",
      );
      expect(internalClick.defaultPrevented).toBe(false);
      external.remove();
      internal.remove();
    });
  });

  it("still runs the game when init rejects (e.g. adblock)", async () => {
    framedBy("https://games.poki.com/458768/openfront");
    const poki = fakePoki({
      init: vi.fn(async () => {
        throw new Error("blocked");
      }),
    });
    await initWith(sdk, poki);
    expect(sdk.isReady()).toBe(true);
    expect(poki.gameLoadingFinished).toHaveBeenCalledOnce();
  });

  it("is a no-op off Poki", async () => {
    const appendChild = vi.spyOn(document.head, "appendChild");
    await sdk.maybeInit();
    expect(appendChild).not.toHaveBeenCalled();
    expect(await sdk.getUserToken()).toBeNull();
    expect(await sdk.getInviteGameId()).toBeNull();
    await sdk.requestMidgameAd();
  });
});
