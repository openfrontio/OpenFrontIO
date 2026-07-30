import { WinCheckExecution } from "../src/core/execution/WinCheckExecution";
import {
  Game,
  GameMode,
  PlayerInfo,
  PlayerType,
  RankedType,
} from "../src/core/game/Game";
import { GameUpdateType, WinUpdate } from "../src/core/game/GameUpdates";
import { GameConfig } from "../src/core/Schemas";
import { setup } from "./util/Setup";

async function setupTeamGame(config: Partial<GameConfig>): Promise<Game> {
  const players = [1, 2, 3, 4].map(
    (n) =>
      new PlayerInfo(`player${n}`, PlayerType.Human, `client${n}`, `p${n}_id`),
  );
  return setup(
    "plains",
    {
      gameMode: GameMode.Team,
      playerTeams: 2,
      maxPlayers: 4,
      ...config,
    },
    players,
  );
}

function spawnPlayers(game: Game, count: number) {
  for (let n = 1; n <= count; n++) {
    const player = game.player(`p${n}_id`);
    player.setSpawnTile(game.map().ref(n, n));
  }
}

// The check fires on the first WinCheckExecution tick after the spawn phase
// (ticks divisible by 10), so 11 ticks is always enough to reach it.
function collectWinUpdates(game: Game): WinUpdate[] {
  game.addExecution(new WinCheckExecution());
  const wins: WinUpdate[] = [];
  for (let i = 0; i < 11; i++) {
    wins.push(...game.executeNextTick()[GameUpdateType.Win]);
  }
  return wins;
}

describe("Ranked 2v2 cancellation", () => {
  it("ends the game with no winner when only 3 of 4 players spawned", async () => {
    const game = await setupTeamGame({ rankedType: RankedType.TwoVTwo });
    spawnPlayers(game, 3);

    const wins = collectWinUpdates(game);

    expect(wins).toHaveLength(1);
    expect(wins[0].winner).toBeUndefined();
    expect(game.getWinner()).toBeNull();
  });

  it("ends the game with no winner when a player never joined", async () => {
    // Only 3 players are in the game at all (the 4th never connected, so it
    // isn't in the start info), even though all present players spawned.
    const players = [1, 2, 3].map(
      (n) =>
        new PlayerInfo(
          `player${n}`,
          PlayerType.Human,
          `client${n}`,
          `p${n}_id`,
        ),
    );
    const game = await setup(
      "plains",
      {
        gameMode: GameMode.Team,
        playerTeams: 2,
        maxPlayers: 4,
        rankedType: RankedType.TwoVTwo,
      },
      players,
    );
    spawnPlayers(game, 3);

    const wins = collectWinUpdates(game);

    expect(wins).toHaveLength(1);
    expect(wins[0].winner).toBeUndefined();
  });

  it("does not cancel when all 4 players spawned", async () => {
    const game = await setupTeamGame({ rankedType: RankedType.TwoVTwo });
    spawnPlayers(game, 4);

    expect(collectWinUpdates(game)).toHaveLength(0);
  });

  it("does not cancel unranked team games that are short a player", async () => {
    const game = await setupTeamGame({});
    spawnPlayers(game, 3);

    expect(collectWinUpdates(game)).toHaveLength(0);
  });
});
