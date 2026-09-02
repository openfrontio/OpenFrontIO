import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGameWireContext } from "../../src/core/ZbinWire";
import {
  cid,
  makeGame as harnessGame,
  makeClient,
  mockWsOf,
  startGame,
} from "../util/GameServerHarness";

// Pins are otherwise fixed at create, which makes them useless for a lobby that
// fills over time: every late joiner is left to the balancer, and in a team game
// that splits partners onto opposing sides.
describe("GameServer.addMatchmakingPin", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

  const makeGame = (teams?: string[][]) =>
    harnessGame({
      creatorPersistentID: "creator-pid",
      matchmakingTeams: teams,
    });

  it("adds the player to the requested team", () => {
    const game = makeGame([["a"], ["b"]]);
    const result = game.addMatchmakingPin("c", 1);
    expect(result).toEqual({ ok: true, teams: [["a"], ["b", "c"]] });
  });

  it("is idempotent — re-pinning to the same team succeeds without duplicating", () => {
    // A caller retrying after a dropped response has to converge, not fail.
    const game = makeGame([["a"], ["b"]]);
    game.addMatchmakingPin("c", 1);
    const again = game.addMatchmakingPin("c", 1);
    expect(again).toEqual({ ok: true, teams: [["a"], ["b", "c"]] });
  });

  it("refuses to move a player already pinned elsewhere", () => {
    // Silently moving them would contradict a team the caller already acted on.
    const game = makeGame([["a"], ["b"]]);
    const result = game.addMatchmakingPin("a", 1);
    expect(result).toMatchObject({ ok: false, status: 409 });
    expect((result as any).error).toBe("player_already_pinned");
  });

  it("refuses a team index outside the list", () => {
    const game = makeGame([["a"], ["b"]]);
    expect(game.addMatchmakingPin("c", 2)).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(game.addMatchmakingPin("c", -1)).toMatchObject({
      ok: false,
      status: 400,
    });
  });

  it("refuses once the game has started", () => {
    // The teams are already stamped into gameStartInfo and every client has
    // them, so a late write would report success for work that did nothing.
    const game = makeGame([["a"], ["b"]]);
    startGame(game);
    expect(game.addMatchmakingPin("c", 1)).toMatchObject({
      ok: false,
      status: 409,
    });
  });

  it("refuses when the game was never matchmade", () => {
    expect(makeGame().addMatchmakingPin("c", 0)).toMatchObject({
      ok: false,
      status: 400,
    });
  });

  it("seats a player pinned after the lobby was made on that team at start", () => {
    // The point of the whole change: the team lookup resolves live, so an
    // amendment before start is picked up with nothing else recomputed.
    const game = makeGame([["a"], ["b"]]);
    game.addMatchmakingPin("c", 1);
    const late = makeClient({ clientID: cid("late"), publicId: "c" });
    game.joinClient(late);
    startGame(game);

    const ctx = createGameWireContext([{ clientID: cid("late") }]);
    const start = mockWsOf(late)
      .sent(ctx)
      .find((m) => m.type === "start");
    if (start?.type !== "start") throw new Error("no start frame");
    expect(start.gameStartInfo.players[0]).toMatchObject({
      clientID: cid("late"),
      teamIndex: 1,
    });
  });
});
