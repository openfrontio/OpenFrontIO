import {
  ColoredTeams,
  Execution,
  Game,
  Nation,
  Player,
  PlayerID,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../../game/Game";
import { TileRef } from "../../game/GameMap";
import { PseudoRandom } from "../../PseudoRandom";
import { GameID } from "../../Schemas";
import { simpleHash } from "../../Util";
import { NationExecution } from "../NationExecution";
import { NukeExecution } from "../NukeExecution";
import { PlayerExecution } from "../PlayerExecution";
import { TransportShipExecution } from "../TransportShipExecution";
import { WarshipExecution } from "../WarshipExecution";
import {
  boatIntervalTicks,
  boatTroops,
  INVADER_BOAT_MAX,
  invaderStartingGold,
  InvasionNuke,
  MAX_INVADER_NATIONS,
  selectInvasionStrike,
  warshipCount,
} from "./InvasionConfig";

// Formation geometry (tiles), measured from the transport's spawn tile toward
// the landing shore. The lead escort sits ahead; flankers sit out to either
// side and slightly forward, so a wave reads as an arrowhead.
const FRONT_DIST = 6;
const FLANK_SIDE = 4;
const FLANK_FORWARD = 2;

// Formation timing (ticks; 10 ticks = 1s). Escorts deploy first and the
// transport follows so the wave assembles into formation before advancing.
const FLANK_DELAY = 10; // 1s after the lead escort (3-warship waves)
const TRANSPORT_DELAY_ESCORTED = 20; // 2s after escorts (1- and 2-warship waves)
const TRANSPORT_DELAY_TRIPLE = 30; // 1s + 2s after the lead (3-warship waves)

interface PendingWarship {
  kind: "warship";
  fireTick: number;
  ownerId: PlayerID;
  spawnTile: TileRef;
  patrolTile: TileRef;
}

interface PendingTransport {
  kind: "transport";
  fireTick: number;
  ownerId: PlayerID;
  spawnTile: TileRef;
  target: TileRef;
  troops: number;
  strike: InvasionNuke[];
}

type PendingSpawn = PendingWarship | PendingTransport;

/**
 * Drives "Invasion Mode": an escalating hostile horde that arrives by sea.
 *
 * A single long-lived execution (added once in `GameRunner.init()` when
 * `config.invasionMode()` is set). After the grace period it launches periodic
 * waves — boats ferried from a random map-edge water tile to a nearby shore,
 * arriving in an escorted formation. Up to `MAX_INVADER_NATIONS` distinct
 * invader `Nation`s (all on the shared `Invaders` team) exist at once; beyond
 * that cap existing invaders send extra boats (up to `INVADER_BOAT_MAX` each).
 * Every boat may launch a missile strike straight from its open-water spawn
 * tile the instant it appears, with intensity rising over time. Once an invader
 * makes landfall it is handed a stock `NationExecution`, so it then builds and
 * attacks like any AI nation.
 *
 * The invasion ignores the lobby `Difficulty` entirely — there is one ever-
 * escalating curve. Determinism: all randomness comes from a single seeded
 * `PseudoRandom`; the escalation clock is derived from integer tick counts.
 */
export class InvasionExecution implements Execution {
  private active = true;
  private mg: Game;
  private random: PseudoRandom;

  // Tick (absolute) at which the invasion clock starts, i.e. the first
  // post-spawn-phase tick. The grace period is measured from here.
  private startTick = -1;
  private graceTicks = 0;
  private nextWaveTick = -1;
  private invaderCounter = 0;
  private wavesLaunched = 0;
  // Minimum manhattan distance an invader must travel before landfall.
  private minLandingDist = 0;

  private readonly invaders: PlayerInfo[] = [];
  private readonly aiAttached = new Set<PlayerID>();
  private readonly pendingSpawns: PendingSpawn[] = [];

  constructor(private gameID: GameID) {
    this.random = new PseudoRandom(simpleHash(gameID) + 7919);
  }

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.graceTicks = mg.config().invasionGracePeriodTicks();
    // Far enough that the boat must visibly travel, scaled to the map but
    // capped so huge maps don't send boats on endless voyages.
    this.minLandingDist = Math.max(
      8,
      Math.min(400, Math.floor(Math.min(mg.width(), mg.height()) * 0.18)),
    );
  }

  tick(ticks: number): void {
    if (this.startTick < 0) {
      this.startTick = ticks;
    }
    const elapsed = ticks - this.startTick - this.graceTicks;
    if (elapsed < 0) {
      // Still within the grace period.
      return;
    }

    // Bring landed invaders to life: per-player upkeep + normal nation AI.
    this.activateLandedInvaders();

    // Release any formation spawns whose scheduled tick has arrived.
    this.processPendingSpawns(ticks);

    // Waves.
    if (this.nextWaveTick < 0) {
      this.nextWaveTick = ticks; // first wave fires immediately
    }
    if (ticks >= this.nextWaveTick) {
      this.launchWave(ticks, elapsed);
      this.nextWaveTick = ticks + boatIntervalTicks(elapsed);
    }
  }

  private activateLandedInvaders(): void {
    for (const info of this.invaders) {
      if (this.aiAttached.has(info.id)) continue;
      if (!this.mg.hasPlayer(info.id)) continue;
      const player = this.mg.player(info.id);
      // Wait for landfall: PlayerExecution removes a landless player at once,
      // and NationExecution self-deactivates post-spawn without territory.
      if (!player.isAlive()) continue;
      // PlayerExecution drives upkeep (income, troop growth, death handling)
      // — normally added by SpawnExecution, which invaders never go through.
      this.mg.addExecution(new PlayerExecution(player));
      this.mg.addExecution(
        new NationExecution(this.gameID, new Nation(undefined, info)),
      );
      this.aiAttached.add(info.id);
    }
  }

  private launchWave(ticks: number, elapsed: number): void {
    // Resolve the route before committing a launcher, so a failed geometry
    // lookup doesn't leave a freshly-created invader stranded with no boat.
    const src = this.pickEdgeWaterTile();
    if (src === null) return;
    const target = this.pickLandingShore(src);
    if (target === null) return;

    const launcher = this.selectWaveLauncher(elapsed);
    if (launcher === null) return;
    const ownerId = launcher.id();

    const warships = this.mg.config().isUnitDisabled(UnitType.Warship)
      ? 0
      : warshipCount(this.random);

    // Schedule the escort formation, then the transport behind it. Each boat
    // rolls its own missile package, fired from its spawn tile on arrival.
    const transportDelay = this.scheduleEscorts(
      ticks,
      ownerId,
      src,
      target,
      warships,
    );
    this.pendingSpawns.push({
      kind: "transport",
      fireTick: ticks + transportDelay,
      ownerId,
      spawnTile: src,
      target,
      troops: boatTroops(elapsed, this.wavesLaunched),
      strike: this.mg.config().isUnitDisabled(UnitType.AtomBomb)
        ? []
        : selectInvasionStrike(elapsed, this.random),
    });
    this.wavesLaunched++;
  }

  /**
   * Queues the escort warships for a wave and returns how long (ticks) to delay
   * the transport so it slots in behind the assembled formation.
   *
   * - 1 escort: a single lead boat out front.
   * - 2 escorts: a flanker on each side of the transport's spawn.
   * - 3 escorts: a lead boat, then the two flankers 1s later.
   */
  private scheduleEscorts(
    ticks: number,
    ownerId: PlayerID,
    src: TileRef,
    target: TileRef,
    warships: number,
  ): number {
    const escort = (fireTick: number, spawnTile: TileRef) =>
      this.pendingSpawns.push({
        kind: "warship",
        fireTick,
        ownerId,
        spawnTile,
        patrolTile: this.randomWaterNear(target, 6),
      });

    switch (warships) {
      case 0:
        return 0;
      case 1:
        escort(ticks, this.formationTile(src, target, FRONT_DIST, 0));
        return TRANSPORT_DELAY_ESCORTED;
      case 2:
        escort(
          ticks,
          this.formationTile(src, target, FLANK_FORWARD, FLANK_SIDE),
        );
        escort(
          ticks,
          this.formationTile(src, target, FLANK_FORWARD, -FLANK_SIDE),
        );
        return TRANSPORT_DELAY_ESCORTED;
      default: {
        escort(ticks, this.formationTile(src, target, FRONT_DIST, 0));
        const flankTick = ticks + FLANK_DELAY;
        escort(
          flankTick,
          this.formationTile(src, target, FLANK_FORWARD, FLANK_SIDE),
        );
        escort(
          flankTick,
          this.formationTile(src, target, FLANK_FORWARD, -FLANK_SIDE),
        );
        return TRANSPORT_DELAY_TRIPLE;
      }
    }
  }

  private processPendingSpawns(ticks: number): void {
    if (this.pendingSpawns.length === 0) return;
    for (let i = this.pendingSpawns.length - 1; i >= 0; i--) {
      const spawn = this.pendingSpawns[i];
      if (ticks < spawn.fireTick) continue;
      this.pendingSpawns.splice(i, 1);
      if (!this.mg.hasPlayer(spawn.ownerId)) continue;
      const owner = this.mg.player(spawn.ownerId);
      if (spawn.kind === "warship") {
        if (this.mg.config().isUnitDisabled(UnitType.Warship)) continue;
        const warship = owner.buildUnit(UnitType.Warship, spawn.spawnTile, {
          patrolTile: spawn.patrolTile,
        });
        this.mg.addExecution(new WarshipExecution(warship));
      } else {
        // The boat's troops are drawn from the player's pool on creation, so top
        // the launcher up by exactly that many troops first.
        owner.addTroops(spawn.troops);
        this.mg.addExecution(
          new TransportShipExecution(
            owner,
            spawn.target,
            spawn.troops,
            spawn.spawnTile,
          ),
        );
        // Missiles launch from the very tile the boat spawned at.
        this.launchStrike(owner, spawn.spawnTile, spawn.strike);
      }
    }
  }

  /**
   * Fires a boat's missile package from its open-water spawn tile. Each warhead
   * targets independently so an atom barrage rains across enemy territory. The
   * launcher is funded exactly for each warhead (its starting gold — the prize
   * for conquering it — is left intact).
   */
  private launchStrike(
    owner: Player,
    srcTile: TileRef,
    strike: InvasionNuke[],
  ): void {
    for (const nuke of strike) {
      const type = nuke === "atom" ? UnitType.AtomBomb : UnitType.HydrogenBomb;
      if (this.mg.config().isUnitDisabled(type)) continue;
      const dst = this.pickEnemyLandTarget();
      if (dst === null) return;
      owner.addGold(this.mg.unitInfo(type).cost(this.mg, owner));
      this.mg.addExecution(
        new NukeExecution(type, owner, dst, srcTile, -1, 0, true, true),
      );
    }
  }

  /**
   * Chooses who launches the next wave: a brand-new invader nation while below
   * the cap, otherwise an existing active invader that still has room for
   * another boat. Returns null if every invader is at its boat limit.
   */
  private selectWaveLauncher(elapsed: number): Player | null {
    const active = this.invaders.filter((info) => this.isActiveInvader(info));
    if (active.length < MAX_INVADER_NATIONS) {
      const info = this.createInvaderInfo();
      const invader = this.mg.addPlayer(info, ColoredTeams.Invaders);
      // Set the prize pot precisely, independent of the lobby "starting gold".
      invader.removeGold(invader.gold());
      invader.addGold(invaderStartingGold(elapsed));
      this.invaders.push(info);
      return invader;
    }
    const candidates = active
      .map((info) => this.mg.player(info.id))
      .filter((p) => this.boatLoad(p) < INVADER_BOAT_MAX);
    if (candidates.length === 0) return null;
    return this.random.randElement(candidates);
  }

  /** Boats a player currently has in play: in flight plus scheduled to spawn. */
  private boatLoad(player: Player): number {
    let pending = 0;
    for (const spawn of this.pendingSpawns) {
      if (spawn.kind === "transport" && spawn.ownerId === player.id())
        pending++;
    }
    return player.unitCount(UnitType.TransportShip) + pending;
  }

  /** An invader still in play: landed (alive), boat inbound, or boat pending. */
  private isActiveInvader(info: PlayerInfo): boolean {
    if (!this.mg.hasPlayer(info.id)) return false;
    const player = this.mg.player(info.id);
    if (player.isAlive() || player.unitCount(UnitType.TransportShip) > 0) {
      return true;
    }
    return this.pendingSpawns.some(
      (s) => s.kind === "transport" && s.ownerId === info.id,
    );
  }

  private createInvaderInfo(): PlayerInfo {
    this.invaderCounter++;
    return new PlayerInfo(
      `Invader ${this.invaderCounter}`,
      PlayerType.Nation,
      null,
      this.random.nextID(),
    );
  }

  /** Random map-edge tile that is water. */
  private pickEdgeWaterTile(): TileRef | null {
    const w = this.mg.width();
    const h = this.mg.height();
    for (let i = 0; i < 500; i++) {
      let x: number;
      let y: number;
      switch (this.random.nextInt(0, 4)) {
        case 0:
          x = this.random.nextInt(0, w);
          y = 0;
          break;
        case 1:
          x = this.random.nextInt(0, w);
          y = h - 1;
          break;
        case 2:
          x = 0;
          y = this.random.nextInt(0, h);
          break;
        default:
          x = w - 1;
          y = this.random.nextInt(0, h);
          break;
      }
      const ref = this.mg.ref(x, y);
      if (this.mg.isWater(ref)) {
        return ref;
      }
    }
    return null;
  }

  /**
   * Nearest ocean shore beyond `minLandingDist` from `src`, sampled randomly —
   * "closest, but not immediately near it" so the boat must travel first.
   */
  private pickLandingShore(src: TileRef): TileRef | null {
    let best: TileRef | null = null;
    let bestDist = Number.MAX_SAFE_INTEGER;
    let found = 0;
    for (let i = 0; i < 800 && found < 40; i++) {
      const x = this.random.nextInt(0, this.mg.width());
      const y = this.random.nextInt(0, this.mg.height());
      const ref = this.mg.ref(x, y);
      if (!this.mg.isOceanShore(ref)) continue;
      const dist = this.mg.manhattanDist(src, ref);
      if (dist < this.minLandingDist) continue;
      found++;
      if (dist < bestDist) {
        bestDist = dist;
        best = ref;
      }
    }
    return best;
  }

  private pickEnemyLandTarget(): TileRef | null {
    for (let i = 0; i < 400; i++) {
      const x = this.random.nextInt(0, this.mg.width());
      const y = this.random.nextInt(0, this.mg.height());
      const ref = this.mg.ref(x, y);
      if (!this.mg.isLand(ref)) continue;
      const owner = this.mg.owner(ref);
      if (!owner.isPlayer()) continue;
      if ((owner as Player).team() === ColoredTeams.Invaders) continue;
      return ref;
    }
    return null;
  }

  /**
   * A water tile `forward` tiles toward `target` and `side` tiles perpendicular
   * (positive = left of the heading) from `src`, snapped to the nearest water.
   * Used to place escorts into an arrowhead formation around the transport.
   */
  private formationTile(
    src: TileRef,
    target: TileRef,
    forward: number,
    side: number,
  ): TileRef {
    const sx = this.mg.x(src);
    const sy = this.mg.y(src);
    let ux = this.mg.x(target) - sx;
    let uy = this.mg.y(target) - sy;
    const len = Math.sqrt(ux * ux + uy * uy);
    if (len > 0) {
      ux /= len;
      uy /= len;
    } else {
      ux = 0;
      uy = -1;
    }
    // Perpendicular (rotate the heading 90°): left of travel.
    const px = -uy;
    const py = ux;
    const tx = Math.round(sx + ux * forward + px * side);
    const ty = Math.round(sy + uy * forward + py * side);
    return this.nearestWater(tx, ty, src);
  }

  /** Nearest water tile to (cx, cy) via an expanding ring search. */
  private nearestWater(cx: number, cy: number, fallback: TileRef): TileRef {
    for (let r = 0; r <= 6; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const nx = cx + dx;
          const ny = cy + dy;
          if (!this.mg.isValidCoord(nx, ny)) continue;
          const ref = this.mg.ref(nx, ny);
          if (this.mg.isWater(ref)) return ref;
        }
      }
    }
    return fallback;
  }

  /**
   * A water tile randomly offset within `radius` of `center`, so escorts patrol
   * at spread-out points rather than the same tile. Falls back to `center`.
   */
  private randomWaterNear(center: TileRef, radius: number): TileRef {
    const cx = this.mg.x(center);
    const cy = this.mg.y(center);
    for (let i = 0; i < 20; i++) {
      const nx = cx + this.random.nextInt(-radius, radius + 1);
      const ny = cy + this.random.nextInt(-radius, radius + 1);
      if (!this.mg.isValidCoord(nx, ny)) continue;
      const ref = this.mg.ref(nx, ny);
      if (this.mg.isWater(ref)) {
        return ref;
      }
    }
    return center;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
