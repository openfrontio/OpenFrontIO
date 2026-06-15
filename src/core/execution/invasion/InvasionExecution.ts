import {
  ColoredTeams,
  Difficulty,
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
import { MirvExecution } from "../MIRVExecution";
import { NationExecution } from "../NationExecution";
import { NukeExecution } from "../NukeExecution";
import { PlayerExecution } from "../PlayerExecution";
import { TransportShipExecution } from "../TransportShipExecution";
import { WarshipExecution } from "../WarshipExecution";
import {
  boatIntervalTicks,
  boatTroops,
  bombIntervalTicks,
  maxInvaderNations,
  nukeTier,
  selectInvasionNuke,
  warshipCount,
} from "./InvasionConfig";

// Escort warships are released ~0.5s apart so they don't stack on the map.
const WARSHIP_STAGGER_TICKS = 5;

interface PendingEscort {
  fireTick: number;
  ownerId: PlayerID;
  spawnTile: TileRef;
  patrolTile: TileRef;
}

/**
 * Drives "Invasion Mode": an escalating hostile horde that arrives by sea.
 *
 * A single long-lived execution (added once in `GameRunner.init()` when
 * `config.invasionMode()` is set). After the configured grace period it
 * launches periodic waves — boats ferried in from a random map-edge water tile
 * to a nearby shore. The number of distinct invader `Nation`s (all on the
 * shared `Invaders` team) is capped by difficulty; once that cap is reached,
 * existing invaders send additional boats (up to `boatMaxNumber` each) instead
 * of new nations spawning. Escort warships join from minute 2, and scheduled
 * atom/hydrogen/MIRV strikes begin at minutes 4/10/20 (shifted by difficulty).
 * Once an invader makes landfall it is handed a stock `NationExecution`, so it
 * then builds and attacks like any AI nation at the lobby difficulty.
 *
 * Determinism: all randomness comes from a single seeded `PseudoRandom`; the
 * escalation clock is derived from integer tick counts.
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
  private nextBombTick = -1;
  private invaderCounter = 0;
  private wavesLaunched = 0;
  // Minimum manhattan distance an invader must travel before landfall.
  private minLandingDist = 0;

  private readonly invaders: PlayerInfo[] = [];
  private readonly aiAttached = new Set<PlayerID>();
  private readonly pendingEscorts: PendingEscort[] = [];

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

    const difficulty = this.mg.config().gameConfig().difficulty;

    // Bring landed invaders to life: per-player upkeep + normal nation AI.
    this.activateLandedInvaders();

    // Release any escort warships whose staggered launch tick has arrived.
    this.processPendingEscorts(ticks);

    // Waves.
    if (this.nextWaveTick < 0) {
      this.nextWaveTick = ticks; // first wave fires immediately
    }
    if (ticks >= this.nextWaveTick) {
      this.launchWave(ticks, elapsed, difficulty);
      this.nextWaveTick = ticks + boatIntervalTicks(elapsed, difficulty);
    }

    // Scheduled bombardment, once the tier is unlocked.
    if (nukeTier(elapsed, difficulty) !== "none") {
      if (this.nextBombTick < 0) {
        this.nextBombTick = ticks; // first strike as soon as unlocked
      }
      if (ticks >= this.nextBombTick) {
        this.launchBomb(elapsed, difficulty);
        this.nextBombTick = ticks + bombIntervalTicks(elapsed, difficulty);
      }
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

  private launchWave(
    ticks: number,
    elapsed: number,
    difficulty: Difficulty,
  ): void {
    // Resolve the route before committing a launcher, so a failed geometry
    // lookup doesn't leave a freshly-created invader stranded with no boat.
    const src = this.pickEdgeWaterTile();
    if (src === null) return;
    const target = this.pickLandingShore(src);
    if (target === null) return;

    const launcher = this.selectWaveLauncher(difficulty);
    if (launcher === null) return;

    const troops = boatTroops(elapsed, difficulty, this.wavesLaunched);
    // The boat's troops are drawn from the player's pool on creation, so top
    // the launcher up by exactly that many troops first.
    launcher.addTroops(troops);
    this.mg.addExecution(
      new TransportShipExecution(launcher, target, troops, src),
    );
    this.wavesLaunched++;

    // Escort warships (weighted 0-3, only from minute 2 onward). They are
    // released ~0.5s apart, each heading to a slightly different point near the
    // landing, so they read as an escort rather than a stacked convoy.
    if (!this.mg.config().isUnitDisabled(UnitType.Warship)) {
      const escorts = warshipCount(elapsed, this.random, difficulty);
      const ownerId = launcher.id();
      for (let i = 0; i < escorts; i++) {
        this.pendingEscorts.push({
          fireTick: ticks + i * WARSHIP_STAGGER_TICKS,
          ownerId,
          spawnTile: this.randomWaterNear(src, 3),
          patrolTile: this.randomWaterNear(target, 6),
        });
      }
    }
  }

  /**
   * Chooses who launches the next wave: a brand-new invader nation while below
   * the difficulty cap, otherwise an existing active invader that still has room
   * for another boat. Returns null if every invader is at its boat limit.
   */
  private selectWaveLauncher(difficulty: Difficulty): Player | null {
    const active = this.invaders.filter((info) => this.isActiveInvader(info));
    if (active.length < maxInvaderNations(difficulty)) {
      const info = this.createInvaderInfo();
      const invader = this.mg.addPlayer(info, ColoredTeams.Invaders);
      this.invaders.push(info);
      return invader;
    }
    const boatMax = this.mg.config().boatMaxNumber();
    const candidates = active
      .map((info) => this.mg.player(info.id))
      .filter((p) => p.unitCount(UnitType.TransportShip) < boatMax);
    if (candidates.length === 0) return null;
    return this.random.randElement(candidates);
  }

  /** An invader still in play: landed (alive) or with a boat still inbound. */
  private isActiveInvader(info: PlayerInfo): boolean {
    if (!this.mg.hasPlayer(info.id)) return false;
    const player = this.mg.player(info.id);
    return player.isAlive() || player.unitCount(UnitType.TransportShip) > 0;
  }

  private processPendingEscorts(ticks: number): void {
    if (this.pendingEscorts.length === 0) return;
    if (this.mg.config().isUnitDisabled(UnitType.Warship)) {
      this.pendingEscorts.length = 0;
      return;
    }
    for (let i = this.pendingEscorts.length - 1; i >= 0; i--) {
      const escort = this.pendingEscorts[i];
      if (ticks < escort.fireTick) continue;
      this.pendingEscorts.splice(i, 1);
      if (!this.mg.hasPlayer(escort.ownerId)) continue;
      const owner = this.mg.player(escort.ownerId);
      const warship = owner.buildUnit(UnitType.Warship, escort.spawnTile, {
        patrolTile: escort.patrolTile,
      });
      this.mg.addExecution(new WarshipExecution(warship));
    }
  }

  private launchBomb(elapsed: number, difficulty: Difficulty): void {
    const choice = selectInvasionNuke(elapsed, this.random, difficulty);
    if (choice === null) return;

    const nukeType =
      choice === "atom"
        ? UnitType.AtomBomb
        : choice === "hydrogen"
          ? UnitType.HydrogenBomb
          : UnitType.MIRV;
    if (this.mg.config().isUnitDisabled(nukeType)) return;

    const launcher = this.pickLaunchInvader();
    if (launcher === null) return;
    const dst = this.pickEnemyLandTarget();
    if (dst === null) return;

    // A launch needs a usable missile silo and enough gold for the warhead.
    // Gold is clamped to >= 0 on spend, so fund the strike explicitly.
    if (!this.ensureSilo(launcher)) return;
    launcher.addGold(this.mg.unitInfo(nukeType).cost(this.mg, launcher));

    if (choice === "mirv") {
      this.mg.addExecution(new MirvExecution(launcher, dst));
    } else {
      this.mg.addExecution(new NukeExecution(nukeType, launcher, dst));
    }
  }

  /** Ensure the launcher has an immediately-usable missile silo. */
  private ensureSilo(player: Player): boolean {
    if (this.mg.config().isUnitDisabled(UnitType.MissileSilo)) {
      return false;
    }
    const hasUsable = player
      .units(UnitType.MissileSilo)
      .some(
        (s) => s.isActive() && !s.isInCooldown() && !s.isUnderConstruction(),
      );
    if (hasUsable) return true;
    const tile = this.firstOwnedTile(player);
    if (tile === null) return false;
    // Built directly (not via ConstructionExecution) so it is usable at once.
    player.buildUnit(UnitType.MissileSilo, tile, {});
    return true;
  }

  private pickLaunchInvader(): Player | null {
    const candidates: Player[] = [];
    for (const info of this.invaders) {
      if (!this.mg.hasPlayer(info.id)) continue;
      const player = this.mg.player(info.id);
      if (player.isAlive() && player.tiles().size > 0) {
        candidates.push(player);
      }
    }
    if (candidates.length === 0) return null;
    return this.random.randElement(candidates);
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
   * A water tile randomly offset within `radius` of `center`, so staggered
   * escorts spawn and patrol at spread-out points rather than the same tile.
   * Falls back to `center` if no nearby water is found.
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

  private firstOwnedTile(player: Player): TileRef | null {
    for (const tile of player.tiles()) {
      return tile;
    }
    return null;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
