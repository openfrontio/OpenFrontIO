import { describe, expect, it } from "vitest";
import {
  lobbyLevelBadge,
  rememberLobbyRoster,
} from "../../src/client/LobbyRosterLevels";

const VET = { level: 100, prestige: 10, legend: true };

describe("lobbyLevelBadge", () => {
  it("returns the badge from the last roster of that game", () => {
    rememberLobbyRoster("game0001", [
      {
        clientID: "vet00001",
        username: "Veteran",
        clanTag: null,
        levelBadge: VET,
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
        levelBadge: VET,
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
        levelBadge: VET,
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
