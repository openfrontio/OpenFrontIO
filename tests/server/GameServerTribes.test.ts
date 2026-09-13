import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GameType } from "../../src/core/game/Game";
import { createGameWireContext } from "../../src/core/ZbinWire";
import { Client } from "../../src/server/Client";
import { GameServer } from "../../src/server/GameServer";
import {
  makeGame as harnessGame,
  makeClient,
  mockLogger,
  mockWsOf,
} from "../util/GameServerHarness";

// The purchased-tribe lookup the game makes at prestart.
const fetchTribes = vi.fn<(...args: any[]) => Promise<{ name: string }[]>>();

// Lets the fetchTribes .then/.catch chain settle.
async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

// The start info start() built, read off the start frame `player` received.
function startInfo(game: GameServer, player: Client) {
  const ctx = createGameWireContext(
    (game.gameInfo().clients ?? []).map((c) => ({ clientID: c.clientID })),
  );
  const start = mockWsOf(player)
    .sent(ctx)
    .find((m) => m.type === "start");
  if (start?.type !== "start") throw new Error("no start frame");
  return start.gameStartInfo;
}

// A guest (no account, so never part of the tribe lookup) to read the start
// frame from.
function watcher(game: GameServer): Client {
  const client = makeClient();
  game.joinClient(client);
  return client;
}

describe("GameServer custom tribes", () => {
  let log: any;

  beforeEach(() => {
    fetchTribes.mockReset();
    vi.useFakeTimers();
    log = mockLogger();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

  function makeGame(config: Record<string, unknown> = {}) {
    return harnessGame({
      log,
      config: { gameType: GameType.Public, bots: 400, ...config },
      deps: { fetchTribes },
    });
  }

  it("fetches the pool at prestart and embeds the tribes in the start info", async () => {
    fetchTribes.mockResolvedValue([
      { name: "Dragon Riders" },
      { name: "Night Wolves" },
    ]);
    const game = makeGame();
    const player = makeClient({ clientID: "abcd1234", publicId: "pub-1" });
    game.joinClient(player);
    // guest — no account, must be omitted
    game.joinClient(makeClient({ clientID: "efgh5678" }));

    game.prestart();
    await flushMicrotasks();
    game.start();

    expect(fetchTribes).toHaveBeenCalledWith([
      { clientId: "abcd1234", publicId: "pub-1" },
    ]);
    expect(startInfo(game, player).tribes).toEqual([
      { name: "Dragon Riders" },
      { name: "Night Wolves" },
    ]);
  });

  it("drops tribes from the tail when there are fewer bots", async () => {
    fetchTribes.mockResolvedValue([
      { name: "Dragon Riders" },
      { name: "Night Wolves" },
    ]);
    const game = makeGame({ bots: 1 });
    const guest = watcher(game);

    game.prestart();
    await flushMicrotasks();
    game.start();

    expect(startInfo(game, guest).tribes).toEqual([{ name: "Dragon Riders" }]);
  });

  it("skips the fetch for non-public games", async () => {
    const game = makeGame({ gameType: GameType.Private });
    const guest = watcher(game);

    game.prestart();
    await flushMicrotasks();
    game.start();

    expect(fetchTribes).not.toHaveBeenCalled();
    expect(startInfo(game, guest).tribes).toBeUndefined();
  });

  it("skips the fetch when bots are disabled", async () => {
    const game = makeGame({ bots: 0 });

    game.prestart();
    await flushMicrotasks();

    expect(fetchTribes).not.toHaveBeenCalled();
  });

  it("starts without tribes when the fetch fails", async () => {
    fetchTribes.mockRejectedValue(new Error("timeout"));
    const game = makeGame();
    const guest = watcher(game);

    game.prestart();
    await flushMicrotasks();
    game.start();

    expect(startInfo(game, guest).tribes).toBeUndefined();
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining("failed to fetch custom tribes"),
    );
  });

  it("omits tribes from the start info when the pool is empty", async () => {
    fetchTribes.mockResolvedValue([]);
    const game = makeGame();
    const guest = watcher(game);

    game.prestart();
    await flushMicrotasks();
    game.start();

    expect(startInfo(game, guest).tribes).toBeUndefined();
  });
});
