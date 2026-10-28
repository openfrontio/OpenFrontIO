import { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  Difficulty,
  PlayerType,
  Structures,
  TerraNullius,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import {
  readVersioned,
  snapshotType,
  Versioned,
  zNum,
  zRef,
} from "@openfront/engine-lib/snapshot/SnapshotType";
import { assertNever } from "@openfront/engine-lib/Util";
import { z } from "zod";
import { Attack, Game, Player, Unit } from "../../game/Game";
import {
  canBuildTransportShip,
  targetTransportTile,
} from "../../game/TransportShipUtils";
import type {
  SnapshotReader,
  SnapshotWriter,
} from "../../snapshot/SnapshotContext";
import { AttackExecution } from "../AttackExecution";
import { hasHighStartingGold } from "../nation/NationUtils";
import { TransportShipExecution } from "../TransportShipExecution";
import { closestTwoTiles } from "../Util";

// A planned boat attack: where it lands, how many tiles it sails, what would sink it
export interface BoatRoute {
  landing: TileRef;
  length: number;
  blocker: Unit | null;
}

/** How tribes and nations send attacks by land and boat; the protected hooks default to how tribes do it. */
export abstract class AiAttackBehavior {
  // Only set during a nation's maybeAttack call: each boat route planned
  protected boatRoutes: Map<Player, BoatRoute | null> | null = null;

  constructor(
    protected random: PseudoRandom,
    protected game: Game,
    protected player: Player,
    protected triggerRatio: number,
    protected reserveRatio: number,
    protected expandRatio: number,
  ) {}

  /** The owner supplies the shared PRNG, player and nation behaviors. */
  abstract snapshot(w: SnapshotWriter): Versioned;

  /** Tribes and nations store the same record; tribes leave the nation-only fields empty. */
  protected writeRecord(
    w: SnapshotWriter,
    botAttackTroopsSent: number,
    followedLandings: Attack[],
  ): Versioned {
    return w.versioned(AiAttackBehaviorSnapshot, {
      botAttackTroopsSent,
      followedLandings: followedLandings.map((a) => w.attack(a)),
      triggerRatio: this.triggerRatio,
      reserveRatio: this.reserveRatio,
      expandRatio: this.expandRatio,
    });
  }

  /** Fills the shared fields of a prototype-only shell; only assigns (see README). */
  protected restoreRecord(
    raw: unknown,
    r: SnapshotReader,
    random: PseudoRandom,
    player: Player,
  ): AiAttackState {
    const s = readVersioned(AiAttackBehaviorSnapshot, raw);
    this.random = random;
    this.game = r.game;
    this.player = player;
    // Only set during a maybeAttack call, so always null between ticks.
    this.boatRoutes = null;
    this.triggerRatio = s.triggerRatio;
    this.reserveRatio = s.reserveRatio;
    this.expandRatio = s.expandRatio;
    // Scratch buffer: always written before it is read.
    this.nbuf = [0, 0, 0, 0];
    return s;
  }

  sendAttack(target: Player | TerraNullius, force = false): boolean {
    if (!force && !this.shouldAttack(target)) return false;

    if (target.isPlayer()) {
      if (this.player.sharesBorderWith(target)) {
        return this.sendLandAttack(target);
      } else {
        return this.sendBoatAttack(target);
      }
    } else {
      // sharesBorderWith(TerraNullius) counts water tiles as TN (ownerID 0 = TN smallID),
      // so use a land-only adjacency check to decide land vs boat attack.
      if (this.hasLandBorderWithTerraNullius()) {
        return this.sendLandAttack(target);
      } else {
        return this.sendBoatAttackToNearbyTerraNullius();
      }
    }
  }

  shouldAttack(other: Player | TerraNullius): boolean {
    return true;
  }

  findIncomingAttackPlayer(): Player | null {
    const incomingAttacks = this.player
      .incomingAttacks()
      .filter(
        (attack) =>
          !this.player.isFriendly(attack.attacker()) &&
          !this.ignoresAttacksFrom(attack.attacker()),
      );
    let largestAttack = 0;
    let largestAttacker: Player | undefined;
    for (const attack of incomingAttacks) {
      if (attack.troops() <= largestAttack) continue;
      largestAttack = attack.troops();
      largestAttacker = attack.attacker();
    }
    if (largestAttacker !== undefined) {
      return largestAttacker;
    }
    return null;
  }

  protected ignoresAttacksFrom(attacker: Player): boolean {
    return false;
  }

  protected hasTriggerRatioTroops(expansion = false): boolean {
    const ratio = this.player.troops() / this.reserveBasis(expansion);
    return ratio >= this.triggerRatio;
  }

  // The max troops troop ratios refer to. With high starting gold, cities don't hold back
  // expanding into free land and bots: built all at once, they'd stall it until troops grow back.
  protected reserveBasis(expansion: boolean): number {
    const config = this.game.config();
    return expansion && this.expandsPastCityTroops()
      ? config.maxTroopsWithoutCities(this.player)
      : config.maxTroops(this.player);
  }

  protected expandsPastCityTroops(): boolean {
    return hasHighStartingGold(this.game, this.player);
  }

  // Troops kept home when attacking target: the expand ratio for free land and bots holding
  // structures, as we need those back ASAP, the reserve ratio otherwise
  protected reserveTroops(target: Player | TerraNullius): number {
    const expansion = !target.isPlayer() || target.type() === PlayerType.Bot;
    const maxTroops = this.reserveBasis(expansion);
    const botWithStructures =
      target.isPlayer() &&
      target.type() === PlayerType.Bot &&
      target.units().some((u) => Structures.has(u.type()));
    const useReserve = target.isPlayer() && !botWithStructures;
    const reserveRatio = useReserve ? this.reserveRatio : this.expandRatio;
    return maxTroops * reserveRatio;
  }

  // `opponent` is a player we take on on purpose (see NationAttackBehavior)
  protected calculateAttackTroops(
    target: Player | TerraNullius,
    sendTroops: (reserveTroops: number) => number,
    opponent?: Player,
  ): number | null {
    const troops = sendTroops(this.reserveTroops(target));
    return troops < 1 ? null : troops;
  }

  protected sendLandAttack(
    target: Player | TerraNullius,
    sendTroops = (reserveTroops: number) =>
      this.player.troops() - reserveTroops,
    opponent?: Player,
  ): boolean {
    const troops = this.calculateAttackTroops(target, sendTroops, opponent);
    if (troops === null) {
      return false;
    }

    this.game.addExecution(
      new AttackExecution(
        troops,
        this.player,
        target.isPlayer() ? target.id() : this.game.terraNullius().id(),
      ),
    );
    return true;
  }

  protected sendBoatAttack(target: Player): boolean {
    const route = this.boatRoute(target);
    if (route === null || route.blocker !== null) return false;

    const troops = this.calculateAttackTroops(
      target,
      () => this.player.troops() / 5,
    );
    if (troops === null) {
      return false;
    }

    this.game.addExecution(
      new TransportShipExecution(this.player, route.landing, troops),
    );
    return true;
  }

  private hasLandBorderWithTerraNullius(): boolean {
    // Allocation-free (neighbors() built an array per border tile and this
    // runs on every terra-nullius attack decision of every nation) — but
    // through for...of, not forEach: the dominant caller path answers true,
    // and the early exit matters more than the generator's overhead.
    const map = this.game.map();
    const nbuf = this.nbuf;
    for (const border of this.player.borderTiles()) {
      const n = map.neighbors4(border, nbuf);
      for (let i = 0; i < n; i++) {
        const neighbor = nbuf[i];
        if (
          map.isLand(neighbor) &&
          !map.isImpassable(neighbor) &&
          !map.hasOwner(neighbor)
        ) {
          return true;
        }
      }
    }
    return false;
  }

  protected nbuf: TileRef[] = [0, 0, 0, 0];

  /** The player's shore border tiles, in border-set order (one pass, no copy of the whole set). */
  protected shoreTiles(player: Player): TileRef[] {
    const game = this.game;
    const out: TileRef[] = [];
    player.borderTiles().forEach((t) => {
      if (game.isShore(t)) out.push(t);
    });
    return out;
  }

  // Scans shore border tiles (every 10th) for unowned land within 5 water tiles
  // in each cardinal direction, then sends a transport ship to the first match.
  private sendBoatAttackToNearbyTerraNullius(): boolean {
    if (this.game.config().isUnitDisabled(UnitType.TransportShip)) return false;
    if (
      this.player.unitCount(UnitType.TransportShip) >=
      this.game.config().boatMaxNumber()
    )
      return false;

    const directions: [number, number][] = [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ];
    const shores = this.shoreTiles(this.player);

    for (let i = 0; i < shores.length; i += 10) {
      const border = shores[i];

      const bx = this.game.x(border);
      const by = this.game.y(border);

      for (const [dx, dy] of directions) {
        const x1 = bx + dx;
        const y1 = by + dy;
        if (!this.game.isValidCoord(x1, y1)) continue;
        if (!this.game.isWater(this.game.ref(x1, y1))) continue;

        const nx = bx + dx * 5;
        const ny = by + dy * 5;
        if (!this.game.isValidCoord(nx, ny)) continue;
        const tile = this.game.ref(nx, ny);
        if (!this.game.isLand(tile)) continue;
        if (this.game.isImpassable(tile)) continue;
        if (this.game.hasOwner(tile)) continue;
        if (this.game.hasFallout(tile)) continue;
        const launch = canBuildTransportShip(this.game, this.player, tile);
        if (launch === false) continue;
        if (this.sail(launch, tile).blocker !== null) continue;
        return this.sendExpansionBoat(tile);
      }
    }
    return false;
  }

  // A boat to the free land at tile
  protected sendExpansionBoat(tile: TileRef): boolean {
    const troops = Math.min(this.player.troops() / 5, this.expansionTroopCap());
    if (troops < 1) return false;

    this.game.addExecution(
      new TransportShipExecution(this.player, tile, troops),
    );
    return true;
  }

  // Most troops an attack on free land may send
  protected expansionTroopCap(): number {
    return Infinity;
  }

  protected boatRoute(target: Player): BoatRoute | null {
    const known = this.boatRoutes?.get(target);
    if (known !== undefined) return known;
    const route = this.planBoatRoute(target);
    this.boatRoutes?.set(target, route);
    return route;
  }

  // The direct crossing, or if a warship blocks it, the shortest safe one landing elsewhere
  private planBoatRoute(target: Player): BoatRoute | null {
    if (
      this.game.config().isUnitDisabled(UnitType.TransportShip) ||
      this.player.unitCount(UnitType.TransportShip) >=
        this.game.config().boatMaxNumber()
    ) {
      return null;
    }
    const ours = this.shoreTiles(this.player);
    const theirs = this.shoreTiles(target);
    const closest = closestTwoTiles(this.game, ours, theirs);
    if (closest === null) return null;
    const warships = this.hostileWarships();
    const direct = this.routeTo(closest.y, warships);
    if (direct !== null && direct.blocker === null) return direct;

    let best: BoatRoute | null = null;
    for (const landing of this.otherLandings(
      ours,
      theirs,
      closest.y,
      warships,
    )) {
      const route = this.routeTo(landing, warships);
      if (
        route !== null &&
        route.blocker === null &&
        (best === null || route.length < best.length)
      ) {
        best = route;
      }
    }
    return best ?? direct;
  }

  // The launch follows from the landing: our shore closest to it by water
  private routeTo(landing: TileRef, warships: Unit[]): BoatRoute | null {
    const launch = canBuildTransportShip(this.game, this.player, landing);
    if (launch === false) return null;
    return { landing, ...this.sail(launch, landing, warships) };
  }

  // Landing spots on their coast apart from `tried` and clear of hostile warships, nearest to
  // our coast first: Medium tries 1, Hard 2, Impossible 4
  private otherLandings(
    ours: TileRef[],
    theirs: TileRef[],
    tried: TileRef,
    warships: Unit[],
  ): TileRef[] {
    const { difficulty } = this.game.config().gameConfig();
    let count: number;
    switch (difficulty) {
      case Difficulty.Easy:
        return [];
      case Difficulty.Medium:
        count = 1;
        break;
      case Difficulty.Hard:
        count = 2;
        break;
      case Difficulty.Impossible:
        count = 4;
        break;
      default:
        assertNever(difficulty);
    }
    const rangeSquared = this.dangerRange() ** 2;
    const ourStep = Math.max(1, Math.floor(ours.length / 32));
    const ourSample = ours.filter((_, i) => i % ourStep === 0);
    const candidates: { tile: TileRef; dist: number }[] = [];
    const theirStep = Math.max(1, Math.floor(theirs.length / 32));
    for (let i = 0; i < theirs.length; i += theirStep) {
      const tile = theirs[i];
      if (
        warships.some(
          (w) => this.game.euclideanDistSquared(w.tile(), tile) <= rangeSquared,
        )
      ) {
        continue;
      }
      let dist = Infinity;
      for (const s of ourSample) {
        dist = Math.min(dist, this.game.manhattanDist(s, tile));
      }
      candidates.push({ tile, dist });
    }
    candidates.sort((a, b) => a.dist - b.dist);
    const picked = [tried];
    for (const { tile } of candidates) {
      if (picked.length > count) break;
      if (picked.some((p) => this.game.manhattanDist(p, tile) < 50)) continue;
      picked.push(tile);
    }
    return picked.slice(1);
  }

  protected hostileWarships(): Unit[] {
    return this.game
      .units(UnitType.Warship)
      .filter(
        (w) =>
          w.owner() !== this.player &&
          !w.isUnderConstruction() &&
          w.warshipState().state !== "docked" &&
          w.owner().canAttackPlayer(this.player, true),
      );
  }

  // Warship targeting range, plus what it may move while our boat approaches
  protected dangerRange(): number {
    return this.game.config().warshipTargettingRange() + 20;
  }

  // Tiles a boat sails from launch to the shore at target, and the hostile warship that sinks it
  protected sail(
    launch: TileRef,
    target: TileRef,
    warships?: Unit[],
  ): { length: number; blocker: Unit | null } {
    const landing =
      targetTransportTile(this.game, this.player, target) ?? target;
    return { length: this.game.manhattanDist(launch, landing), blocker: null };
  }
}

const AiAttackStateSchema = z.object({
  botAttackTroopsSent: zNum(),
  followedLandings: z.array(zRef()),
  triggerRatio: zNum(),
  reserveRatio: zNum(),
  expandRatio: zNum(),
});
type AiAttackState = z.infer<typeof AiAttackStateSchema>;

export const AiAttackBehaviorSnapshot = snapshotType({
  name: "AiAttackBehavior",
  version: 2,
  schema: AiAttackStateSchema,
  migrations: {
    // v1 nations never followed up landings
    1: (d) => ({ ...d, followedLandings: [] }),
  },
});
