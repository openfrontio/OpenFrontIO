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

type WrapperMessage = {
  ofPoki: true;
  id?: string;
  method: string;
  args: unknown[];
};

// Stands in for our Poki wrapper page (poki-wrapper/index.html): answers the
// frame's postMessage calls with the fake SDK, as the page's own SDK would.
// jsdom's parent is the window itself.
function fakeWrapper(
  poki: FakePoki,
  available = true,
): ReturnType<typeof vi.fn> {
  const received = vi.fn();
  const answer = (data: unknown) =>
    window.dispatchEvent(new MessageEvent("message", { data, source: window }));
  vi.spyOn(window, "postMessage").mockImplementation((data: unknown) => {
    const { id, method, args } = data as WrapperMessage;
    received(method, ...args);
    const run = async (): Promise<unknown> => {
      if (method === "hello") return available;
      if (method === "commercialBreak") {
        return poki.commercialBreak(() =>
          answer({ ofPoki: true, id, event: "commercialBreakStart" }),
        );
      }
      return (poki[method as keyof FakePoki] as (...a: unknown[]) => unknown)(
        ...args,
      );
    };
    void run().then(
      (result) => id !== undefined && answer({ ofPoki: true, id, result }),
      (error: Error) =>
        id !== undefined && answer({ ofPoki: true, id, error: error.message }),
    );
  });
  return received;
}

describe("PokiSDK", () => {
  let sdk: PokiSDK;

  beforeEach(() => {
    sdk = new PokiSDK();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete window.PokiSDK;
    sessionStorage.clear();
    history.replaceState(null, "", "/");
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

    // Firefox has no ancestorOrigins, and the referrer becomes our own URL
    // once the frame navigates (leaving a game, a lobby redirect).
    it("stays true after an in-frame navigation drops the Poki referrer", () => {
      framedBy("https://games.poki.com/458768/openfront");
      expect(sdk.isOnPoki()).toBe(true);
      vi.spyOn(document, "referrer", "get").mockReturnValue(
        "http://localhost/game/abcd1234",
      );
      expect(new PokiSDK().isOnPoki()).toBe(true);
    });

    it("ignores a remembered detection when not framed", () => {
      framedBy("https://games.poki.com/458768/openfront");
      expect(sdk.isOnPoki()).toBe(true);
      vi.restoreAllMocks();
      expect(sdk.isOnPoki()).toBe(false);
    });

    it("still detects Poki when sessionStorage throws", () => {
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("denied");
      });
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("denied");
      });
      framedBy("https://games.poki.com/458768/openfront");
      expect(sdk.isOnPoki()).toBe(true);
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

    it("hosts a new lobby from a gdhost link", async () => {
      expect(await sdk.isInstantMultiplayer()).toBe(false);
      poki.getURLParam = vi.fn((name: string) => (name === "host" ? "1" : ""));
      expect(await sdk.isInstantMultiplayer()).toBe(true);
    });

    it("joins rather than hosts when the link also carries an invite", async () => {
      poki.getURLParam = vi.fn((name: string) =>
        name === "gameId" ? "abcd1234" : "1",
      );
      expect(await sdk.isInstantMultiplayer()).toBe(false);
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

  it("gives up on an SDK script that never loads", async () => {
    vi.useFakeTimers();
    try {
      framedBy("https://games.poki.com/458768/openfront");
      vi.spyOn(document.head, "appendChild").mockImplementation((n) => n);
      const init = sdk.maybeInit();
      const token = sdk.getUserToken();
      await vi.advanceTimersByTimeAsync(10_000);
      await init;
      expect(sdk.isReady()).toBe(false);
      expect(await token).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("runs the game anyway when init never settles", async () => {
    vi.useFakeTimers();
    try {
      framedBy("https://games.poki.com/458768/openfront");
      const poki = fakePoki({ init: vi.fn(() => new Promise<void>(() => {})) });
      const init = initWith(sdk, poki);
      await vi.advanceTimersByTimeAsync(10_000);
      await init;
      expect(sdk.isReady()).toBe(true);
      expect(poki.gameLoadingFinished).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  // The SDK reads site_id, poki_url etc. from our URL, which our routing
  // rewrites; a reload without site_id disables Poki accounts.
  describe("Poki's URL params", () => {
    const pokiQuery =
      "?site_id=3&game_id=g1&poki_url=https%3A%2F%2Fpoki.com%2Fen%2Fg%2Fopenfront";

    beforeEach(() => {
      framedBy("https://games.poki.com/458768/openfront");
    });

    it("puts them back before the SDK loads after a rewrite and reload", async () => {
      history.replaceState(null, "", `/${pokiQuery}&gdgameId=abcd1234`);
      await initWith(sdk, fakePoki());

      history.replaceState(null, "", "/#refresh");
      let searchAtLoad = "";
      vi.spyOn(document.head, "appendChild").mockImplementation((node) => {
        searchAtLoad = window.location.search;
        window.PokiSDK = fakePoki();
        queueMicrotask(() =>
          (node as HTMLScriptElement).onload?.(new Event("load")),
        );
        return node;
      });
      await new PokiSDK().maybeInit();

      const params = new URLSearchParams(searchAtLoad);
      expect(params.get("site_id")).toBe("3");
      expect(params.get("game_id")).toBe("g1");
      expect(params.has("gdgameId")).toBe(false);
      expect(window.location.hash).toBe("#refresh");
    });

    it("puts them back before building an invite link", async () => {
      history.replaceState(null, "", `/${pokiQuery}`);
      let pokiUrl: string | null = null;
      const poki = fakePoki({
        shareableURL: vi.fn(async () => {
          pokiUrl = new URLSearchParams(window.location.search).get("poki_url");
          return "https://poki.com/en/g/openfront?gdgameId=abcd1234";
        }),
      });
      await initWith(sdk, poki);

      history.pushState(null, "", "/game/abcd1234");
      await sdk.createInviteLink("abcd1234");
      expect(pokiUrl).toBe("https://poki.com/en/g/openfront");
      expect(window.location.pathname).toBe("/game/abcd1234");
    });
  });

  // Leaving a game reloads our frame, which Poki can't follow an SDK through,
  // so on our wrapper the SDK is the wrapper's (PokiBridge.ts).
  describe("through our Poki wrapper", () => {
    let poki: FakePoki;
    let wrapper: ReturnType<typeof vi.fn>;
    let appendChild: ReturnType<typeof vi.spyOn>;

    beforeEach(async () => {
      framedBy("https://abc123.gdn.poki.com/");
      history.replaceState(null, "", "/?site_id=3&pokiBridge=1&gdgameId=ab12");
      poki = fakePoki({
        getToken: vi.fn(async () => "poki-token"),
        getUser: vi.fn(async () => ({
          username: "Pokey",
          avatarUrl: "https://example.com/a.png",
        })),
      });
      wrapper = fakeWrapper(poki);
      appendChild = vi.spyOn(document.head, "appendChild");
      await sdk.maybeInit();
    });

    it("uses the wrapper's SDK instead of loading one", () => {
      expect(appendChild).not.toHaveBeenCalled();
      expect(poki.init).toHaveBeenCalledOnce();
      expect(poki.gameLoadingFinished).toHaveBeenCalledOnce();
      expect(sdk.isReady()).toBe(true);
    });

    it("gets the user and token from the wrapper", async () => {
      expect(await sdk.getUserToken()).toBe("poki-token");
      expect(await sdk.getUserProfile()).toEqual({
        username: "Pokey",
        profilePictureUrl: "https://example.com/a.png",
      });
    });

    it("treats an error from the wrapper as signed out", async () => {
      poki.getToken = vi.fn(async () => {
        throw new Error("User accounts is not available");
      });
      expect(await sdk.getUserToken()).toBeNull();
    });

    it("reports gameplay and passes on links and invites", async () => {
      await sdk.gameplayStart();
      await sdk.gameplayStop();
      poki.shareableURL = vi.fn(async () => "https://poki.com/x?gdgameId=cd");
      expect(await sdk.createInviteLink("cd")).toBe(
        "https://poki.com/x?gdgameId=cd",
      );
      expect(wrapper).toHaveBeenCalledWith("gameplayStart");
      expect(wrapper).toHaveBeenCalledWith("gameplayStop");
      expect(poki.shareableURL).toHaveBeenCalledWith({ gameId: "cd" });
    });

    it("reads invite params from our own URL", async () => {
      expect(await sdk.getInviteGameId()).toBe("ab12");
    });

    it("mutes only once the wrapper's ad starts, and unmutes after", async () => {
      const mute = vi.spyOn(Howler, "mute");
      let started = () => {};
      poki.commercialBreak = vi.fn(async (onStart) => {
        expect(mute).not.toHaveBeenCalled();
        onStart?.();
        await new Promise<void>((resolve) => (started = resolve));
      });
      const ad = sdk.requestMidgameAd();
      await vi.waitFor(() => expect(mute).toHaveBeenCalledWith(true));
      started();
      await ad;
      expect(mute).toHaveBeenLastCalledWith(false);
    });

    // A fresh module, so only sessionStorage carries the flag, as on a reload.
    async function reload(): Promise<PokiSDK> {
      vi.resetModules();
      const { PokiSDK: Reloaded } = await import("../../src/client/PokiSDK");
      return new Reloaded();
    }

    it("keeps using the wrapper after our routing drops the marker", async () => {
      history.replaceState(null, "", "/");
      const reloaded = await reload();
      await reloaded.maybeInit();
      expect(appendChild).not.toHaveBeenCalled();
      expect(reloaded.isReady()).toBe(true);
    });

    it("loads its own SDK once a wrapper without the bridge loads us", async () => {
      history.replaceState(null, "", "/?site_id=3");
      await initWith(await reload(), poki);
      expect(appendChild).toHaveBeenCalledOnce();

      history.replaceState(null, "", "/");
      await initWith(await reload(), poki);
      expect(appendChild).toHaveBeenCalledTimes(2);
    });
  });

  it("gives up when the wrapper's SDK didn't load", async () => {
    framedBy("https://abc123.gdn.poki.com/");
    history.replaceState(null, "", "/?pokiBridge=1");
    fakeWrapper(fakePoki(), false);
    await sdk.maybeInit();
    expect(sdk.isReady()).toBe(false);
    expect(await sdk.getUserToken()).toBeNull();
  });

  it("is a no-op off Poki", async () => {
    const appendChild = vi.spyOn(document.head, "appendChild");
    await sdk.maybeInit();
    expect(appendChild).not.toHaveBeenCalled();
    expect(await sdk.getUserToken()).toBeNull();
    expect(await sdk.getInviteGameId()).toBeNull();
    expect(await sdk.isInstantMultiplayer()).toBe(false);
    await sdk.requestMidgameAd();
  });
});
