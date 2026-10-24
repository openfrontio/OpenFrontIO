import { GameType } from "@openfront/engine-api/game/GameTypes";
import { describe, expect, it } from "vitest";
import {
  cid,
  makeClient,
  makeGame,
  mockWsOf,
} from "../util/GameServerHarness";

function startConfigOf(client: ReturnType<typeof makeClient>) {
  const start = mockWsOf(client)
    .sent()
    .find((m) => m.type === "start");
  expect(start).toBeDefined();
  expect(start!.type).toBe("start");
  return start!.gameStartInfo.config;
}

describe("GameServer - cheatPlayerIds (CHEAT_PLAYER_IDS)", () => {
  it("stamps a listed account's clientID into the start config of a public game", () => {
    const game = makeGame({
      config: { gameType: GameType.Public },
      deps: { cheatPlayerIDs: () => ["pid-cheat"] },
    });
    const cheater = makeClient({
      clientID: cid("cheater"),
      persistentID: "pid-cheat",
      username: "Cheater",
    });
    const other = makeClient({
      clientID: cid("other"),
      persistentID: "pid-other",
      username: "Other",
    });
    expect(game.joinClient(cheater)).toBe("joined");
    expect(game.joinClient(other)).toBe("joined");
    game.start();

    const expected = cid("cheater");
    // Every client sees the identical stamped config.
    expect(startConfigOf(cheater).cheatPlayerIds).toEqual([expected]);
    expect(startConfigOf(other).cheatPlayerIds).toEqual([expected]);
  });

  it("stamps nothing when the env list is unset or matches nobody", () => {
    const game = makeGame({
      deps: { cheatPlayerIDs: () => [] },
    });
    const c = makeClient({ persistentID: "pid-cheat" });
    expect(game.joinClient(c)).toBe("joined");
    game.start();
    expect(startConfigOf(c).cheatPlayerIds).toBeUndefined();

    const game2 = makeGame({
      deps: { cheatPlayerIDs: () => ["someone-else"] },
    });
    const c2 = makeClient({ persistentID: "pid-cheat" });
    expect(game2.joinClient(c2)).toBe("joined");
    game2.start();
    expect(startConfigOf(c2).cheatPlayerIds).toBeUndefined();
  });

  it("matches on persistentID, the stable account id from the join token", () => {
    const game = makeGame({
      deps: { cheatPlayerIDs: () => ["acct-uuid-1"] },
    });
    // Same account, fresh session: a new clientID every join, still matched.
    const sessionA = makeClient({
      clientID: cid("sessa"),
      persistentID: "acct-uuid-1",
    });
    expect(game.joinClient(sessionA)).toBe("joined");
    game.start();
    expect(startConfigOf(sessionA).cheatPlayerIds).toEqual([cid("sessa")]);
  });

  it("leaves the pre-start lobby config untouched (stamp happens at start)", () => {
    const game = makeGame({
      deps: { cheatPlayerIDs: () => ["pid-cheat"] },
    });
    expect(game.joinClient(makeClient({ persistentID: "pid-cheat" }))).toBe(
      "joined",
    );
    expect(game.gameConfig.cheatPlayerIds).toBeUndefined();
    game.start();
    expect(game.gameConfig.cheatPlayerIds).toBeUndefined();
  });

  it("does not stamp spectators (they never spawn)", () => {
    const game = makeGame({
      deps: { cheatPlayerIDs: () => ["pid-cheat"] },
    });
    const watcher = makeClient({
      clientID: cid("watcher"),
      persistentID: "pid-cheat",
      spectator: true,
    });
    expect(game.joinClient(watcher)).toBe("joined");
    game.start();
    expect(startConfigOf(watcher).cheatPlayerIds).toBeUndefined();
  });
});
