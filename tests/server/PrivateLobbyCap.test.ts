import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GameType } from "../../src/core/game/Game";
import { UpdateGameConfigIntentSchema } from "../../src/core/Schemas";
import { GamePhase } from "../../src/server/GameServer";
import {
  cid,
  makeClient as harnessClient,
  makeGame as harnessGame,
} from "../util/GameServerHarness";

// A host can cap how many people may play in their private lobby, so a
// streamer's listed lobby doesn't fill to 300. Spectators never take a seat.

const CREATOR = "11111111-1111-4111-8111-111111111111";

const asHost = {
  clientID: cid("host"),
  isLobbyCreator: true,
  isAdmin: false,
  isAdminBot: false,
};

function makeClient(id: string, spectator = false) {
  return harnessClient({
    clientID: cid(id),
    persistentID: `${id}-pid`,
    publicId: `${id}-pub`,
    spectator,
  });
}

function makeGame(maxPlayers?: number) {
  return harnessGame({
    config: { gameType: GameType.Private, maxPlayers },
    creatorPersistentID: CREATOR,
  });
}

function setCap(
  game: ReturnType<typeof makeGame>,
  maxPlayers: number | null,
): number {
  return game.handleIntent(
    { type: "update_game_config", config: { maxPlayers } },
    asHost,
  ).status;
}

describe("private lobby player cap", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("lets the host set a cap that turns away further players", () => {
    const game = makeGame();
    expect(setCap(game, 2)).toBe(200);
    expect(game.joinClient(makeClient("p1"))).toBe("joined");
    expect(game.joinClient(makeClient("p2"))).toBe("joined");
    expect(game.joinClient(makeClient("p3"))).toBe("rejected");
    // Spectators take no seat, so a full lobby is still watchable.
    expect(game.joinClient(makeClient("cast", true))).toBe("joined");
  });

  it("lets the host clear the cap with null", () => {
    const game = makeGame(1);
    expect(game.joinClient(makeClient("p1"))).toBe("joined");
    expect(game.joinClient(makeClient("p2"))).toBe("rejected");
    expect(setCap(game, null)).toBe(200);
    expect(game.joinClient(makeClient("p2"))).toBe("joined");
  });

  it("leaves the cap alone when the patch omits it", () => {
    const game = makeGame(1);
    game.handleIntent(
      { type: "update_game_config", config: { bots: 10 } },
      asHost,
    );
    expect(game.joinClient(makeClient("p1"))).toBe("joined");
    expect(game.joinClient(makeClient("p2"))).toBe("rejected");
  });

  it("keeps players already seated when the cap drops below them", () => {
    const game = makeGame();
    game.joinClient(makeClient("p1"));
    game.joinClient(makeClient("p2"));
    game.joinClient(makeClient("p3"));
    expect(setCap(game, 2)).toBe(200);
    expect(game.numClients()).toBe(3);
    expect(game.joinClient(makeClient("p4"))).toBe("rejected");
  });

  it("does not auto-start an unlisted host lobby when it fills", () => {
    // The host starts their own lobby; filling the limit is not a start
    // signal. (A listed lobby still starts when full, see HostedLobbyListing.)
    const game = makeGame(1);
    game.joinClient(makeClient("p1"));
    expect(game.phase()).toBe(GamePhase.Lobby);
  });

  it("rejects the host's limit once the lobby is listed", () => {
    // Listing picks its own cap (10-100, above the seated count); the host
    // can't then move it outside those checks through update_game_config.
    const game = makeGame();
    game.setListed(true, { maxPlayers: 20 });
    expect(setCap(game, 2)).toBe(409);
    expect(setCap(game, null)).toBe(409);
    expect(game.gameInfo().gameConfig?.maxPlayers).toBe(20);
  });

  it("still auto-starts a host-less lobby (admin bot, matchmaking) when full", () => {
    const game = harnessGame({
      config: { gameType: GameType.Private, maxPlayers: 1 },
    });
    game.joinClient(makeClient("p1"));
    expect(game.phase()).toBe(GamePhase.Active);
  });
});

describe("update_game_config maxPlayers schema", () => {
  const parse = (maxPlayers: unknown) =>
    UpdateGameConfigIntentSchema.safeParse({
      type: "update_game_config",
      config: { maxPlayers },
    }).success;

  it("accepts a cap, or null to clear it", () => {
    expect(parse(2)).toBe(true);
    expect(parse(150)).toBe(true);
    expect(parse(null)).toBe(true);
  });

  it("rejects a cap below 2", () => {
    expect(parse(0)).toBe(false);
    expect(parse(1)).toBe(false);
  });
});
