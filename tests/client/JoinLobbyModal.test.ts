import { render } from "lit";
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

import { JoinLobbyModal } from "../../src/client/JoinLobbyModal";
import { GameMode, GameType } from "../../src/core/game/Game";
import { UserSettings } from "../../src/core/game/UserSettings";

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
  beforeEach(resetUserSettingsState);

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function trackingModal() {
    const modal = new JoinLobbyModal();
    (modal as any).startLobbyUpdates = vi.fn();
    (modal as any).loadStartAlertSound = vi.fn();
    (modal as any).showMessage = vi.fn();
    return modal;
  }

  it("keeps the existing off default without preloading", () => {
    const modal = trackingModal();

    (modal as any).startTrackingLobby("first");

    expect((modal as any).notifyOnStart).toBe(false);
    expect((modal as any).loadStartAlertSound).not.toHaveBeenCalled();
  });

  it("auto-arms and preloads without showing the manual-arm toast", () => {
    new UserSettings().setLobbyStartAlerts(true);
    const modal = trackingModal();

    (modal as any).startTrackingLobby("first");

    expect((modal as any).notifyOnStart).toBe(true);
    expect((modal as any).loadStartAlertSound).toHaveBeenCalledOnce();
    expect((modal as any).showMessage).not.toHaveBeenCalled();
  });

  it("keeps bell overrides local to one lobby", () => {
    new UserSettings().setLobbyStartAlerts(true);
    const modal = trackingModal();
    (modal as any).startTrackingLobby("first");

    (modal as any).toggleNotifyOnStart();
    expect((modal as any).notifyOnStart).toBe(false);
    expect(new UserSettings().lobbyStartAlerts()).toBe(true);

    (modal as any).startTrackingLobby("second");
    expect((modal as any).notifyOnStart).toBe(true);
  });

  it("still plays the chime when notification permission is denied", () => {
    const modal = trackingModal();
    (modal as any).currentLobbyId = "first";
    (modal as any).notifyOnStart = true;
    (modal as any).playStartAlertSound = vi.fn();
    vi.stubGlobal("Notification", { permission: "denied" });

    (modal as any).handleGameStarting();

    expect((modal as any).playStartAlertSound).toHaveBeenCalledOnce();
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

  it("does not suppress the private-lobby copy button", () => {
    presenceMocks.isAvailable.mockReturnValue(true);
    const modal = lobbyModal();
    vi.spyOn(
      modal as unknown as { isPrivateLobby(): boolean },
      "isPrivateLobby",
    ).mockReturnValue(true);

    const header = renderHeader(modal);

    expect(header.querySelector("copy-button")).not.toBeNull();
    expect(header.querySelector(INVITE)).not.toBeNull();
  });
});
