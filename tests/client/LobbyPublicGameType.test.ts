import { describe, expect, it } from "vitest";
import {
  lobbyPublicGameType,
  rememberLobbyPublicGameType,
} from "../../src/client/LobbyPublicGameType";

describe("lobbyPublicGameType", () => {
  it("returns the slot the lobby reported for that game", () => {
    rememberLobbyPublicGameType("g1", "ffa");
    expect(lobbyPublicGameType("g1")).toBe("ffa");
  });

  it("knows nothing about a game this tab never saw the lobby of", () => {
    rememberLobbyPublicGameType("g1", "special");
    expect(lobbyPublicGameType("g2")).toBeUndefined();
  });

  it("keeps the latest lobby's slot", () => {
    rememberLobbyPublicGameType("g1", "ffa");
    rememberLobbyPublicGameType("g2", "team");
    expect(lobbyPublicGameType("g1")).toBeUndefined();
    expect(lobbyPublicGameType("g2")).toBe("team");
  });

  it("forgets the slot when a private lobby reports none", () => {
    rememberLobbyPublicGameType("g1", "ffa");
    rememberLobbyPublicGameType("g1", undefined);
    expect(lobbyPublicGameType("g1")).toBeUndefined();
  });
});
