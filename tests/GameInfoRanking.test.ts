import {
  Ranking,
  RankType,
} from "../src/client/components/baseComponents/ranking/GameInfoRanking";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
} from "../src/core/game/Game";
import { AnalyticsRecord } from "../src/core/Schemas";
import {
  GOLD_INDEX_STEAL,
  GOLD_INDEX_TRADE,
  GOLD_INDEX_WAR,
} from "../src/core/StatsSchemas";

describe("Ranking class", () => {
  const mockConfig = {
    gameMap: GameMapType.Montreal,
    difficulty: Difficulty.Medium,
    donateGold: false,
    donateTroops: false,
    gameType: GameType.Public,
    gameMode: GameMode.FFA,
    gameMapSize: GameMapSize.Normal,
    disableNations: true,
    bots: 0,
    infiniteGold: false,
    infiniteTroops: false,
    instantBuild: false,
    maxPlayers: 40,
    disabledUnits: [],
    randomSpawn: false,
  };

  const gameTickDuration = 1000;
  const gameDuration = gameTickDuration / 10;

  function makeSession(
    overrides: Partial<AnalyticsRecord> = {},
  ): AnalyticsRecord {
    return {
      version: "v0.0.2",
      info: {
        duration: gameTickDuration,
        winner: ["player", "p2"],
        players: [
          {
            clientID: "p1",
            username: "[X] Alice",
            clanTag: "X",
            cosmetics: { flag: "USA" },
            stats: {
              units: { port: [2n, 0n, 0n, 2n] },
              conquests: 5n,
              gold: [0n, 100n, 20n, 0n], // total 120
              bombs: {
                abomb: [1n],
                hbomb: [1n],
                mirv: [2n],
              },
            },
            persistentID: null,
          },
          {
            clientID: "p2",
            username: "Bob",
            stats: {
              units: { city: [2n, 0n, 0n, 2n] },
              conquests: 8n,
              gold: [0n, 50n, 10n, 5n], // total 65
              bombs: {
                abomb: [0n],
                hbomb: [2n],
                mirv: [0n],
              },
            },
            persistentID: null,
          },
          {
            clientID: "p3",
            username: "Charlie",
            stats: {
              // no units, but has conquests/killedAt to count as played
              conquests: 8n,
              killedAt: BigInt(600),
              gold: [0n, 10n, 2n, 10n], //  total 22
              bombs: {},
            },
            persistentID: null,
          },
        ],
        gameID: "",
        lobbyCreatedAt: 0,
        config: { ...mockConfig },
        start: 0,
        end: 0,
        num_turns: 0,
        lobbyFillTime: 0,
      },
      gitCommit: "DEV",
      subdomain: "",
      domain: "",
    };
  }

  test("summarizes players correctly", () => {
    const r = new Ranking(makeSession());
    const players = r.sortedBy(RankType.Conquests);

    expect(players.length).toBe(3);

    const p1 = players.find((p) => p.id === "p1")!;
    expect(p1.username).toBe("Alice");
    expect(p1.flag).toBe("USA");
    expect(p1.conquests).toBe(5);
    expect(p1.atoms).toBe(1);
    expect(p1.mirv).toBe(2);
  });

  test("correctly identifies winner", () => {
    const r = new Ranking(makeSession());
    const p2 = r.sortedBy(RankType.Conquests).find((p) => p.id === "p2")!;
    expect(p2.winner).toBe(true);
  });

  test("rank by total gold", () => {
    const r = new Ranking(makeSession());
    const rankedPlayers = r.sortedBy(RankType.TotalGold);
    expect(rankedPlayers.length).toBe(3);
    expect(rankedPlayers[0].id).toBe("p1");
    expect(rankedPlayers[1].id).toBe("p2");
    expect(rankedPlayers[2].id).toBe("p3");
  });

  test("rank by stolen gold", () => {
    const r = new Ranking(makeSession());
    const rankedPlayers = r.sortedBy(RankType.StolenGold);
    expect(rankedPlayers.length).toBe(3);
    expect(rankedPlayers[0].id).toBe("p3");
    expect(rankedPlayers[1].id).toBe("p2");
    expect(rankedPlayers[2].id).toBe("p1");
  });

  test("rank by hydros", () => {
    const r = new Ranking(makeSession());
    const rankedPlayers = r.sortedBy(RankType.Hydros);
    expect(rankedPlayers.length).toBe(3);
    expect(rankedPlayers[0].id).toBe("p2");
    expect(rankedPlayers[1].id).toBe("p1");
    expect(rankedPlayers[2].id).toBe("p3");
  });

  test("lifetime score is percentage of duration", () => {
    const r = new Ranking(makeSession());
    const p3 = r.sortedBy(RankType.Conquests).find((p) => p.id === "p3")!;
    const expected = Number(BigInt(600)) / gameDuration;
    expect(r.score(p3, RankType.Lifetime)).toBe(expected);
  });

  test("lifetime score gives 100 when alive", () => {
    const r = new Ranking(makeSession());
    const p1 = r.allPlayers.find((p) => p.id === "p1")!;
    expect(r.score(p1, RankType.Lifetime)).toBe(100);
  });

  test("winners should be ahead of players with same score", () => {
    const r = new Ranking(makeSession());
    const sortedPlayers = r.sortedBy(RankType.Conquests);
    expect(sortedPlayers[0].id).toBe("p2"); // p2 & p3 same score but winner first
  });

  test("gold scores work correctly", () => {
    const r = new Ranking(makeSession());
    const p1 = r.sortedBy(RankType.TotalGold).find((p) => p.id === "p1")!;
    expect(r.score(p1, RankType.StolenGold)).toBe(
      Number(p1.gold[GOLD_INDEX_STEAL] ?? 0n),
    );
    expect(r.score(p1, RankType.TradedGold)).toBe(
      Number(p1.gold[GOLD_INDEX_TRADE] ?? 0n),
    );
    expect(r.score(p1, RankType.ConqueredGold)).toBe(
      Number(p1.gold[GOLD_INDEX_WAR] ?? 0n),
    );
  });
});
