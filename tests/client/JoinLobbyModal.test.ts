import { render } from "lit";
import type { MockInstance } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const presenceMocks = vi.hoisted(() => ({
  isAvailable: vi.fn(() => false),
  openInviteDialog: vi.fn(async () => true),
}));

// The desktop bridge is absent in a browser and in jsdom. Mocking the module
// lets each test state which shell it is running in, which is the only thing
// the invite button is gated on.
vi.mock("../../src/client/DesktopPresence", () => ({
  desktopPresence: {
    isAvailable: presenceMocks.isAvailable,
    openInviteDialog: presenceMocks.openInviteDialog,
    set: vi.fn(),
    consumePendingInvite: vi.fn(async () => null),
    subscribeInvites: vi.fn(() => () => undefined),
  },
}));

const alertMocks = vi.hoisted(() => ({
  construct: vi.fn(),
  play: vi.fn(),
}));

vi.mock("howler", () => ({
  Howl: class {
    constructor(options: unknown) {
      alertMocks.construct(options);
    }

    play() {
      return alertMocks.play();
    }
  },
}));

import {
  Difficulty,
  GameMapType,
  GameMode,
  GameType,
} from "@openfront/engine-api/game/GameTypes";
import { ClientEnv } from "../../src/client/ClientEnv";
import { JoinLobbyModal } from "../../src/client/JoinLobbyModal";
import { UserSettings } from "../../src/client/UserSettings";

function resetUserSettingsState() {
  localStorage.clear();
  const statics = UserSettings as unknown as {
    cache: Map<string, string | null>;
    playerId: string | null;
  };
  statics.cache.clear();
  statics.playerId = null;
}

describe("JoinLobbyModal lobby start alert default", () => {
  beforeEach(() => {
    resetUserSettingsState();
    alertMocks.construct.mockReset();
    alertMocks.play.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function trackingModal() {
    const modal = new JoinLobbyModal();
    (modal as any).startLobbyUpdates = vi.fn();
    return modal;
  }

  function bellButton(modal: JoinLobbyModal): HTMLButtonElement {
    const container = document.createElement("div");
    render((modal as any).gameStartAlert.renderBell(), container);
    return container.querySelector("button")!;
  }

  function showMessageEvents(spy: MockInstance<Window["dispatchEvent"]>) {
    return spy.mock.calls.filter(([event]) => event.type === "show-message");
  }

  it("keeps the existing off default without preloading", () => {
    const modal = trackingModal();

    (modal as any).startTrackingLobby("first");

    expect(bellButton(modal).getAttribute("aria-pressed")).toBe("false");
    expect(alertMocks.construct).not.toHaveBeenCalled();
  });

  it("auto-arms and preloads without showing the manual-arm toast", () => {
    new UserSettings().setLobbyStartAlerts(true);
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    const modal = trackingModal();

    (modal as any).startTrackingLobby("first");

    expect(bellButton(modal).getAttribute("aria-pressed")).toBe("true");
    expect(alertMocks.construct).toHaveBeenCalledOnce();
    expect(showMessageEvents(dispatchSpy)).toHaveLength(0);
  });

  it("keeps bell overrides local to one lobby", () => {
    new UserSettings().setLobbyStartAlerts(true);
    const modal = trackingModal();
    (modal as any).startTrackingLobby("first");

    bellButton(modal).click();
    expect(bellButton(modal).getAttribute("aria-pressed")).toBe("false");
    expect(new UserSettings().lobbyStartAlerts()).toBe(true);

    (modal as any).startTrackingLobby("second");
    expect(bellButton(modal).getAttribute("aria-pressed")).toBe("true");
  });

  it("still plays the chime when notification permission is denied", () => {
    new UserSettings().setLobbyStartAlerts(true);
    const modal = trackingModal();
    (modal as any).startTrackingLobby("first");
    (modal as any).currentLobbyId = "first";
    vi.stubGlobal("Notification", { permission: "denied" });

    (modal as any).gameStartAlert.handleGameStarting();

    expect(alertMocks.play).toHaveBeenCalledOnce();
  });
});

describe("JoinLobbyModal server time offset", () => {
  let nowMs = 0;

  beforeEach(() => {
    vi.spyOn(Date, "now").mockImplementation(() => nowMs);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("updates serverTimeOffset from lobby serverTime", () => {
    const modal = new JoinLobbyModal();
    (modal as any).syncCountdownTimer = vi.fn();

    nowMs = 220_000;
    (modal as any).updateFromLobby({
      gameID: "g1",
      serverTime: 200_000,
      startsAt: 230_000,
      clients: [],
    });

    expect((modal as any).serverTimeOffset).toBe(-20_000);
    expect((modal as any).lobbyStartAt).toBe(230_000);
  });

  it("does not trigger join timeout early when local clock is ahead", () => {
    const modal = new JoinLobbyModal();
    const closeSpy = vi
      .spyOn(modal, "closeAndLeave")
      .mockImplementation(() => undefined);
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");

    (modal as any).isModalOpen = true;
    (modal as any).isConnecting = true;
    (modal as any).handledJoinTimeout = false;

    // Local clock is +60s ahead of server clock.
    nowMs = 160_000;
    (modal as any).lobbyStartAt = 105_000;
    (modal as any).serverTimeOffset = -60_000;

    (modal as any).checkForJoinTimeout();

    expect(closeSpy).not.toHaveBeenCalled();
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect((modal as any).handledJoinTimeout).toBe(false);
  });

  it("triggers join timeout once adjusted server time reaches lobbyStartAt", () => {
    const modal = new JoinLobbyModal();
    const closeSpy = vi
      .spyOn(modal, "closeAndLeave")
      .mockImplementation(() => undefined);
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");

    (modal as any).isModalOpen = true;
    (modal as any).isConnecting = true;
    (modal as any).handledJoinTimeout = false;
    (modal as any).lobbyStartAt = 105_000;
    (modal as any).serverTimeOffset = -60_000;

    nowMs = 165_000;
    (modal as any).checkForJoinTimeout();

    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect((modal as any).handledJoinTimeout).toBe(true);
  });
});

describe("JoinLobbyModal spectate link", () => {
  // A spectate URL is the same lobby link with ?spectate: it must reach the
  // server as a spectator join, and fall through to the archive once the game
  // is over exactly as the play link does.
  const modalWith = (exists: boolean, archived: string) => {
    const modal = new JoinLobbyModal();
    (modal as any).startTrackingLobby = vi.fn();
    (modal as any).resetTrackingState = vi.fn();
    (modal as any).showMessage = vi.fn();
    (modal as any).checkActiveLobby = vi.fn().mockResolvedValue(exists);
    (modal as any).checkArchivedGame = vi.fn().mockResolvedValue(archived);
    return modal;
  };

  it("joins a live lobby as a spectator", async () => {
    const modal = modalWith(true, "not_found");
    await (modal as any).handleUrlJoin("AbCd1234", true);
    expect((modal as any).checkActiveLobby).toHaveBeenCalledWith(
      "AbCd1234",
      true,
    );
    expect((modal as any).checkArchivedGame).not.toHaveBeenCalled();
  });

  it("joins as a player without the flag", async () => {
    const modal = modalWith(true, "not_found");
    await (modal as any).handleUrlJoin("AbCd1234");
    expect((modal as any).checkActiveLobby).toHaveBeenCalledWith(
      "AbCd1234",
      false,
    );
  });

  it("becomes the replay once the game is over", async () => {
    const modal = modalWith(false, "success");
    await (modal as any).handleUrlJoin("AbCd1234", true);
    expect((modal as any).checkArchivedGame).toHaveBeenCalledWith("AbCd1234");
    expect((modal as any).showMessage).not.toHaveBeenCalled();
  });
});

// OPE-205. Steam's invite dialog is reachable only through the in-game
// overlay, so this button is desktop-shell-only: desktopPresence.isAvailable()
// checks shell.api >= 2, which is false in a browser and on an older depot's
// shell. These tests pin the gating and the wiring; whether the dialog
// actually renders is OPE-200's acceptance criterion and needs a packaged
// Steam build to verify.
describe("JoinLobbyModal Steam invite button", () => {
  const INVITE = "[data-test-invite-friends]";

  function renderHeader(modal: JoinLobbyModal): HTMLElement {
    const container = document.createElement("div");
    render(
      (
        modal as unknown as { renderHeaderSlot(): unknown }
      ).renderHeaderSlot() as never,
      container,
    );
    return container;
  }

  // A joined lobby whose config has arrived; private FFA unless overridden.
  function lobbyModal(config?: {
    gameType: GameType;
    gameMode: GameMode;
  }): JoinLobbyModal {
    const modal = new JoinLobbyModal();
    (modal as unknown as { currentLobbyId: string }).currentLobbyId =
      "ABCD1234";
    (modal as unknown as { gameConfig: unknown }).gameConfig = config ?? {
      gameType: GameType.Private,
      gameMode: GameMode.FFA,
    };
    return modal;
  }

  beforeEach(() => {
    presenceMocks.isAvailable.mockReset().mockReturnValue(false);
    presenceMocks.openInviteDialog.mockReset().mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is absent in a browser", () => {
    presenceMocks.isAvailable.mockReturnValue(false);

    expect(renderHeader(lobbyModal()).querySelector(INVITE)).toBeNull();
  });

  it("is absent before joining a lobby, even on the desktop shell", () => {
    presenceMocks.isAvailable.mockReturnValue(true);
    const modal = new JoinLobbyModal();

    // There is nothing to invite anyone into until a lobby is joined.
    expect(renderHeader(modal).querySelector(INVITE)).toBeNull();
  });

  it("appears in a joined private lobby on the desktop shell", () => {
    presenceMocks.isAvailable.mockReturnValue(true);

    expect(renderHeader(lobbyModal()).querySelector(INVITE)).not.toBeNull();
  });

  // The URL-join and accepted-Steam-invite paths render this header before
  // the first lobby_info delivers the config. That window must not show a
  // button the config may be about to forbid.
  it("is absent while the lobby's config is still unknown", () => {
    presenceMocks.isAvailable.mockReturnValue(true);
    const modal = lobbyModal();
    (modal as unknown as { gameConfig: unknown }).gameConfig = null;

    expect(renderHeader(modal).querySelector(INVITE)).toBeNull();
  });

  it("opens the Steam invite dialog when clicked", () => {
    presenceMocks.isAvailable.mockReturnValue(true);
    const button =
      renderHeader(lobbyModal()).querySelector<HTMLButtonElement>(INVITE);

    button?.click();

    expect(presenceMocks.openInviteDialog).toHaveBeenCalledOnce();
  });

  // The bridge resolves false when Steam is absent or the overlay refuses.
  // Nothing in the lobby should break on that -- the click is best-effort.
  it("survives the bridge reporting failure", async () => {
    presenceMocks.isAvailable.mockReturnValue(true);
    presenceMocks.openInviteDialog.mockResolvedValue(false);
    const button =
      renderHeader(lobbyModal()).querySelector<HTMLButtonElement>(INVITE);

    expect(() => button?.click()).not.toThrow();
    await Promise.resolve();
  });

  // Inviting Steam friends into a public FFA match encourages teaming, so
  // the button is suppressed exactly there and nowhere else.
  it("is absent in a public FFA lobby", () => {
    presenceMocks.isAvailable.mockReturnValue(true);
    const modal = lobbyModal({
      gameType: GameType.Public,
      gameMode: GameMode.FFA,
    });

    expect(renderHeader(modal).querySelector(INVITE)).toBeNull();
  });

  it("appears in a public team lobby", () => {
    presenceMocks.isAvailable.mockReturnValue(true);
    const modal = lobbyModal({
      gameType: GameType.Public,
      gameMode: GameMode.Team,
    });

    expect(renderHeader(modal).querySelector(INVITE)).not.toBeNull();
  });

  it("does not suppress the copy button", () => {
    presenceMocks.isAvailable.mockReturnValue(true);

    const header = renderHeader(lobbyModal());

    expect(header.querySelector("copy-button")).not.toBeNull();
    expect(header.querySelector(INVITE)).not.toBeNull();
  });

  it("shows the copy button in a public team lobby", () => {
    const modal = lobbyModal({
      gameType: GameType.Public,
      gameMode: GameMode.Team,
    });

    const copy = renderHeader(modal).querySelector("copy-button") as
      | (HTMLElement & { lobbyId?: string })
      | null;

    expect(copy?.lobbyId).toBe("ABCD1234");
  });

  it("hides the copy button in a public FFA lobby", () => {
    const modal = lobbyModal({
      gameType: GameType.Public,
      gameMode: GameMode.FFA,
    });

    expect(renderHeader(modal).querySelector("copy-button")).toBeNull();
  });
});

describe("JoinLobbyModal boost button", () => {
  const LOBBY = "ABCD1234";
  const queued = (gameID: string, extra: Record<string, unknown> = {}) => ({
    gameID,
    numClients: 0,
    publicGameType: "ffa",
    ...extra,
  });

  // A joined public FFA lobby waiting at the back of its queue, with the
  // boost priced.
  function boostableModal(lobby: Record<string, unknown> = {}) {
    const modal = new JoinLobbyModal();
    const m = modal as any;
    m.currentLobbyId = LOBBY;
    m.isConnecting = false;
    m.boostPriceHard = 3;
    m.publicQueues = {
      ffa: [queued("front", { startsAt: 5000 }), queued("mid"), queued(LOBBY)],
    };
    m.updateFromLobby({
      gameID: LOBBY,
      serverTime: Date.now(),
      publicGameType: "ffa",
      gameConfig: { gameType: GameType.Public, gameMode: GameMode.FFA },
      clients: [{ clientID: "c1", username: "Alice" }],
      ...lobby,
    });
    return m;
  }

  function renderBoost(m: any): HTMLElement {
    const container = document.createElement("div");
    render(m.renderBoost() as never, container);
    return container;
  }

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("shows the lobby's position in its queue", () => {
    const container = document.createElement("div");
    const m = boostableModal();
    expect(m.queuePosition()).toBe(3);
    render(m.renderQueuePosition() as never, container);
    expect(container.querySelector("span")).not.toBeNull();

    // Not listed yet: nothing to show.
    m.publicQueues = { ffa: [queued("front")] };
    expect(m.queuePosition()).toBeNull();
    render(m.renderQueuePosition() as never, container);
    expect(container.children).toHaveLength(0);
  });

  it("offers the boost with its price in a waiting public lobby", () => {
    const button = renderBoost(boostableModal()).querySelector("button");
    expect(button?.textContent).toContain("3");
  });

  it.each<[string, (m: any) => void]>([
    ["the catalog has no price", (m) => (m.boostPriceHard = null)],
    ["the lobby is counting down", (m) => (m.lobbyStartAt = Date.now() + 5000)],
    [
      "the lobby is already next",
      (m) =>
        (m.publicQueues = {
          ffa: [queued("front", { startsAt: 5000 }), queued(LOBBY)],
        }),
    ],
    [
      "only boosted lobbies are ahead",
      (m) =>
        (m.publicQueues = {
          ffa: [queued("mid", { boosted: true }), queued(LOBBY)],
        }),
    ],
  ])("hides it when %s", (_, change) => {
    const m = boostableModal();
    change(m);
    expect(renderBoost(m).children).toHaveLength(0);
  });

  it("keeps it for a retry after a charge that failed without an answer", () => {
    const m = boostableModal();
    m.boostRetryHeld = true;
    m.lobbyStartAt = Date.now() + 5000;
    m.publicQueues = { ffa: [queued(LOBBY, { startsAt: 5000 })] };
    expect(renderBoost(m).querySelector("button")).not.toBeNull();
  });

  it("hides it in a private lobby", () => {
    const m = boostableModal({
      publicGameType: undefined,
      gameConfig: { gameType: GameType.Private, gameMode: GameMode.FFA },
    });
    expect(renderBoost(m).children).toHaveLength(0);
  });

  it("shows a boosted lobby as boosted, with no button", () => {
    const container = renderBoost(boostableModal({ boostedBy: "c1" }));
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector("span")).not.toBeNull();
  });

  it("announces a boost that happens while in the lobby, once", () => {
    const toasts: string[] = [];
    window.addEventListener("show-message", ((e: CustomEvent) => {
      toasts.push(String(e.detail?.message));
    }) as EventListener);
    const m = boostableModal();
    const update = {
      gameID: LOBBY,
      serverTime: Date.now(),
      publicGameType: "ffa",
      gameConfig: { gameType: GameType.Public, gameMode: GameMode.FFA },
      clients: [{ clientID: "c1", username: "Alice" }],
      boostedBy: "c1",
    };
    m.updateFromLobby(update);
    m.updateFromLobby(update);
    expect(m.boosted).toBe(true);
    expect(toasts).toHaveLength(1);
  });

  it("doesn't announce a lobby that was boosted before joining", () => {
    const toasts: unknown[] = [];
    window.addEventListener("show-message", (e) => toasts.push(e));
    boostableModal({ boostedBy: "c1" });
    expect(toasts).toHaveLength(0);
  });
});

describe("JoinLobbyModal map preview", () => {
  const PREVIEW = "[data-test-map-preview]";
  const SETTINGS = "[data-test-lobby-settings]";

  function renderConfig(config: Record<string, unknown>): HTMLElement {
    const modal = new JoinLobbyModal();
    (modal as unknown as { gameConfig: unknown }).gameConfig = {
      gameMap: GameMapType.World,
      gameType: GameType.Private,
      gameMode: GameMode.FFA,
      difficulty: Difficulty.Easy,
      disabledUnits: [],
      ...config,
    };
    const container = document.createElement("div");
    render(
      (
        modal as unknown as { renderGameConfig(): unknown }
      ).renderGameConfig() as never,
      container,
    );
    return container;
  }

  it("shows the thumbnail of the lobby's map", () => {
    const image = renderConfig({
      gameMap: GameMapType.Africa,
    }).querySelector<HTMLImageElement>(`${PREVIEW} img`);

    expect(image?.getAttribute("src")).toContain("maps/africa/thumbnail.webp");
  });

  // The preview used to be an 80px square with object-cover, which cropped
  // every non-square map (World showed only its central half). It must show
  // the whole map, so it scales to fit instead of filling a fixed box.
  it("fits the whole map instead of cropping it to a fixed square", () => {
    const classes =
      renderConfig({}).querySelector(`${PREVIEW} img`)?.getAttribute("class") ??
      "";

    expect(classes).toContain("object-contain");
    expect(classes).not.toContain("object-cover");
  });

  it("hides itself when the thumbnail fails to load", () => {
    const preview = renderConfig({}).querySelector<HTMLElement>(PREVIEW)!;

    preview.querySelector("img")!.dispatchEvent(new Event("error"));

    expect(preview.style.display).toBe("none");
  });

  // Tags, not one card per setting: a lobby with many settings has to stay
  // readable next to the preview without pushing the player list away.
  it("lists each notable setting as one tag next to the preview", () => {
    const tags = (config: Record<string, unknown>) =>
      renderConfig(config).querySelectorAll(`${SETTINGS} > span`).length;

    expect(tags({ infiniteGold: true, instantBuild: true })).toBe(tags({}) + 2);
  });
});

describe("JoinLobbyModal checkActiveLobby resilience", () => {
  beforeEach(() => {
    ClientEnv.reset();
    (window as any).BOOTSTRAP_CONFIG = {
      gameEnv: "prod",
      numWorkers: 1,
      turnstileSiteKey: "x",
      jwtAudience: "openfront.io",
      instanceId: "test",
      gitCommit: "test",
      serverHost: "blue.openfront.io",
    };
  });

  afterEach(() => {
    delete (window as any).BOOTSTRAP_CONFIG;
    ClientEnv.reset();
    vi.restoreAllMocks();
  });

  it("returns false instead of throwing when /exists fetch throws", async () => {
    const modal = new JoinLobbyModal();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/exists")) {
        throw new TypeError("Failed to fetch");
      }
      return new Response(JSON.stringify({ servers: {} }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const result = await (modal as any).checkActiveLobby("AbCd1234");
    expect(result).toBe(false);
  });

  it("returns false instead of throwing when resolving the server throws", async () => {
    ClientEnv.reset();
    const modal = new JoinLobbyModal();
    (window as any).BOOTSTRAP_CONFIG = {
      gameEnv: "prod",
      turnstileSiteKey: "x",
      jwtAudience: "openfront.io",
      instanceId: "test",
      gitCommit: "test",
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ servers: {} }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const gameHttpBaseSpy = vi
      .spyOn(ClientEnv, "gameHttpBase")
      .mockImplementation(() => {
        throw new Error("server resolution failed");
      });

    const result = await (modal as any).checkActiveLobby("AbCd1234");
    expect(result).toBe(false);
    expect(gameHttpBaseSpy).toHaveBeenCalledWith("AbCd1234");
  });

  it("falls through to checkArchivedGame when /exists fetch throws during handleUrlJoin", async () => {
    const modal = new JoinLobbyModal();
    (modal as any).startTrackingLobby = vi.fn();
    (modal as any).checkArchivedGame = vi.fn().mockResolvedValue("success");
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/exists")) {
        throw new TypeError("Failed to fetch");
      }
      return new Response(JSON.stringify({ servers: {} }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    await (modal as any).handleUrlJoin("AbCd1234");
    expect((modal as any).checkArchivedGame).toHaveBeenCalledWith("AbCd1234");
  });
});

describe("JoinLobbyModal pasted lobby links", () => {
  const normalize = (input: string): string | null =>
    (new JoinLobbyModal() as any).normalizeLobbyId(input);

  it("takes the id from a Poki invite link", () => {
    expect(
      normalize(
        "https://poki.com/en/preview/8d0149be-4a6f-4eb3-8af0-d7d5ee9c2cc5/58c9e7b0-5432-4117-8f51-62022219c432?gdgameId=AbCd1234",
      ),
    ).toBe("AbCd1234");
    expect(normalize("https://poki.com/en/g/openfront?gdgameId=AbCd1234")).toBe(
      "AbCd1234",
    );
  });

  it("takes the id from a CrazyGames invite link, not its /game/ path", () => {
    expect(
      normalize("https://www.crazygames.com/game/openfront?gameId=AbCd1234"),
    ).toBe("AbCd1234");
  });

  it("still takes the id from our own lobby link and a bare id", () => {
    expect(normalize("https://openfront.io/game/AbCd1234?lobby&s=x1y2z")).toBe(
      "AbCd1234",
    );
    expect(normalize("AbCd1234")).toBe("AbCd1234");
  });
});
