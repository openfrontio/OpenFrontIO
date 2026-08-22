import { afterEach, describe, expect, it, Mock, vi } from "vitest";
import { HostLobbyModal } from "../../src/client/HostLobbyModal";

describe("HostLobbyModal attachToExistingLobby", () => {
  const VALID_ID = "abcd1234";

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeModal() {
    const modal = new HostLobbyModal();
    // Stub the URL/history side effects and the render barrier so the method
    // under test runs without a DOM connection.
    (modal as any).constructUrl = vi
      .fn()
      .mockResolvedValue("https://example.com/game/abcd1234?lobby");
    (modal as any).updateLobbyHistory = vi.fn();
    Object.defineProperty(modal, "updateComplete", {
      configurable: true,
      get: () => Promise.resolve(true),
    });
    return modal;
  }

  function spyOnModal() {
    const modal = makeModal();
    const dispatchSpy = vi.spyOn(modal, "dispatchEvent");
    return { modal, dispatchSpy };
  }

  function joinLobbyEvents(spy: Mock<(event: Event) => boolean>) {
    return spy.mock.calls
      .map((c) => c[0] as Event)
      .filter((e) => e.type === "join-lobby");
  }

  it("dispatches join-lobby when attaching to a lobby that is not yet connected", async () => {
    const { modal, dispatchSpy } = spyOnModal();
    await (modal as any).attachToExistingLobby(VALID_ID);

    const events = joinLobbyEvents(dispatchSpy);
    expect(events).toHaveLength(1);
    expect((events[0] as CustomEvent).detail).toMatchObject({
      gameID: VALID_ID,
      source: "host",
    });
  });

  it("skips the join-lobby dispatch when already connected", async () => {
    const { modal, dispatchSpy } = spyOnModal();

    await (modal as any).attachToExistingLobby(VALID_ID, true);

    expect(joinLobbyEvents(dispatchSpy)).toHaveLength(0);
    expect((modal as any).lobbyId).toBe(VALID_ID);
  });

  it("rejects an invalid game id", async () => {
    const modal = makeModal();
    await expect(
      (modal as any).attachToExistingLobby("not-valid"),
    ).rejects.toThrow();
  });
});
