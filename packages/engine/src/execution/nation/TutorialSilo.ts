import { TileRef } from "@openfront/engine-api/game/GameMap";
import { PlayerType, UnitType } from "@openfront/engine-api/game/GameTypes";
import { Game, Player } from "../../game/Game";
import { MissileSiloExecution } from "../MissileSiloExecution";
import { NukeExecution } from "../NukeExecution";

/**
 * The x of the strait splitting the Tutorial map: the nation that spawns
 * west of it shares the player's island, the one east of it has its own.
 * OnboardingOverlay splits them the same way (Onboarding.ts STRAIT_X).
 */
const STRAIT_X = 142;

/**
 * The onboarding tutorial's missile silo (docs/OnboardingTutorial.md). Once
 * the player borders the nation on their island, it builds a silo at its
 * capital and nukes the middle of the player's land right away, then
 * whenever it's loaded and `fire` is set, until the player takes the silo.
 * With it, the nation across the strait builds a port and a warship docked
 * beside it, for the player to nuke from the captured silo.
 * `fire` only on some ticks: a nuke launches the tick after it's ordered,
 * so the silo still reads loaded on the next one.
 *
 * Stateless: everything is read off the game each tick, so a snapshot needs
 * nothing from here.
 */
export function tutorialSilo(game: Game, nation: Player, fire: boolean): void {
  if (!onPlayersIsland(game, nation)) return;
  const human = game.players().find((p) => p.type() === PlayerType.Human);
  if (human === undefined) return;

  let silo = nation.units(UnitType.MissileSilo)[0];
  if (silo === undefined) {
    // Built once: a captured silo isn't rebuilt.
    if (nation.unitsConstructed(UnitType.MissileSilo) > 0) return;
    if (!nation.sharesBorderWith(human)) return;
    const tile = siloTile(game, nation);
    if (tile === null) return;
    topUpGold(game, nation, UnitType.MissileSilo);
    silo = nation.buildUnit(UnitType.MissileSilo, tile, {});
    game.addExecution(new MissileSiloExecution(silo));
    for (const p of game.players()) {
      if (p.type() === PlayerType.Nation && !onPlayersIsland(game, p)) {
        buildHarbor(game, p, human);
      }
    }
    // The first nuke goes as soon as it's up, so even a quick player sees one.
    fire = true;
  }

  if (!fire || silo.isInCooldown()) return;
  const target = nukeTarget(game, nation, human);
  if (target === null) return;
  topUpGold(game, nation, UnitType.AtomBomb);
  if (nation.canBuild(UnitType.AtomBomb, target) === false) return;
  game.addExecution(new NukeExecution(UnitType.AtomBomb, nation, target));
}

function onPlayersIsland(game: Game, nation: Player): boolean {
  const spawn = nation.spawnTile();
  return spawn !== undefined && game.x(spawn) < STRAIT_X;
}

/**
 * A port on the nation's shore farthest from the player, and a warship
 * beside it. Neither gets an execution: the port has no one to trade with,
 * and a patrolling warship would sink the player's boats (tutorialWarship
 * moves it instead).
 */
function buildHarbor(game: Game, nation: Player, human: Player): void {
  const from = human.spawnTile();
  if (from === undefined) return;
  let port: TileRef | null = null;
  let portDist = -1;
  for (const t of nation.borderTiles()) {
    const d = game.euclideanDistSquared(t, from);
    if (d <= portDist || !game.isShore(t)) continue;
    port = t;
    portDist = d;
  }
  if (port === null) return;
  const dock = game.neighbors(port).find((n) => game.isOcean(n));
  if (dock === undefined) return;
  topUpGold(game, nation, UnitType.Port);
  nation.buildUnit(UnitType.Port, port, {});
  topUpGold(game, nation, UnitType.Warship);
  nation.buildUnit(UnitType.Warship, dock, { patrolTile: dock });
}

/** How far the empire's warship wanders from its dock, in tiles. */
const PATROL_RADIUS = 6;

/**
 * Moves the nation's warship (buildHarbor's) around its dock, a tile every
 * other tick, so it looks alive. It stays close enough that a nuke on the
 * port still sinks it. Its target tile is the only state.
 */
export function tutorialWarship(game: Game, nation: Player, ticks: number) {
  if (ticks % 2 !== 0) return;
  const ship = nation.units(UnitType.Warship)[0];
  const home = ship?.warshipState().patrolTile;
  if (ship === undefined || home === undefined) return;
  let target = ship.targetTile();
  if (target === undefined || target === ship.tile()) {
    const point = patrolPoint(game, home, ticks);
    if (point === null) return;
    target = point;
    ship.setTargetTile(target);
  }
  // The ocean neighbor nearest the target; if none is nearer, pick another.
  let next: TileRef | null = null;
  let best = game.euclideanDistSquared(ship.tile(), target);
  for (const n of game.neighbors(ship.tile())) {
    if (!game.isOcean(n)) continue;
    const d = game.euclideanDistSquared(n, target);
    if (d >= best) continue;
    next = n;
    best = d;
  }
  if (next === null) {
    ship.setTargetTile(undefined);
    return;
  }
  ship.move(next);
}

/**
 * An ocean tile within PATROL_RADIUS of `home`, picked from the tick so
 * every client picks the same. Null if a few tries find none.
 */
function patrolPoint(game: Game, home: TileRef, ticks: number): TileRef | null {
  const span = 2 * PATROL_RADIUS + 1;
  for (let i = 0; i < 10; i++) {
    const h = Math.imul(ticks + i, 2654435761) >>> 0;
    const dx = (h % span) - PATROL_RADIUS;
    const dy = ((h >>> 8) % span) - PATROL_RADIUS;
    if (dx * dx + dy * dy > PATROL_RADIUS * PATROL_RADIUS) continue;
    const x = game.x(home) + dx;
    const y = game.y(home) + dy;
    if (!game.isValidCoord(x, y)) continue;
    const t = game.ref(x, y);
    if (game.isOcean(t)) return t;
  }
  return null;
}

/** Gives the nation what it lacks to afford the unit. */
function topUpGold(game: Game, nation: Player, type: UnitType): void {
  const cost = game.unitInfo(type).cost(game, nation);
  if (nation.gold() < cost) nation.addGold(cost - nation.gold());
}

/**
 * The nation's tile nearest where it spawned, its capital, so the player
 * fights through its land to take the silo. Null if it has no land.
 */
function siloTile(game: Game, nation: Player): TileRef | null {
  const from = nation.spawnTile();
  if (from === undefined) return null;
  let best: TileRef | null = null;
  let bestDist = Infinity;
  for (const t of nation.tiles()) {
    const d = game.euclideanDistSquared(t, from);
    if (d >= bestDist) continue;
    best = t;
    bestDist = d;
  }
  return best;
}

/**
 * The player's tile nearest the middle of their land whose blast reaches
 * none of the nation's. Null if every tile of theirs is that close.
 */
function nukeTarget(game: Game, nation: Player, human: Player): TileRef | null {
  const outer = game.config().nukeMagnitudes(UnitType.AtomBomb).outer;
  const clear = (outer + 1) * (outer + 1);
  const border = [...nation.borderTiles()];
  let sumX = 0;
  let sumY = 0;
  for (const t of human.tiles()) {
    sumX += game.x(t);
    sumY += game.y(t);
  }
  const cx = sumX / human.numTilesOwned();
  const cy = sumY / human.numTilesOwned();
  const fromMiddle = (t: TileRef) =>
    (game.x(t) - cx) * (game.x(t) - cx) + (game.y(t) - cy) * (game.y(t) - cy);
  const tiles = [...human.tiles()].sort(
    (a, b) => fromMiddle(a) - fromMiddle(b),
  );
  for (const t of tiles) {
    if (border.every((b) => game.euclideanDistSquared(t, b) > clear)) return t;
  }
  return null;
}
