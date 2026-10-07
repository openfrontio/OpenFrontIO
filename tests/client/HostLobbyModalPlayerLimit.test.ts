import { describe, expect, it, vi } from "vitest";

// The desktop bridge is absent in jsdom; mock it like HostLobbyModal.test.ts.
vi.mock("../../src/client/DesktopPresence", () => ({
  desktopPresence: {
    isAvailable: vi.fn(() => false),
    openInviteDialog: vi.fn(async () => true),
    set: vi.fn(),
    consumePendingInvite: vi.fn(async () => null),
    subscribeInvites: vi.fn(() => () => undefined),
  },
}));

import { HostLobbyModal } from "../../src/client/HostLobbyModal";
import { LobbyInfoEvent } from "../../src/core/Schemas";

const LOBBY = "ABCD1234";

function lobbyInfo(maxPlayers: number | undefined, gameID = LOBBY) {
  return new LobbyInfoEvent(
    { gameID, clients: [], gameConfig: { maxPlayers } } as any,
    "host",
  );
}

// A host returning to an existing lobby (?host) must see its current player
// limit; otherwise the next settings change would send maxPlayers: null and
// clear it.
describe("HostLobbyModal player limit from lobby info", () => {
  it("loads the lobby's cap from its first lobby info", () => {
    const modal = new HostLobbyModal() as any;
    modal.lobbyId = LOBBY;
    modal.handleLobbyInfo(lobbyInfo(30));
    expect(modal.playerLimit).toBe(true);
    expect(modal.playerLimitValue).toBe(30);
  });

  it("does not overwrite the host's edits on later lobby info", () => {
    const modal = new HostLobbyModal() as any;
    modal.lobbyId = LOBBY;
    modal.handleLobbyInfo(lobbyInfo(30));
    // The host types a new value; a broadcast still carrying the old cap
    // must not snap the field back.
    modal.playerLimitValue = 40;
    modal.handleLobbyInfo(lobbyInfo(30));
    expect(modal.playerLimitValue).toBe(40);
  });

  it("keeps an edit the host made before the first lobby info", () => {
    // That broadcast can still carry the old cap; adopting it would make the
    // next settings change send the old cap back.
    const modal = new HostLobbyModal() as any;
    modal.lobbyId = LOBBY;
    modal.putGameConfig = vi.fn();
    modal.handlePlayerLimitToggle(true, 40);
    modal.handleLobbyInfo(lobbyInfo(30));
    expect(modal.playerLimit).toBe(true);
    expect(modal.playerLimitValue).toBe(40);
  });

  it("keeps the host switching the limit off before the first lobby info", () => {
    const modal = new HostLobbyModal() as any;
    modal.lobbyId = LOBBY;
    modal.putGameConfig = vi.fn();
    modal.handlePlayerLimitToggle(false, undefined);
    modal.handleLobbyInfo(lobbyInfo(30));
    expect(modal.playerLimit).toBe(false);
  });

  it("leaves the card alone for a lobby without a cap", () => {
    const modal = new HostLobbyModal() as any;
    modal.lobbyId = LOBBY;
    // e.g. the host switched the limit on before the first broadcast landed.
    modal.playerLimit = true;
    modal.playerLimitValue = 20;
    modal.handleLobbyInfo(lobbyInfo(undefined));
    expect(modal.playerLimit).toBe(true);
    expect(modal.playerLimitValue).toBe(20);
  });

  describe("the maxPlayers it sends", () => {
    async function sent(modal: any): Promise<unknown> {
      modal.constructUrl = vi.fn(async () => "http://localhost/");
      modal.updateLobbyHistory = vi.fn();
      let config: any;
      modal.addEventListener("update-game-config", (e: CustomEvent) => {
        config = e.detail.config;
      });
      await modal.putGameConfig();
      return "maxPlayers" in config ? config.maxPlayers : "omitted";
    }

    it("leaves the cap alone before the lobby's cap has loaded", async () => {
      // A returning host who edits a setting before the first broadcast
      // must not clear the lobby's existing cap.
      const modal = new HostLobbyModal() as any;
      modal.lobbyId = LOBBY;
      expect(await sent(modal)).toBeUndefined();
    });

    it("sends the host's limit even before the cap has loaded", async () => {
      const modal = new HostLobbyModal() as any;
      modal.lobbyId = LOBBY;
      modal.playerLimit = true;
      modal.playerLimitValue = 12;
      expect(await sent(modal)).toBe(12);
    });

    it("sends null to lift the cap once it has loaded", async () => {
      const modal = new HostLobbyModal() as any;
      modal.lobbyId = LOBBY;
      modal.handleLobbyInfo(lobbyInfo(30));
      modal.playerLimit = false;
      expect(await sent(modal)).toBeNull();
    });
  });

  it("ignores lobby info for another lobby", () => {
    const modal = new HostLobbyModal() as any;
    modal.lobbyId = LOBBY;
    modal.handleLobbyInfo(lobbyInfo(30, "OTHER999"));
    expect(modal.playerLimit).toBe(false);
  });
});

// The listing dialog's minimum cap is one above the seated players; spectators
// take no seat (the server's listing check doesn't count them either).
describe("HostLobbyModal seated player count", () => {
  it("leaves spectators out", () => {
    const modal = new HostLobbyModal() as any;
    modal.clients = [
      { clientID: "a", username: "a" },
      { clientID: "b", username: "b", spectator: false },
      { clientID: "c", username: "c", spectator: true },
    ];
    expect(modal.seatedPlayerCount()).toBe(2);
  });
});
