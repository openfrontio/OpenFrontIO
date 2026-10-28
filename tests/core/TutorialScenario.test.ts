import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { GameConfig, StampedIntent } from "@openfront/engine-api/Schemas";
import { Game, Player } from "@openfront/engine/game/Game";
import { createGameRunner } from "@openfront/engine/GameRunner";
import { loadMapFiles } from "@openfront/shared/GameMapLoader";
import { describe, expect, test } from "vitest";
import { mapLoader } from "../client/replay/util/ArchiveGame";

const CLIENT = "client001";

const tutorialConfig: GameConfig = {
  gameMap: GameMapType.Tutorial,
  gameMapSize: GameMapSize.Normal,
  gameMode: GameMode.FFA,
  gameType: GameType.Singleplayer,
  difficulty: Difficulty.Easy,
  nations: "default",
  bots: 1,
  donateGold: false,
  donateTroops: false,
  infiniteGold: false,
  infiniteTroops: false,
  instantBuild: false,
  randomSpawn: false,
  disabledUnits: [],
  tutorial: true,
};

/**
 * Runs the tutorial map through the real GameRunner. `intents` is asked for
 * each turn's intents; `onTick` sees the game after every tick and returns
 * true to stop early.
 */
async function playTutorial(
  ticks: number,
  intents: (game: Game, tick: number) => StampedIntent[],
  onTick: (game: Game, tick: number) => boolean | void = () => {},
): Promise<Game> {
  let error: string | undefined;
  const runner = await createGameRunner(
    {
      gameID: "TUTORIAL",
      lobbyCreatedAt: 0,
      config: tutorialConfig,
      players: [{ clientID: CLIENT, username: "New Player", clanTag: null }],
    },
    CLIENT,
    await loadMapFiles(mapLoader, GameMapType.Tutorial, GameMapSize.Normal),
    (gu) => {
      if ("errMsg" in gu) error = gu.errMsg;
    },
  );
  for (let t = 0; t < ticks; t++) {
    runner.addTurn({ turnNumber: t, intents: intents(runner.game, t) });
    if (!runner.executeNextTick() || error !== undefined) {
      throw new Error(`tutorial game failed at turn ${t}: ${error}`);
    }
    if (onTick(runner.game, t) === true) break;
  }
  return runner.game;
}

const spawn = (game: Game): StampedIntent => ({
  type: "spawn",
  clientID: CLIENT,
  tile: game.ref(98, 98),
});

const human = (game: Game) => game.playerByClientID(CLIENT)!;
const ofType = (game: Game, type: PlayerType) =>
  game.players().find((p) => p.type() === type);

describe("Tutorial scenario", () => {
  test("the nation and the tribe only grow into free land", async () => {
    let tribeAttackedHuman = false;
    let aiUnits = 0;
    const game = await playTutorial(
      1500,
      (g, t) => (t === 0 ? [spawn(g)] : []),
      (g) => {
        if (human(g).incomingAttacks().length > 0) tribeAttackedHuman = true;
        for (const p of g.players()) {
          if (p.type() !== PlayerType.Human) aiUnits += p.units().length;
        }
      },
    );

    expect(tribeAttackedHuman).toBe(false);
    // No boats, warships, structures or nukes.
    expect(aiUnits).toBe(0);

    const nation = ofType(game, PlayerType.Nation)!;
    const tribe = ofType(game, PlayerType.Bot)!;
    expect(nation.isAlive()).toBe(true);
    expect(tribe.isAlive()).toBe(true);
    // The strait splits the map at x ≈ 130..155: the nation filled its own
    // island and the tribe stayed on the player's.
    const xs = (p: Player) => [...p.tiles()].map((t) => game.x(t));
    expect(Math.min(...xs(nation))).toBeGreaterThan(150);
    expect(Math.max(...xs(tribe))).toBeLessThan(135);
    expect(nation.numTilesOwned()).toBeGreaterThan(700);
    expect(tribe.numTilesOwned()).toBeGreaterThan(1000);
    expect(game.getWinner()).toBeNull();
  });

  test("conquering the tribe and the nation wins", async () => {
    let wonAt: number | null = null;
    const game = await playTutorial(
      6000,
      (g, t) => {
        if (t === 0) return [spawn(g)];
        // About what a new player does: an attack every few seconds with
        // the default 20% attack ratio.
        if (t % 30 !== 0 || g.inSpawnPhase()) return [];
        const me = human(g);
        const troops = me.troops() * 0.2;
        const tribe = ofType(g, PlayerType.Bot);
        if (tribe !== undefined) {
          // Expand until we border the tribe, then take it.
          const target = me.sharesBorderWith(tribe) ? tribe.id() : null;
          return [
            { type: "attack", clientID: CLIENT, targetID: target, troops },
          ];
        }
        const nation = ofType(g, PlayerType.Nation);
        if (nation === undefined) return [];
        if (me.sharesBorderWith(nation)) {
          return [
            { type: "attack", clientID: CLIENT, targetID: nation.id(), troops },
          ];
        }
        if (me.units(UnitType.TransportShip).length > 0) return [];
        const beach = [...nation.borderTiles()].find((t) => g.isShore(t));
        return beach === undefined
          ? []
          : [{ type: "boat", clientID: CLIENT, troops, dst: beach }];
      },
      (g, t) => {
        if (g.getWinner() === null) return false;
        wonAt = t;
        return true;
      },
    );

    expect(wonAt).not.toBeNull();
    expect(game.getWinner()).toBe(human(game));
  });
});
