import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloseCode, CloseReason } from "../../src/core/CloseCodes";
import { GameManager } from "../../src/server/GameManager";
import { rejoinOrClose } from "../../src/server/Rejoin";
import {
  cid,
  makeClient,
  makeMockWs,
  mockLogger,
} from "../util/GameServerHarness";

// A rejoin the worker cannot place is routine (mostly a tab rejoining after
// its game ended), so it must not log at warn: at warn it was a quarter of
// prod game-server warn volume and read as a rising fault.
describe("rejoinOrClose", () => {
  let log: any;
  let gm: GameManager;

  beforeEach(() => {
    vi.useFakeTimers();
    log = mockLogger();
    gm = new GameManager(log);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("closes with GameNotFound and logs at info when the game is gone", () => {
    const ws = makeMockWs();
    rejoinOrClose(gm, log, 3, ws as any, "p1-pid", cid("gone"), 0);

    expect(ws.close).toHaveBeenCalledWith(
      CloseCode.GameNotFound,
      CloseReason.GameNotFound,
    );
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith(
      `game ${cid("gone")} not found on worker 3`,
      { gameID: cid("gone") },
    );
  });

  it("reports an ended game not yet pruned as not found", async () => {
    const gameID = cid("ended");
    const game = gm.createGame(gameID, undefined)!;
    game.joinClient(
      makeClient({ clientID: cid("p1"), persistentID: "p1-pid" }),
    );
    await game.end();
    const ws = makeMockWs();
    rejoinOrClose(gm, log, 3, ws as any, "p1-pid", gameID, 0);

    expect(ws.close).toHaveBeenCalledWith(
      CloseCode.GameNotFound,
      CloseReason.GameNotFound,
    );
    expect(log.info).toHaveBeenCalledWith(
      `game ${gameID} not found on worker 3`,
      { gameID },
    );
  });

  it("says the client is not in the game when the game exists", () => {
    const gameID = cid("live");
    gm.createGame(gameID, undefined);
    const ws = makeMockWs();
    rejoinOrClose(gm, log, 3, ws as any, "stranger-pid", gameID, 0);

    expect(ws.close).toHaveBeenCalledWith(
      CloseCode.GameNotFound,
      CloseReason.GameNotFound,
    );
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith(
      `rejoining client not in game ${gameID}`,
      { gameID },
    );
  });

  it("hands the socket over without closing it when the client is in the game", () => {
    const gameID = cid("live");
    const game = gm.createGame(gameID, undefined)!;
    game.joinClient(
      makeClient({ clientID: cid("p1"), persistentID: "p1-pid" }),
    );
    const ws = makeMockWs();
    rejoinOrClose(gm, log, 3, ws as any, "p1-pid", gameID, 0);

    expect(ws.close).not.toHaveBeenCalled();
    expect(log.info).not.toHaveBeenCalledWith(
      expect.stringContaining("not found on worker"),
      expect.anything(),
    );
  });
});
