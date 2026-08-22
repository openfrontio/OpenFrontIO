import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JoinLobbyModal } from "../../src/client/JoinLobbyModal";
import { GameType } from "../../src/core/game/Game";

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

describe("JoinLobbyModal host hand-off", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createModal = (overrides: any = {}) => {
    const m = new JoinLobbyModal();
    Object.assign(m, overrides);
    return m;
  };

  it("disarms leave-on-close and dispatches switch-to-host-lobby with the lobby id", () => {
    const lobbyId = "random-id";
    const modal = createModal({
      currentLobbyId: lobbyId,
    });

    const disarmSpy = vi.spyOn(modal, "disarmLeaveOnClose");
    const dispatchSpy = vi.spyOn(modal, "dispatchEvent");

    modal["switchToHostLobby"]();

    expect(modal["hasSwitchedToHost"]).toBe(true);
    expect(disarmSpy).toHaveBeenCalledTimes(1);
    expect(dispatchSpy).toHaveBeenCalledTimes(1);

    const event = dispatchSpy.mock.calls[0][0] as CustomEvent;
    expect(event.type).toBe("switch-to-host-lobby");
    expect(event.detail.lobbyId).toEqual(lobbyId);
  });

  it("switches to host only for a private lobby whose creator is the current client", () => {
    const modal = createModal({
      gameConfig: { gameType: GameType.Private },
      currentClientID: "foo",
      lobbyCreatorClientId: "bar",
      isConnecting: false,
    });

    expect(modal["canSwitchToHostLobby"]()).toBe(false);

    modal["lobbyCreatorClientID"] = "foo";

    expect(modal["canSwitchToHostLobby"]()).toBe(true);
  });

  it("does not switch when the current client is not the creator", () => {
    const canSwitchToHostLobby = createModal({
      gameConfig: { gameType: GameType.Private },
      currentClientID: "foo",
      lobbyCreatorClientId: "bar",
    })["canSwitchToHostLobby"]();

    expect(canSwitchToHostLobby).toBe(false);
  });

  it("does not switch in the default pre-join state", () => {
    // currentClientID "" and lobbyCreatorClientID null must not compare equal.
    expect(createModal()["canSwitchToHostLobby"]()).toBe(false);
  });

  it("does not switch a second time once it has handed off", () => {
    const canSwitchToHostLobby = createModal({
      gameConfig: { gameType: GameType.Private },
      currentClientID: "foo",
      lobbyCreatorClientId: "foo",
      hasSwitchedToHost: true,
    })["canSwitchToHostLobby"]();

    expect(canSwitchToHostLobby).toBe(false);
  });

  it("hands off exactly once across repeated lobby-info events", () => {
    const modal = createModal({
      syncCountdownTimer: vi.fn(),
      loadNationCount: vi.fn(),
    });

    const switchSpy = vi.spyOn(modal as any, "switchToHostLobby");

    const hostId = "foo";

    const info: Parameters<(typeof modal)["handleLobbyInfo"]>[0] = {
      lobby: {
        gameID: "g",
        clients: [],
        lobbyCreatorClientID: hostId,
        serverTime: 0,
        gameConfig: {
          gameType: GameType.Private,
        } as any,
      },
      myClientID: hostId,
    };

    modal["handleLobbyInfo"](info);
    modal["handleLobbyInfo"](info);

    expect(switchSpy).toHaveBeenCalledTimes(1);
  });
});
