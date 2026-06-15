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
  nukeTier,
  selectInvasionNuke,
  warshipCount,
} from "./InvasionConfig";

/**
 * Drives "Invasion Mode": an escalating hostile horde that arrives by sea.
 *
 * A single long-lived execution (added once in `GameRunner.init()` when
 * `config.invasionMode()` is set). After the configured grace period it
 * launches periodic waves — each a fresh invader `Nation` on the shared
 * `Invaders` team, ferried in from a random map-edge water tile to a nearby
 * shore. Escort warships join from minute 2, and scheduled atom/hydrogen/MIRV
 * strikes begin at minutes 4/10/20 (shifted by difficulty). Once an invader
 * makes landfall it is handed a stock `NationExecution`, so it then builds and
 * attacks like any AI nation at the lobby difficulty.
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
  // Minimum manhattan distance an invader must travel before landfall.
  private minLandingDist = 0;

  private readonly invaders: PlayerInfo[] = [];
  private readonly aiAttached = new Set<PlayerID>();

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

    // Waves.
    if (this.nextWaveTick < 0) {
      this.nextWaveTick = ticks; // first wave fires immediately
    }
    if (ticks >= this.nextWaveTick) {
      this.launchWave(elapsed, difficulty);
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

  private launchWave(elapsed: number, difficulty: Difficulty): void {
    const src = this.pickEdgeWaterTile();
    if (src === null) return;
    const target = this.pickLandingShore(src);
    if (target === null) return;

    const troops = boatTroops(elapsed, difficulty);
    const info = this.createInvaderInfo();
    const invader = this.mg.addPlayer(info, ColoredTeams.Invaders);
    this.invaders.push(info);

    // The boat's troops are drawn from the player's pool on creation, so seed
    // the brand-new invader with exactly that many troops first.
    invader.addTroops(troops);
    this.mg.addExecution(
      new TransportShipExecution(invader, target, troops, src),
    );

    // Escort warships (weighted 0-3, only from minute 2 onward).
    if (!this.mg.config().isUnitDisabled(UnitType.Warship)) {
      const escorts = warshipCount(elapsed, this.random, difficulty);
      const patrol = this.waterNear(target) ?? src;
      for (let i = 0; i < escorts; i++) {
        const warship = invader.buildUnit(UnitType.Warship, src, {
          patrolTile: patrol,
        });
        this.mg.addExecution(new WarshipExecution(warship));
      }
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

  private waterNear(tile: TileRef): TileRef | null {
    const x = this.mg.x(tile);
    const y = this.mg.y(tile);
    const offsets = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [2, 0],
      [-2, 0],
      [0, 2],
      [0, -2],
    ];
    for (const [dx, dy] of offsets) {
      const nx = x + dx;
      const ny = y + dy;
      if (!this.mg.isValidCoord(nx, ny)) continue;
      const ref = this.mg.ref(nx, ny);
      if (this.mg.isWater(ref)) {
        return ref;
      }
    }
    return null;
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
