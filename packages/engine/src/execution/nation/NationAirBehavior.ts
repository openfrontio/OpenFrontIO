import { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  Aircraft,
  Difficulty,
  Gold,
  Structures,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import {
  AA_GUN_RANGE,
  BOMB_STRUCTURE_RADIUS,
} from "@openfront/engine-lib/game/AirRules";
import { Game, Player, Unit } from "../../game/Game";
import { isHostileTo } from "../air/AirCombat";
import { ConstructionExecution } from "../ConstructionExecution";
import { MoveWarshipExecution } from "../MoveWarshipExecution";

/** Cities a nation needs before it invests in an air arm. */
const MIN_CITIES_FOR_AIRBASE = 3;
/**
 * The air arm's budget: the value of air assets a nation may hold per city
 * level. Tying it to the economy (like the structure behavior's ratios per
 * city) keeps aircraft from crowding out cities, ports and factories while
 * still letting a growing nation field one.
 */
const AIR_BUDGET_PER_CITY_LEVEL = 200_000n;
/**
 * Aircraft a nation buys over the whole game, per city level. Losses free
 * budget, so without this a nation would keep replacing aircraft lost to
 * flak instead of growing its economy.
 */
const AIRCRAFT_PURCHASES_PER_CITY_LEVEL_NUM = 1;
const AIRCRAFT_PURCHASES_PER_CITY_LEVEL_DEN = 2;
/** List value of each air asset, for the budget (not its actual price). */
const AIR_ASSET_VALUE: ReadonlyArray<readonly [UnitType, Gold]> = [
  [UnitType.Airbase, 250_000n],
  [UnitType.RadarStation, 300_000n],
  [UnitType.AAGun, 100_000n],
  [UnitType.Fighter, 300_000n],
  [UnitType.Bomber, 500_000n],
  [UnitType.AttackHelicopter, 225_000n],
  [UnitType.TransportHelicopter, 150_000n],
];
/** Distance from a nation's structures within which aircraft are a threat. */
const THREAT_RADIUS = 60;
/** Distance from its structures within which a nation hunts enemy boats. */
const NAVAL_THREAT_RADIUS = 80;
/** Max AA guns, as a fraction (1 / n) of the nation's cities. */
const AA_GUNS_PER_CITY_DIVISOR = 2;
const MAX_AA_GUNS = 6;

/** Distances (tiles) of the rings probed for a structure site. */
const SITE_RING_RADII: readonly number[] = [20, 30];
/** Unit directions scaled by 10 (integer math): 8 compass points. */
const SITE_RING_DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [10, 0],
  [0, 10],
  [-10, 0],
  [0, -10],
  [7, 7],
  [-7, 7],
  [7, -7],
  [-7, -7],
];

/** Structures worth bombing, best first on a tie. */
const STRIKE_TARGETS: readonly UnitType[] = [
  UnitType.MissileSilo,
  UnitType.SAMLauncher,
  UnitType.Airbase,
  UnitType.Factory,
  UnitType.Port,
  UnitType.City,
  UnitType.RadarStation,
];

interface AirCaps {
  fighters: number;
  helicopters: number;
  bombers: number;
}

function capsFor(difficulty: Difficulty): AirCaps {
  switch (difficulty) {
    case Difficulty.Easy:
      return { fighters: 0, helicopters: 0, bombers: 0 };
    case Difficulty.Medium:
      return { fighters: 2, helicopters: 1, bombers: 1 };
    case Difficulty.Hard:
      return { fighters: 3, helicopters: 2, bombers: 2 };
    case Difficulty.Impossible:
      return { fighters: 4, helicopters: 3, bombers: 3 };
  }
}

/**
 * AIR update: how nations use the air arm.
 *
 * Stateless by design: every decision is a pure function of the current
 * game state, so the behavior stores nothing in snapshots and draws nothing
 * from the nation's shared PRNG (the other behaviors' random streams are
 * unchanged). It acts at most once per call, after the structure behavior
 * has had its turn. Planned purchases (airbase, radar, aircraft) stay within
 * a budget proportional to the nation's city levels and need twice their
 * cost in the treasury, so the air arm does not starve the economy, SAMs or
 * nukes; only reactive AA guns, cheap point defence against aircraft
 * already overhead, are outside the budget.
 *
 * Priorities, in order:
 *  1. Respond to hostile aircraft over its structures with AA guns.
 *  2. Build an airbase once the economy can carry it.
 *  3. Add a radar station once hostile aircraft exist (SAMs and fighters
 *     only engage what radar tracks beyond their own short sensors).
 *  4. Keep enough fighters to contest the hostile aircraft it faces.
 *  5. Send attack helicopters against boats and warships near its coast.
 *  6. Bomb the least-defended valuable structure of the side it is at war
 *     with, and retask idle bombers onto new targets.
 *
 * Easy nations and the tutorial do not use aircraft.
 */
export class NationAirBehavior {
  constructor(
    private game: Game,
    private player: Player,
  ) {}

  handleAir(): boolean {
    const config = this.game.config();
    const difficulty = config.gameConfig().difficulty;
    if (difficulty === Difficulty.Easy || config.gameConfig().tutorial) {
      return false;
    }
    if (!this.player.isAlive()) return false;
    const caps = capsFor(difficulty);
    const threats = this.hostileAircraftNearHome();

    return (
      this.maybeBuildAAGun(threats) ||
      this.maybeBuildAirbase() ||
      this.maybeBuildRadar(threats) ||
      this.maybeBuildFighter(threats, caps) ||
      this.maybeDeployHelicopter(caps) ||
      this.maybeBomb(caps)
    );
  }

  // -------------------------------------------------------------------------
  // Threat assessment
  // -------------------------------------------------------------------------

  /** Hostile aircraft close to one of this nation's structures. */
  private hostileAircraftNearHome(): Unit[] {
    const threats: Unit[] = [];
    for (const aircraft of this.game.units(Aircraft.types)) {
      if (!isHostileTo(this.player, aircraft)) continue;
      const nearHome = this.game.anyUnitNearby(
        aircraft.tile(),
        THREAT_RADIUS,
        Structures.types,
        (u) => u.owner() === this.player,
      );
      if (nearHome) threats.push(aircraft);
    }
    return threats;
  }

  private hostileAircraftExist(): boolean {
    return this.game
      .units(Aircraft.types)
      .some((a) => isHostileTo(this.player, a));
  }

  // -------------------------------------------------------------------------
  // Builds
  // -------------------------------------------------------------------------

  private maybeBuildAAGun(threats: Unit[]): boolean {
    if (threats.length === 0 || !this.enabled(UnitType.AAGun)) return false;
    const cities = this.player.unitCount(UnitType.City);
    const max = Math.min(
      MAX_AA_GUNS,
      Math.max(1, Math.floor(cities / AA_GUNS_PER_CITY_DIVISOR)),
    );
    if (this.player.units(UnitType.AAGun).length >= max) return false;
    // Defend the structure closest to the first threat, unless a gun
    // already covers it.
    const threat = threats[0];
    const structure = this.closestOwnStructure(threat.tile());
    if (structure === undefined) return false;
    const covered = this.game.anyUnitNearby(
      structure.tile(),
      AA_GUN_RANGE,
      [UnitType.AAGun],
      (u) => u.owner() === this.player,
      undefined,
      true,
    );
    if (covered) return false;
    return this.build(UnitType.AAGun, structure.tile(), 2n, true);
  }

  private maybeBuildAirbase(): boolean {
    if (this.player.units(UnitType.Airbase).length > 0) return false;
    if (!this.enabled(UnitType.Airbase)) return false;
    if (this.player.unitCount(UnitType.City) < MIN_CITIES_FOR_AIRBASE) {
      return false;
    }
    // Next to the oldest city: usually the heartland, far from the front.
    const city = this.player.units(UnitType.City)[0];
    return city !== undefined && this.build(UnitType.Airbase, city.tile(), 2n);
  }

  private maybeBuildRadar(threats: Unit[]): boolean {
    if (this.player.units(UnitType.RadarStation).length > 0) return false;
    if (!this.enabled(UnitType.RadarStation)) return false;
    if (threats.length === 0 && !this.hostileAircraftExist()) return false;
    // Radar extends SAM coverage to aircraft, so place it by a SAM first.
    const anchor =
      this.player.units(UnitType.SAMLauncher)[0] ??
      this.player.units(UnitType.Airbase)[0];
    return (
      anchor !== undefined &&
      this.build(UnitType.RadarStation, anchor.tile(), 2n)
    );
  }

  private maybeBuildFighter(threats: Unit[], caps: AirCaps): boolean {
    if (!this.hasOperationalAirbase() || !this.enabled(UnitType.Fighter)) {
      return false;
    }
    const enemyFixedWing = this.game
      .units(UnitType.Fighter, UnitType.Bomber)
      .filter((a) => isHostileTo(this.player, a)).length;
    if (threats.length === 0 && enemyFixedWing === 0) return false;
    const desired = Math.min(
      caps.fighters,
      Math.ceil(threats.length / 2) + (enemyFixedWing > 0 ? 1 : 0),
    );
    const fighters = this.player.units(UnitType.Fighter);
    if (fighters.length >= desired) {
      // Enough fighters: move an idle one over the threatened structure.
      if (threats.length > 0) {
        const station = this.closestOwnStructure(threats[0].tile());
        const idle = fighters.find((f) => f.targetUnit() === undefined);
        if (station !== undefined && idle !== undefined) {
          return this.retask(idle, station.tile());
        }
      }
      return false;
    }
    const station =
      threats.length > 0
        ? this.closestOwnStructure(threats[0].tile())
        : this.player.units(UnitType.City)[0];
    return (
      station !== undefined && this.build(UnitType.Fighter, station.tile(), 3n)
    );
  }

  private maybeDeployHelicopter(caps: AirCaps): boolean {
    if (
      !this.hasOperationalAirbase() ||
      !this.enabled(UnitType.AttackHelicopter)
    ) {
      return false;
    }
    const intruder = this.game
      .units(UnitType.TransportShip, UnitType.Warship)
      .find(
        (ship) =>
          isHostileTo(this.player, ship) &&
          this.game.anyUnitNearby(
            ship.tile(),
            NAVAL_THREAT_RADIUS,
            Structures.types,
            (u) => u.owner() === this.player,
          ),
      );
    if (intruder === undefined) return false;
    const helis = this.player.units(UnitType.AttackHelicopter);
    if (helis.length < caps.helicopters) {
      return this.build(UnitType.AttackHelicopter, intruder.tile(), 3n);
    }
    const idle = helis.find((h) => h.targetUnit() === undefined);
    return idle !== undefined && this.retask(idle, intruder.tile());
  }

  private maybeBomb(caps: AirCaps): boolean {
    if (!this.hasOperationalAirbase() || !this.enabled(UnitType.Bomber)) {
      return false;
    }
    const enemy = this.warTarget();
    if (enemy === undefined) return false;
    const target = this.bestStrikeTarget(enemy);
    if (target === undefined) return false;

    const bombers = this.player.units(UnitType.Bomber);
    // Retask a bomber whose aim point has nothing left to destroy.
    for (const bomber of bombers) {
      const aim = bomber.warshipState().patrolTile;
      if (aim !== undefined && !this.hasHostileStructureNear(aim)) {
        return this.retask(bomber, target);
      }
    }
    if (bombers.length >= caps.bombers) return false;
    return this.build(UnitType.Bomber, target, 3n);
  }

  // -------------------------------------------------------------------------
  // Targeting helpers
  // -------------------------------------------------------------------------

  /** The player this nation is attacking with the most troops, if any. */
  private warTarget(): Player | undefined {
    let best: Player | undefined;
    let bestTroops = 0;
    for (const attack of this.player.outgoingAttacks()) {
      const target = attack.target();
      if (!target.isPlayer()) continue;
      const enemy = target as Player;
      if (!this.player.canAttackPlayer(enemy)) continue;
      if (attack.troops() > bestTroops) {
        bestTroops = attack.troops();
        best = enemy;
      }
    }
    return best;
  }

  /**
   * The enemy structure with the best value-to-defence ratio: higher levels
   * and more strategic types score higher; AA guns and SAMs covering it
   * score lower. Ties go to the lowest unit id (deterministic).
   */
  private bestStrikeTarget(enemy: Player): TileRef | undefined {
    let bestTile: TileRef | undefined;
    let bestScore = -Infinity;
    let bestId = Infinity;
    for (const structure of enemy.units(STRIKE_TARGETS)) {
      if (!structure.isActive() || structure.isUnderConstruction()) continue;
      const typeRank =
        STRIKE_TARGETS.length - STRIKE_TARGETS.indexOf(structure.type());
      const defences = this.game.nearbyUnits(
        structure.tile(),
        AA_GUN_RANGE,
        [UnitType.AAGun, UnitType.SAMLauncher],
        ({ unit }) => unit.owner() === enemy,
      ).length;
      const score = structure.level() * 10 + typeRank * 3 - defences * 25;
      if (
        score > bestScore ||
        (score === bestScore && structure.id() < bestId)
      ) {
        bestScore = score;
        bestId = structure.id();
        bestTile = structure.tile();
      }
    }
    return bestTile;
  }

  private hasHostileStructureNear(tile: TileRef): boolean {
    return this.game.anyUnitNearby(
      tile,
      BOMB_STRUCTURE_RADIUS,
      Structures.types,
      (u) => isHostileTo(this.player, u),
    );
  }

  private closestOwnStructure(tile: TileRef): Unit | undefined {
    let best: Unit | undefined;
    let bestDist = Infinity;
    for (const structure of this.player.units(Structures.types)) {
      if (!structure.isActive()) continue;
      const d = this.game.euclideanDistSquared(structure.tile(), tile);
      if (d < bestDist) {
        bestDist = d;
        best = structure;
      }
    }
    return best;
  }

  private hasOperationalAirbase(): boolean {
    return this.player
      .units(UnitType.Airbase)
      .some((b) => b.isActive() && !b.isUnderConstruction());
  }

  // -------------------------------------------------------------------------
  // Orders
  // -------------------------------------------------------------------------

  private enabled(type: UnitType): boolean {
    return !this.game.config().isUnitDisabled(type);
  }

  /**
   * Builds `type` toward `tile` when the treasury holds `margin` times its
   * cost and, unless `reactive` (an answer to a threat already overhead),
   * the purchase fits the air budget.
   */
  private build(
    type: UnitType,
    tile: TileRef,
    margin: Gold,
    reactive = false,
  ): boolean {
    const cost = this.game.unitInfo(type).cost(this.game, this.player);
    if (this.player.gold() < cost * margin) return false;
    if (!reactive && !this.fitsAirBudget(type)) return false;
    if (Aircraft.has(type) && !this.mayBuyAircraft()) return false;
    const target = Structures.has(type) ? this.siteNear(type, tile) : tile;
    if (target === undefined || this.player.canBuild(type, target) === false) {
      return false;
    }
    this.game.addExecution(
      new ConstructionExecution(this.player, type, target),
    );
    return true;
  }

  /**
   * A buildable site for a structure beside `anchor`. Structures keep a
   * minimum spacing equal to the placement search radius, so aiming at an
   * existing structure never finds room; probe a deterministic ring of
   * points around it instead, nearest first.
   */
  private siteNear(type: UnitType, anchor: TileRef): TileRef | undefined {
    if (this.player.canBuild(type, anchor) !== false) return anchor;
    const ax = this.game.x(anchor);
    const ay = this.game.y(anchor);
    for (const radius of SITE_RING_RADII) {
      for (const [dx, dy] of SITE_RING_DIRECTIONS) {
        const x = ax + Math.trunc((dx * radius) / 10);
        const y = ay + Math.trunc((dy * radius) / 10);
        if (!this.game.isValidCoord(x, y)) continue;
        const tile = this.game.ref(x, y);
        if (this.player.canBuild(type, tile) !== false) return tile;
      }
    }
    return undefined;
  }

  private mayBuyAircraft(): boolean {
    let bought = 0;
    for (const type of Aircraft.types) {
      bought += this.player.unitsConstructed(type);
    }
    const allowed = Math.floor(
      (this.player.unitsOwned(UnitType.City) *
        AIRCRAFT_PURCHASES_PER_CITY_LEVEL_NUM) /
        AIRCRAFT_PURCHASES_PER_CITY_LEVEL_DEN,
    );
    return bought < allowed;
  }

  private fitsAirBudget(type: UnitType): boolean {
    let held = 0n;
    let added = 0n;
    for (const [assetType, value] of AIR_ASSET_VALUE) {
      held += BigInt(this.player.units(assetType).length) * value;
      if (assetType === type) added = value;
    }
    const budget =
      BigInt(this.player.unitsOwned(UnitType.City)) * AIR_BUDGET_PER_CITY_LEVEL;
    return held + added <= budget;
  }

  private retask(aircraft: Unit, tile: TileRef): boolean {
    if (aircraft.warshipState().patrolTile === tile) return false;
    this.game.addExecution(
      new MoveWarshipExecution(this.player, [aircraft.id()], tile),
    );
    return true;
  }
}
