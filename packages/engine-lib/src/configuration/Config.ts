import {
  Difficulty,
  GameType,
  PlayerType,
  Tick,
  UnitInfo,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { PlayerLike } from "@openfront/engine-api/game/ReadViews";
import { GameConfig } from "@openfront/engine-api/Schemas";
import { pow } from "../DetMath";
import { DoomsdayClockSpeed } from "../game/DoomsdayClock";
import { assertNever } from "../Util";

export interface NukeMagnitude {
  inner: number;
  outer: number;
}

const DEFAULT_SPAWN_IMMUNITY_TICKS = 5 * 10;

/** SAM launcher construction duration in ticks (non-instant-build). */
export const SAM_CONSTRUCTION_TICKS = 30 * 10;

// Doomsday Clock tunables (anti-stall). Off unless enabled in GameConfig.
// Times in seconds. The required map share rises in waves (levels + times in
// DoomsdayClock.ts, chosen by `speed`). A side caught below the bar gets a
// warnSeconds cooldown ("Danger, decay in Xs"), then troops bleed DOWN TO A
// FLOOR (drainFloorPercent of max), not to zero: the warn (30s) + the linear
// drain (~90s from full troops, sooner with fewer troops or a shrinking
// territory) make ~2 minutes from caught to the floor. A doomed side is crippled
// to 5% of max, not eliminated, so a brief dip below the bar is recoverable (the
// drain stops the moment it climbs back); the rising bar still guarantees a
// finish by squeezing territory and leaving the doomed side easy to conquer.
const DOOMSDAY_CLOCK_DEFAULTS = {
  enabled: false,
  speed: "normal" as DoomsdayClockSpeed,
  warnSeconds: 30, // cooldown (the flashing danger cue) before decay begins
  drainStartPercent: 2, // starts bleeding at once (already beats troop income)
  drainMaxPercent: 5,
  drainRampSeconds: 90, // ramps LINEARLY to the max over this long
  drainFloorPercent: 5, // drain settles here: crippled to 5% of max, never wiped
  // The floor decays start -> drainFloorPercent over floorDecaySeconds, leaving
  // one comeback window with a usable army. It must not be permanent: maxTroops is
  // sublinear (~100k at one tile), so a fixed 40% is ~40k troops on a single tile.
  floorStartPercent: 40,
  floorDecaySeconds: 90,
  // TERRITORY ROT — the finisher, since the drain never kills. rotDeathSeconds is
  // a DEADLINE, not a rate: the territory is gone this long after the skull
  // appeared, whatever it holds. 0 disables rot. Timeline:
  //
  //   0s    skull blinks, warn countdown
  //   30s   skull steady, troops draining              (warnSeconds)
  //   120s  floor at 5%, territory rotting, skull RED  (warn + floorDecay)
  //   150s  nothing left, eliminated                   (rotDeathSeconds)
  rotDeathSeconds: 150,
  // Grainy opening: pinholes across this share of the territory before the holes
  // grow together. Held to a third of the rot window, so shortening the window
  // shortens this too: at 20s the speckle WAS the death rather than its opening.
  rotGrainSeconds: 10,
  rotSpecklePercent: 15,
  // Warships bleed on their OWN gentler start + a STEEP (convex) ramp to a much
  // higher ceiling. A ship caught when its side is first doomed lasts about as
  // long as troops (the low start + no income ≈ the troop net rate), but the rate
  // curves up sharply (warshipDrainCurveExponent), so once a side has been under
  // the clock the full ramp, ships drop to the same floor in ~2s (50%/s), not
  // sunk. Ships only.
  warshipDrainStartPercent: 1,
  warshipDrainMaxPercent: 50,
  warshipDrainCurveExponent: 8, // >1 = convex: stays gentle early, then spikes
};

// Share of the land a side must hold to win, in every game mode.
const PERCENT_TILES_OWNED_TO_WIN = 80;

// Overtime tunables (anti-stalemate). Off unless enabled in GameConfig.
// After startMinutes the percentage of tiles required to win falls from the
// base by dropPercentPerMinute, with no floor: the bar keeps sinking until the
// leading side crosses it, so a stalled game always ends. Only `enabled` and
// `startMinutes` are wire-configurable.
const OVERTIME_DEFAULTS = {
  enabled: false,
  startMinutes: 30,
  dropPercentPerMinute: 2,
};

export class Config {
  private unitInfoCache = new Map<UnitType, UnitInfo>();
  constructor(
    protected _gameConfig: GameConfig,
    private _isReplay: boolean,
    public readonly listed: boolean = false,
    private _spectator: boolean = false,
  ) {}

  isReplay(): boolean {
    return this._isReplay;
  }

  /** True when the player joined the lobby as a spectator (watch-only). */
  isIntentionalSpectator(): boolean {
    return this._spectator;
  }

  traitorDefenseDebuff(): number {
    return 0.5;
  }
  traitorDuration(): number {
    return 30 * 10; // 30 seconds
  }

  // Doomsday Clock config, resolved against defaults. One read per tick.
  doomsdayClockConfig(): typeof DOOMSDAY_CLOCK_DEFAULTS {
    const c = this._gameConfig.doomsdayClock;
    const d = DOOMSDAY_CLOCK_DEFAULTS;
    return {
      enabled: c?.enabled ?? d.enabled,
      speed: c?.speed ?? d.speed,
      // Drain/warn tuning is internal (not wire-configurable): always defaults.
      warnSeconds: d.warnSeconds,
      drainStartPercent: d.drainStartPercent,
      drainMaxPercent: d.drainMaxPercent,
      drainRampSeconds: d.drainRampSeconds,
      drainFloorPercent: d.drainFloorPercent,
      floorStartPercent: d.floorStartPercent,
      floorDecaySeconds: d.floorDecaySeconds,
      rotDeathSeconds: d.rotDeathSeconds,
      rotGrainSeconds: d.rotGrainSeconds,
      rotSpecklePercent: d.rotSpecklePercent,
      warshipDrainStartPercent: d.warshipDrainStartPercent,
      warshipDrainMaxPercent: d.warshipDrainMaxPercent,
      warshipDrainCurveExponent: d.warshipDrainCurveExponent,
    };
  }
  // Overtime config, resolved against defaults.
  overtimeConfig(): typeof OVERTIME_DEFAULTS {
    const c = this._gameConfig.overtime;
    const d = OVERTIME_DEFAULTS;
    return {
      enabled: c?.enabled ?? d.enabled,
      startMinutes: c?.startMinutes ?? d.startMinutes,
      // The drop rate is internal (not wire-configurable): always the default.
      dropPercentPerMinute: d.dropPercentPerMinute,
    };
  }
  spawnImmunityDuration(): Tick {
    return (
      this._gameConfig.spawnImmunityDuration ?? DEFAULT_SPAWN_IMMUNITY_TICKS
    );
  }
  nationSpawnImmunityDuration(): Tick {
    return DEFAULT_SPAWN_IMMUNITY_TICKS;
  }
  hasExtendedSpawnImmunity(): boolean {
    return this.spawnImmunityDuration() > DEFAULT_SPAWN_IMMUNITY_TICKS;
  }

  gameConfig(): GameConfig {
    return this._gameConfig;
  }

  cityTroopIncrease(): number {
    return 250_000;
  }
  msPerTick(): number {
    return 100;
  }
  SAMCooldown(): number {
    return 90;
  }
  SiloCooldown(): number {
    return 90;
  }

  defensePostRange(): number {
    return 30;
  }

  isUnitDisabled(unitType: UnitType): boolean {
    return this._gameConfig.disabledUnits?.includes(unitType) ?? false;
  }
  instantBuild(): boolean {
    return this._gameConfig.instantBuild;
  }
  disableAlliances(): boolean {
    // customAllianceDuration === 0 disables alliances (the "custom alliances"
    // control at 0). The legacy boolean is still honored for older configs.
    return (
      this._gameConfig.customAllianceDuration === 0 ||
      (this._gameConfig.disableAlliances ?? false)
    );
  }
  isRandomSpawn(): boolean {
    return this._gameConfig.randomSpawn;
  }
  infiniteTroops(): boolean {
    return this._gameConfig.infiniteTroops;
  }
  donateTroops(): boolean {
    return this._gameConfig.donateTroops;
  }
  trainStationMaxRange(): number {
    return 110;
  }

  unitInfo(type: UnitType): UnitInfo {
    const cached = this.unitInfoCache.get(type);
    if (cached !== undefined) {
      return cached;
    }

    let info: UnitInfo;
    switch (type) {
      case UnitType.Warship:
        info = { maxHealth: 1000 };
        break;
      case UnitType.Shell:
        info = { damage: 250 };
        break;
      case UnitType.Port:
        info = {
          constructionDuration: this.instantBuild() ? 0 : 5 * 10,
          upgradable: true,
        };
        break;
      case UnitType.MissileSilo:
        info = {
          constructionDuration: this.instantBuild() ? 0 : 10 * 10,
          upgradable: true,
        };
        break;
      case UnitType.DefensePost:
        info = { constructionDuration: this.instantBuild() ? 0 : 5 * 10 };
        break;
      case UnitType.SAMLauncher:
        info = {
          constructionDuration: this.instantBuild()
            ? 0
            : SAM_CONSTRUCTION_TICKS,
          upgradable: true,
        };
        break;
      case UnitType.City:
      case UnitType.Factory:
      case UnitType.OilMine:
      case UnitType.GoldMine:
      case UnitType.DiamondMine:
        info = {
          constructionDuration: this.instantBuild() ? 0 : 2 * 10,
          upgradable: true,
        };
        break;
      case UnitType.TransportShip:
      case UnitType.SAMMissile:
      case UnitType.AtomBomb:
      case UnitType.HydrogenBomb:
      case UnitType.MIRV:
      case UnitType.MIRVWarhead:
      case UnitType.TradeShip:
      case UnitType.Train:
        info = {};
        break;
      default:
        assertNever(type);
    }

    this.unitInfoCache.set(type, info);
    return info;
  }

  private hasInfiniteTroopsFor(player: PlayerLike): boolean {
    if (this.infiniteTroops()) return true;
    return (
      (this._gameConfig.hostCheats?.infiniteTroops ?? false) &&
      player.isLobbyCreator()
    );
  }
  deletionMarkDuration(): Tick {
    return 30 * 10;
  }

  deleteUnitCooldown(): Tick {
    return 30 * 10;
  }
  allianceRequestDuration(): Tick {
    return 20 * 10;
  }
  allianceDuration(): Tick {
    // Host can set a custom alliance duration in minutes (1-15); 0 disables
    // alliances (see disableAlliances). Falls back to the 5 minute default.
    const m = this._gameConfig.customAllianceDuration;
    if (typeof m === "number" && m > 0) return m * 60 * 10;
    return 300 * 10; // 5 minutes.
  }

  percentageTilesOwnedToWin(elapsedGameSeconds: number): number {
    const base = PERCENT_TILES_OWNED_TO_WIN;
    const sd = this.overtimeConfig();
    if (!sd.enabled) {
      return base;
    }
    // Whole seconds only: elapsedGameSeconds is ticks/10 and can carry a
    // fractional part. The bar moves in WHOLE percentage points (one step
    // every 60/dropPercentPerMinute seconds), so the HUD shows exactly the
    // integer the sim checks — and integer math is trivially deterministic.
    const secondsPastStart =
      Math.floor(elapsedGameSeconds) - sd.startMinutes * 60;
    if (secondsPastStart <= 0) {
      return base;
    }
    return Math.max(
      0,
      base - Math.floor((secondsPastStart * sd.dropPercentPerMinute) / 60),
    );
  }
  armyLimitWarningThreshold(): number {
    return 0.8;
  }
  numSpawnPhaseTurns(): number {
    if (this._gameConfig.gameType === GameType.Singleplayer) {
      return 100;
    }
    if (this.isRandomSpawn()) {
      return 150;
    }
    return 200;
  }

  maxTroops(player: PlayerLike): number {
    const maxTroops =
      player.type() === PlayerType.Human && this.hasInfiniteTroopsFor(player)
        ? 1_000_000_000
        : 2 * (pow(player.numTilesOwned(), 0.6) * 1000 + 50000) +
          player
            .units(UnitType.City)
            .filter((u) => !u.isUnderConstruction())
            .map((city) => city.level())
            .reduce((a, b) => a + b, 0) *
            this.cityTroopIncrease();

    if (player.type() === PlayerType.Bot) {
      return maxTroops / 3;
    }

    if (player.type() === PlayerType.Human) {
      return maxTroops;
    }

    switch (this._gameConfig.difficulty) {
      case Difficulty.Easy:
        return maxTroops * 0.5;
      case Difficulty.Medium:
        return maxTroops * 0.75;
      case Difficulty.Hard:
        return maxTroops * 1; // Like humans
      case Difficulty.Impossible:
        return maxTroops * 1.25;
      default:
        assertNever(this._gameConfig.difficulty);
    }
  }

  troopIncreaseRate(player: PlayerLike): number {
    const max = this.maxTroops(player);

    let toAdd = 10 + pow(player.troops(), 0.73) / 4;

    const ratio = 1 - player.troops() / max;
    toAdd *= ratio;

    if (player.type() === PlayerType.Bot) {
      toAdd *= 0.5;
    }

    if (player.type() === PlayerType.Nation) {
      switch (this._gameConfig.difficulty) {
        case Difficulty.Easy:
          toAdd *= 0.9;
          break;
        case Difficulty.Medium:
          toAdd *= 0.95;
          break;
        case Difficulty.Hard:
          toAdd *= 1; // Like humans
          break;
        case Difficulty.Impossible:
          toAdd *= 1.05;
          break;
        default:
          assertNever(this._gameConfig.difficulty);
      }
    }

    return Math.min(player.troops() + toAdd, max) - player.troops();
  }

  nukeMagnitudes(unitType: UnitType): NukeMagnitude {
    switch (unitType) {
      case UnitType.MIRVWarhead:
        return { inner: 12, outer: 18 };
      case UnitType.AtomBomb:
        return { inner: 12, outer: 30 };
      case UnitType.HydrogenBomb:
        return { inner: 80, outer: 100 };
    }
    throw new Error(`Unknown nuke type: ${unitType}`);
  }

  nukeAllianceBreakThreshold(): number {
    return 100;
  }

  samRange(level: number): number {
    // rational growth function (level 1 = 70, level 5 just above hydro range, asymptotically approaches 150)
    return this.maxSamRange() - 480 / (level + 5);
  }

  maxSamRange(): number {
    return 150;
  }

  structureMinDist(): number {
    return 15;
  }

  /** Max-health boost per veterancy level, as an integer percent of base max
   *  health. Integer-only to keep the engine deterministic (no float constants). */
  warshipVeterancyHealthBonus(): number {
    return 20;
  }

  allianceExtensionPromptOffset(): number {
    return 300; // 30 seconds before expiration
  }
}
