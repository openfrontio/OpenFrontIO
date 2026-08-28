import { html, render } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JoinLobbyModal } from "../../src/client/JoinLobbyModal";

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

describe("JoinLobbyModal while connecting", () => {
  // The lobby card the player clicked already carries the game's settings
  // and player count, so they show at once; only the roster waits on the
  // server's lobby_info.
  const publicInfo = {
    gameID: "g1",
    numClients: 7,
    publicGameType: "ffa",
    gameConfig: { gameMap: "World", maxPlayers: 50 },
  } as any;

  const renderBody = (modal: JoinLobbyModal) => {
    const host = document.createElement("div");
    render((modal as any).renderBody(), host);
    return host;
  };

  const modalWithStubs = () => {
    const modal = new JoinLobbyModal();
    (modal as any).syncCountdownTimer = vi.fn();
    (modal as any).loadNationCount = vi.fn();
    (modal as any).renderGameConfig = () => html`<div id="game-config"></div>`;
    return modal;
  };

  it("shows the game settings and card player count before lobby_info", () => {
    const modal = modalWithStubs();
    (modal as any).startTrackingLobby("g1", publicInfo);
    expect((modal as any).isConnecting).toBe(true);

    const host = renderBody(modal);
    expect(host.querySelector("#game-config")).not.toBeNull();
    expect(host.querySelector(".animate-spin")).not.toBeNull();
    expect(host.querySelector("lobby-player-view")).toBeNull();
    expect(host.textContent).toContain("7/50");
  });

  it("falls back to the full spinner when there is no card (URL join)", () => {
    const modal = modalWithStubs();
    (modal as any).startTrackingLobby("g1");

    const host = renderBody(modal);
    expect(host.querySelector("#game-config")).toBeNull();
    expect(host.querySelector(".animate-spin")).not.toBeNull();
  });

  it("switches to the server roster once lobby_info lands", () => {
    const modal = modalWithStubs();
    (modal as any).startTrackingLobby("g1", publicInfo);
    (modal as any).handleLobbyInfo({
      myClientID: "me",
      lobby: {
        gameID: "g1",
        serverTime: 0,
        gameConfig: { gameMap: "World", maxPlayers: 50 },
        clients: [
          { clientID: "me", username: "me" },
          { clientID: "other", username: "other", spectator: true },
        ],
      },
    });
    expect((modal as any).isConnecting).toBe(false);

    const host = renderBody(modal);
    expect(host.querySelector("#game-config")).not.toBeNull();
    expect(host.querySelector("lobby-player-view")).not.toBeNull();
    // Seats, not connections: the spectator holds none.
    expect(host.textContent).toContain("1/50");
  });
});
