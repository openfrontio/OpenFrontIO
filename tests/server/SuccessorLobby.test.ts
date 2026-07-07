import { describe, expect, it, vi } from "vitest";
import type { GameServer } from "../../src/server/GameServer";
import { wireSuccessorLobby } from "../../src/server/SuccessorLobby";

// A GameServer is only used here as the carrier of createSuccessorLobby, so a
// bare object with that field stands in for one.
function fakeGame(): GameServer {
  return { createSuccessorLobby: undefined } as unknown as GameServer;
}

describe("wireSuccessorLobby", () => {
  it("mints a successor lobby for the same creator", () => {
    const created: Array<{ id: string; creator: string }> = [];
    const game = fakeGame();
    wireSuccessorLobby(game, "creator-pid", {
      mintId: () => "AAAA0001",
      createGame: (id, creator) => {
        created.push({ id, creator });
        return fakeGame();
      },
    });

    const id = game.createSuccessorLobby!();

    expect(id).toBe("AAAA0001");
    expect(created).toEqual([{ id: "AAAA0001", creator: "creator-pid" }]);
  });

  it("chains: each successor can itself spawn a successor (same creator)", () => {
    const games: Array<{ id: string; creator: string; game: GameServer }> = [];
    let n = 0;
    const deps = {
      mintId: () => `AAAA000${++n}`,
      createGame: (id: string, creator: string) => {
        const g = fakeGame();
        games.push({ id, creator, game: g });
        return g;
      },
    };
    const root = fakeGame();
    wireSuccessorLobby(root, "creator-pid", deps);

    // Generation 1
    const id1 = root.createSuccessorLobby!();
    const successor1 = games[0].game;
    expect(id1).toBe("AAAA0001");
    expect(typeof successor1.createSuccessorLobby).toBe("function");

    // Generation 2 — the bug: this factory used to be missing, so the second
    // "New lobby" click did nothing.
    const id2 = successor1.createSuccessorLobby!();
    const successor2 = games[1].game;
    expect(id2).toBe("AAAA0002");
    expect(typeof successor2.createSuccessorLobby).toBe("function");

    // Generation 3, to confirm it keeps chaining.
    const id3 = successor2.createSuccessorLobby!();
    expect(id3).toBe("AAAA0003");

    expect(games.map((g) => g.creator)).toEqual([
      "creator-pid",
      "creator-pid",
      "creator-pid",
    ]);
  });

  it("returns null and creates nothing when id minting fails", () => {
    const createGame = vi.fn();
    const game = fakeGame();
    wireSuccessorLobby(game, "c", { mintId: () => null, createGame });

    expect(game.createSuccessorLobby!()).toBeNull();
    expect(createGame).not.toHaveBeenCalled();
  });

  it("returns null when game creation fails (e.g. an id collision)", () => {
    const game = fakeGame();
    wireSuccessorLobby(game, "c", {
      mintId: () => "AAAA0001",
      createGame: () => null,
    });

    expect(game.createSuccessorLobby!()).toBeNull();
  });
});
