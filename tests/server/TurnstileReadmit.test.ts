import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cid,
  makeClient as harnessClient,
  makeGame,
  makeMockWs,
  MockWs,
} from "../util/GameServerHarness";

const C1 = cid("c1");

function makeClient(clientID: string, persistentID: string, ws: MockWs) {
  return harnessClient({ clientID, persistentID, username: "TestUser", ws });
}

describe("GameServer - wasAdmitted (Turnstile re-admission)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("reports unknown players as not admitted", () => {
    const game = makeGame();
    expect(game.wasAdmitted("nobody")).toBe(false);
  });

  it("marks a player admitted after a successful join", () => {
    const game = makeGame();
    expect(game.joinClient(makeClient(C1, "p1", makeMockWs()))).toBe("joined");
    expect(game.wasAdmitted("p1")).toBe(true);
  });

  // Core regression: a lobby-phase disconnect clears the reconnect mapping (to
  // free the slot), but admission must survive so the reconnect skips the
  // single-use Turnstile re-check instead of failing on the spent token.
  it("keeps a player admitted after a lobby-phase disconnect clears their reconnect mapping", async () => {
    const game = makeGame();
    const ws = makeMockWs();
    expect(game.joinClient(makeClient(C1, "p1", ws))).toBe("joined");
    expect(game.getClientIdForPersistentId("p1")).toBe(C1);
    expect(game.wasAdmitted("p1")).toBe(true);

    // Socket drops before the game starts -> the close handler clears the
    // persistentID->clientID mapping.
    await ws.trigger("close");

    expect(game.getClientIdForPersistentId("p1")).toBeNull();
    expect(game.wasAdmitted("p1")).toBe(true);
  });

  it("does not treat a kicked player as admitted (kick still forces the gate)", () => {
    const game = makeGame();
    expect(game.joinClient(makeClient(C1, "p1", makeMockWs()))).toBe("joined");
    expect(game.wasAdmitted("p1")).toBe(true);

    game.kickClient(C1);
    expect(game.wasAdmitted("p1")).toBe(false);
  });

  // storedIdentity feeds the join path's identityUnchanged check: a stored
  // pair lets an unchanged reconnect skip join_verify, while null (record
  // gone) must force a re-screen.
  it("storedIdentity returns the screened pair for a joined player", () => {
    const game = makeGame();
    expect(game.joinClient(makeClient(C1, "p1", makeMockWs()))).toBe("joined");
    expect(game.storedIdentity("p1")).toEqual({
      username: "TestUser",
      clanTag: null,
    });
    expect(game.storedIdentity("nobody")).toBeNull();
  });

  it("storedIdentity returns null once a lobby-phase disconnect clears the mapping", async () => {
    const game = makeGame();
    const ws = makeMockWs();
    expect(game.joinClient(makeClient(C1, "p1", ws))).toBe("joined");

    await ws.trigger("close");

    // Still admitted (no Turnstile re-check), but with no stored identity
    // the reconnect must be re-screened rather than skipped.
    expect(game.wasAdmitted("p1")).toBe(true);
    expect(game.storedIdentity("p1")).toBeNull();
  });
});
