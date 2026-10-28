import {
  GameMode,
  GameType,
  PlayerType,
  RankedType,
} from "@openfront/engine-api/game/GameTypes";
import type { GameConfig } from "@openfront/engine-api/Schemas";
import { describe, expect, it } from "vitest";
import {
  ffaRatingGameOf,
  viewerHasFfaRating,
} from "../../src/client/components/ffaRating/FfaRatingEligibility";

const game = (
  cfg: Partial<GameConfig>,
  opts: {
    replay?: boolean;
    me?: boolean;
    spawned?: boolean;
    humans?: number;
  } = {},
) =>
  ({
    gameID: () => "g1",
    config: () => ({
      gameConfig: () => ({
        gameType: GameType.Public,
        gameMode: GameMode.FFA,
        rankedType: undefined,
        ...cfg,
      }),
      isReplay: () => opts.replay ?? false,
    }),
    myPlayer: () =>
      (opts.me ?? true) ? { hasSpawned: () => opts.spawned ?? true } : null,
    players: () => [
      ...Array.from({ length: opts.humans ?? 12 }, () => ({
        type: () => PlayerType.Human,
        hasSpawned: () => true,
      })),
      { type: () => PlayerType.Human, hasSpawned: () => false },
      { type: () => PlayerType.Bot, hasSpawned: () => true },
    ],
  }) as never;

describe("ffaRatingGameOf", () => {
  it("counts spawned humans in a public unranked FFA game", () => {
    expect(ffaRatingGameOf(game({}), "ffa")).toEqual({
      gameId: "g1",
      lobbyHumans: 12,
    });
  });

  it.each([
    ["a private game", game({ gameType: GameType.Private })],
    ["singleplayer", game({ gameType: GameType.Singleplayer })],
    ["a team game", game({ gameMode: GameMode.Team })],
    ["an old ranked FFA game", game({ rankedType: RankedType.FreeForAll })],
    ["a replay", game({}, { replay: true })],
    ["a spectator", game({}, { me: false })],
    ["a viewer who never spawned", game({}, { spawned: false })],
  ])("has no rating for %s", (_, g) => {
    expect(ffaRatingGameOf(g, "ffa")).toBeNull();
  });

  // Only the plain FFA slot is rated. A tab that never saw the lobby (a
  // refresh mid-game) can't tell, so it shows nothing rather than poll a game
  // that may never be rated.
  it.each(["special", "team", "hosted", undefined] as const)(
    "has no rating when the lobby slot is %s",
    (slot) => {
      expect(ffaRatingGameOf(game({}), slot)).toBeNull();
    },
  );
});

describe("viewerHasFfaRating", () => {
  it.each([
    ["trusted", { tier: "Gold I", elo: 1600 }, true],
    ["trusted", { games: 3, wins: 0, calibrationGames: 3 }, true],
    // API not live: frozen Elo only.
    ["trusted", { elo: 1234 }, false],
    // Trust gates only the public listing: an untrusted account is rated.
    ["untrusted", { tier: "Gold I", elo: 1600 }, true],
    [null, { calibrationGames: 3 }, true],
    ["untrusted", { elo: 1234 }, false],
  ] as const)("viewer %s with %j → %s", (trustTier, ffa, expected) => {
    expect(
      viewerHasFfaRating({
        player: { trustTier, leaderboard: { ffa } },
      } as never),
    ).toBe(expected);
  });

  it("is false without a leaderboard entry", () => {
    expect(
      viewerHasFfaRating({ player: { trustTier: "trusted" } } as never),
    ).toBe(false);
  });
});
