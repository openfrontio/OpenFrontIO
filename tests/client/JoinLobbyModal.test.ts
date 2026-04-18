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
