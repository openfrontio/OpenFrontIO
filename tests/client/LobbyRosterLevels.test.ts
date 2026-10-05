import { describe, expect, it } from "vitest";
import {
  lobbyLevelBadge,
  rememberLobbyRoster,
} from "../../src/client/LobbyRosterLevels";
import { packLevelBadge } from "../../src/core/LevelBadgeWire";

const VET = { level: 100, prestige: 10, legend: true };
// As the roster carries it.
const VET_WIRE = packLevelBadge(VET)!;

describe("lobbyLevelBadge", () => {
  it("returns the badge from the last roster of that game", () => {
    rememberLobbyRoster("game0001", [
      {
        clientID: "vet00001",
        username: "Veteran",
        clanTag: null,
        levelBadge: VET_WIRE,
      },
      { clientID: "guest001", username: "Guest", clanTag: null },
    ]);
    expect(lobbyLevelBadge("game0001", "vet00001")).toEqual(VET);
    expect(lobbyLevelBadge("game0001", "guest001")).toBeUndefined();
    expect(lobbyLevelBadge("game0001", "nobody01")).toBeUndefined();
    expect(lobbyLevelBadge("game0001", null)).toBeUndefined();
  });

  it("never answers for a different game", () => {
    rememberLobbyRoster("game0001", [
      {
        clientID: "vet00001",
        username: "Veteran",
        clanTag: null,
        levelBadge: VET_WIRE,
      },
    ]);
    expect(lobbyLevelBadge("game0002", "vet00001")).toBeUndefined();
  });

  it("each broadcast replaces the last: a badge dropped by the server goes", () => {
    // e.g. the host turns anonymizeNames on mid-lobby.
    rememberLobbyRoster("game0001", [
      {
        clientID: "vet00001",
        username: "Veteran",
        clanTag: null,
        levelBadge: VET_WIRE,
      },
    ]);
    rememberLobbyRoster("game0001", [
      { clientID: "vet00001", username: "Quiet Otter", clanTag: null },
    ]);
    expect(lobbyLevelBadge("game0001", "vet00001")).toBeUndefined();
  });

  it("tolerates a roster with no clients", () => {
    rememberLobbyRoster("game0003", undefined);
    expect(lobbyLevelBadge("game0003", "vet00001")).toBeUndefined();
  });
});

describe("lobbyLevelBadge decodes the packed roster value", () => {
  it.each([
    { level: 1, prestige: 0, legend: false },
    { level: 57, prestige: 3, legend: false },
    { level: 100, prestige: 10, legend: false },
    { level: 100, prestige: 10, legend: true },
  ])("back to %o", (badge) => {
    rememberLobbyRoster("game0004", [
      {
        clientID: "pl000001",
        username: "Player",
        clanTag: null,
        levelBadge: packLevelBadge(badge),
      },
    ]);
    expect(lobbyLevelBadge("game0004", "pl000001")).toEqual(badge);
  });

  it("reads a value no server sends as no badge, without throwing", () => {
    const clients = [0, 101, 11 * 128 + 5, 4096 + 5, -1, 1.5].map((v, i) => ({
      clientID: `bad0000${i}`,
      username: "Odd",
      clanTag: null,
      levelBadge: v,
    }));
    rememberLobbyRoster("game0005", clients);
    for (const c of clients) {
      expect(lobbyLevelBadge("game0005", c.clientID)).toBeUndefined();
    }
  });
});
