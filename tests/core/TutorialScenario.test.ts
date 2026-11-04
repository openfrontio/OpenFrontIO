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
import { TUTORIAL_COLLAPSE_TILES } from "@openfront/engine/execution/nation/TutorialCollapse";
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
  bots: 0,
  donateGold: false,
  donateTroops: false,
  infiniteGold: false,
  infiniteTroops: false,
  instantBuild: false,
  randomSpawn: false,
  // As SinglePlayerModal starts it.
  disabledUnits: [
    UnitType.City,
    UnitType.DefensePost,
    UnitType.Factory,
    UnitType.SAMLauncher,
    UnitType.HydrogenBomb,
    UnitType.MIRV,
  ],
  startingGold: 750_000,
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
/**
 * The living nation on the player's island (west of the strait, x ≈
 * 130..155), or the one across it.
 */
const nation = (game: Game, onPlayersIsland: boolean) =>
  game.players().find((p) => {
    const spawn = p.spawnTile();
    return (
      p.type() === PlayerType.Nation &&
      spawn !== undefined &&
      game.x(spawn) < 142 === onPlayersIsland
    );
  });
const kingdom = (game: Game) => nation(game, true);
const empire = (game: Game) => nation(game, false);

const TUTORIAL_UNITS: readonly UnitType[] = [
  UnitType.MissileSilo,
  UnitType.AtomBomb,
  UnitType.Port,
  UnitType.Warship,
];

describe("Tutorial scenario", () => {
  test("the nations only grow into free land", async () => {
    let attackedHuman = false;
    let unitsBeforeBorder = 0;
    const unitTypes = new Set<UnitType>();
    const game = await playTutorial(
      1500,
      (g, t) => (t === 0 ? [spawn(g)] : []),
      (g) => {
        if (human(g).incomingAttacks().length > 0) attackedHuman = true;
        const bordered = kingdom(g)?.sharesBorderWith(human(g)) === true;
        for (const p of g.players()) {
          if (p.type() === PlayerType.Human) continue;
          for (const u of p.units()) unitTypes.add(u.type());
          if (!bordered) unitsBeforeBorder += p.units().length;
        }
      },
    );

    expect(attackedHuman).toBe(false);
    // Nothing built until the player meets the kingdom, then only the
    // tutorial's silo, nukes, port and warship.
    expect(unitsBeforeBorder).toBe(0);
    for (const type of unitTypes) expect(TUTORIAL_UNITS).toContain(type);

    const k = kingdom(game)!;
    const e = empire(game)!;
    expect(k.isAlive()).toBe(true);
    expect(e.isAlive()).toBe(true);
    // The empire filled its own island and the kingdom stayed on the
    // player's.
    const xs = (p: Player) => [...p.tiles()].map((t) => game.x(t));
    expect(Math.min(...xs(e))).toBeGreaterThan(150);
    expect(Math.max(...xs(k))).toBeLessThan(135);
    expect(e.numTilesOwned()).toBeGreaterThan(700);
    expect(k.numTilesOwned()).toBeGreaterThan(1000);
    expect(game.getWinner()).toBeNull();
  });

  test("the player starts with about half their max troops", async () => {
    let share: number | null = null;
    await playTutorial(
      200,
      (g, t) => (t === 0 ? [spawn(g)] : []),
      (g) => {
        const me = human(g);
        if (!me.hasSpawned()) return false;
        share = me.troops() / g.config().maxTroops(me);
        return true;
      },
    );
    expect(share).toBeGreaterThan(0.4);
    expect(share).toBeLessThan(0.6);
  });

  test("taking the kingdom's silo, nuking the empire and conquering it wins", async () => {
    let wonAt: number | null = null;
    let kingdomNukes = 0;
    let harborBuilt = false;
    let harborAfterNuke: number | null = null;
    // How far each kingdom nuke's target was from the middle of our land.
    const offCenter: number[] = [];
    const aimed = new Set<number>();
    let siloCapturedAt: number | null = null;
    let playerNukes = 0;
    let nuked = false;
    // Each nation's land on the last tick it was alive.
    const lastTiles = new Map<string, number>();
    // Where the empire's warship has been, and how far it got from its dock.
    const shipTiles = new Set<number>();
    let shipRange = 0;
    const game = await playTutorial(
      6000,
      (g, t) => {
        if (t === 0) return [spawn(g)];
        // About what a new player does: an attack every few seconds with
        // the default 20% attack ratio.
        if (t % 30 !== 0 || g.inSpawnPhase()) return [];
        const me = human(g);
        const troops = me.troops() * 0.2;
        const k = kingdom(g);
        if (k !== undefined) {
          // Expand until we border the kingdom, then take it.
          const target = me.sharesBorderWith(k) ? k.id() : null;
          return [
            { type: "attack", clientID: CLIENT, targetID: target, troops },
          ];
        }
        const e = empire(g);
        if (e === undefined) return [];
        const intents: StampedIntent[] = [];
        const mySilo = me.units(UnitType.MissileSilo)[0];
        if (!nuked && mySilo !== undefined && !mySilo.isInCooldown()) {
          nuked = true;
          // At their port, as the overlay asks.
          intents.push({
            type: "build_unit",
            clientID: CLIENT,
            unit: UnitType.AtomBomb,
            tile: e.units(UnitType.Port)[0].tile(),
          });
        }
        // The overlay holds attacks on the empire until it's nuked.
        if (mySilo !== undefined && !nuked) return intents;
        if (me.sharesBorderWith(e)) {
          intents.push({
            type: "attack",
            clientID: CLIENT,
            targetID: e.id(),
            troops,
          });
          return intents;
        }
        if (me.units(UnitType.TransportShip).length > 0) return intents;
        const dst = [...e.borderTiles()].find((t) => g.isShore(t));
        if (dst !== undefined) {
          intents.push({ type: "boat", clientID: CLIENT, troops, dst });
        }
        return intents;
      },
      (g, t) => {
        for (const n of g.players()) {
          if (n.type() === PlayerType.Nation) {
            lastTiles.set(n.name(), n.numTilesOwned());
          }
        }
        const k = kingdom(g);
        for (const bomb of k?.units(UnitType.AtomBomb) ?? []) {
          const dst = bomb.targetTile();
          if (aimed.has(bomb.id()) || dst === undefined) continue;
          aimed.add(bomb.id());
          const tiles = [...human(g).tiles()];
          const cx = tiles.reduce((s, t) => s + g.x(t), 0) / tiles.length;
          const cy = tiles.reduce((s, t) => s + g.y(t), 0) / tiles.length;
          offCenter.push(Math.hypot(g.x(dst) - cx, g.y(dst) - cy));
        }
        if (k !== undefined) {
          kingdomNukes = Math.max(
            kingdomNukes,
            k.unitsConstructed(UnitType.AtomBomb),
          );
        }
        if (
          siloCapturedAt === null &&
          human(g).units(UnitType.MissileSilo).length > 0
        ) {
          siloCapturedAt = t;
        }
        playerNukes = human(g).unitsConstructed(UnitType.AtomBomb);
        const e = empire(g);
        const harbor = [UnitType.Port, UnitType.Warship].flatMap(
          (type) => e?.units(type) ?? [],
        );
        if (harbor.length === 2) harborBuilt = true;
        for (const ship of e?.units(UnitType.Warship) ?? []) {
          shipTiles.add(ship.tile());
          shipRange = Math.max(
            shipRange,
            g.euclideanDistSquared(
              ship.tile(),
              ship.warshipState().patrolTile!,
            ),
          );
        }
        if (
          harborAfterNuke === null &&
          playerNukes > 0 &&
          human(g).units(UnitType.AtomBomb).length === 0
        ) {
          harborAfterNuke = harbor.length;
        }
        if (g.getWinner() === null) return false;
        wonAt = t;
        return true;
      },
    );

    // The kingdom built its silo and nuked the player, who lived through
    // it, took the silo and fired it at the empire.
    expect(kingdomNukes).toBeGreaterThan(0);
    // Each aimed at the middle of our land.
    expect(offCenter.length).toBe(kingdomNukes);
    for (const d of offCenter) expect(d).toBeLessThan(3);
    expect(siloCapturedAt).not.toBeNull();
    expect(playerNukes).toBe(1);
    // The empire's port and warship, gone with it.
    expect(harborBuilt).toBe(true);
    expect(harborAfterNuke).toBe(0);
    // The warship moved around, staying near its dock: it heads for points
    // within 6 tiles, a step past that at most on the way.
    expect(shipTiles.size).toBeGreaterThan(5);
    expect(shipRange).toBeLessThanOrEqual(7 * 7);
    expect(wonAt).not.toBeNull();
    expect(game.getWinner()).toBe(human(game));
    // Both fell with land left (TutorialCollapse), and it all went to us.
    expect(lastTiles.size).toBe(2);
    for (const tiles of lastTiles.values()) {
      expect(tiles).toBeGreaterThan(100);
      expect(tiles).toBeLessThan(TUTORIAL_COLLAPSE_TILES);
    }
    expect(
      game
        .allPlayers()
        .filter((p) => p.type() === PlayerType.Nation && p.isAlive()),
    ).toEqual([]);
  });
});
