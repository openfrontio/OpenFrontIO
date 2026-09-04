import { z } from "zod";
import { PlayerView } from "../../client/view";
import { AssetManifest } from "../AssetUrls";
import { exp, log, pow, pow2 } from "../DetMath";
import { DoomsdayClockSpeed } from "../game/DoomsdayClock";
import {
  Difficulty,
  Game,
  GameType,
  Gold,
  Player,
  PlayerInfo,
  PlayerType,
  TerrainType,
  TerraNullius,
  Tick,
  Unit,
  UnitInfo,
  UnitType,
} from "../game/Game";
import { UserSettings } from "../game/UserSettings";
import { GameConfig, TeamCountConfig } from "../Schemas";
import { NukeType } from "../StatsSchemas";
import { assertNever, sigmoid, toInt, within } from "../Util";

declare global {
  interface Window {
    BOOTSTRAP_CONFIG?: {
      gitCommit?: string;
      assetManifest?: AssetManifest;
      cdnBase?: string;
      gameEnv?: string;
      numWorkers?: number;
      turnstileSiteKey?: string;
      jwtAudience?: string;
      instanceId?: string;
      // Desktop-only: explicit game-server host for the WebSocket origin.
      // Absent on the web build (client falls back to same-origin location).
      serverHost?: string;
    };
  }
}

export enum GameEnv {
  Dev,
  Preprod,
  Prod,
}

export function parseGameEnv(value: string | undefined): GameEnv {
  switch (value) {
    case "dev":
      return GameEnv.Dev;
    case "staging":
      return GameEnv.Preprod;
    case "prod":
      return GameEnv.Prod;
    default:
      throw new Error(`unsupported game env: ${value}`);
  }
}

export interface AttackLogicInput {
  terrain: TerrainType;
  attackTroops: number;
  attacker: { type: PlayerType; numTiles: number };
  /** null when attacking terra nullius. */
  defender: {
    type: PlayerType;
    numTiles: number;
    troops: number;
    isTraitor: boolean;
    /** Defender is disconnected and on the attacker's team. */
    isDisconnectedTeammate: boolean;
  } | null;
  /** A defense post owned by the defender is in range of the tile. */
  defenderHasDefensePost: boolean;
  /** Fraction of land tiles with fallout, or null if the tile has no fallout. */
  falloutRatio: number | null;
  /** Tiles on the attack front this tick (plus jitter); fixed for the tick. */
  borderSize: number;
}

export interface AttackLogicResult {
  attackerTroopLoss: number;
  defenderTroopLoss: number;
  /**
   * Share of this tick's conquest budget the tile consumes. An attack keeps
   * conquering tiles until the fractions sum to 1, so a tile costing 0.1
   * means about ten such tiles per tick.
   */
  tickFraction: number;
}

export interface NukeMagnitude {
  inner: number;
  outer: number;
}

// attackLogic tunables
const LARGE_TERRITORY_MIDPOINT = 300_000;
const LARGE_TERRITORY_STEEPNESS = 2.5;
// Floors: a huge attacker's tiles cost 0.3x, a huge defender's 0.7x.
const LARGE_ATTACKER_DEPTH = 0.7;
const LARGE_DEFENDER_DEPTH = 0.3;
const BOT_DEFENDER_LOSS_MULT = 0.7;
const TERRA_NULLIUS_COST_SCALE = 2000;
const TERRA_NULLIUS_MIN_COST = 5;
const TERRA_NULLIUS_MAX_COST = 100;
// Attacker loss = mag * clampedRatio * (BASE * largeAttackerBonus + DENSITY * troopsPerTile).
// BASE is the old 0.48 ratio weight times the 0.965 large-defender sigmoid
// tail that every defender used to get. DENSITY sets which stack size pays
// the old 0.0052 density weight: at 0.0039 a stack of 3/4 the defender's
// army matches the old cost, bigger stacks pay less, smaller pay more.
const ATTACKER_LOSS_BASE = 0.463;
const ATTACKER_LOSS_PER_DENSITY = 0.0039;
// Speed divisor: 7.5 / 0.965, absorbing the same sigmoid tail.
const SPEED_COST_DIVISOR = 7.77;

/**
 * Logistic in log(tiles): ~1 for small territories, easing down to
 * 1 - depth for huge ones, halfway at LARGE_TERRITORY_MIDPOINT.
 */
function largeTerritoryBonus(numTiles: number, depth: number): number {
  return (
    1 -
    depth *
      sigmoid(
        log(numTiles),
        LARGE_TERRITORY_STEEPNESS,
        log(LARGE_TERRITORY_MIDPOINT),
      )
  );
}

function terrainAttackBase(terrain: TerrainType): {
  mag: number;
  tileCost: number;
} {
  switch (terrain) {
    case TerrainType.Plains:
      return { mag: 80, tileCost: 16.5 };
    case TerrainType.Highland:
      return { mag: 100, tileCost: 20 };
    case TerrainType.Mountain:
      return { mag: 120, tileCost: 25 };
    case TerrainType.Impassable:
      throw new Error(`impassable terrain cannot be attacked`);
    default:
      throw new Error(`terrain type ${terrain} not supported`);
  }
}
const DEFAULT_SPAWN_IMMUNITY_TICKS = 5 * 10;

export const JwksSchema = z.object({
  keys: z
    .object({
      alg: z.literal("EdDSA"),
      crv: z.literal("Ed25519"),
      kty: z.literal("OKP"),
      x: z.string(),
    })
    .array()
    .min(1),
});

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
    private _gameConfig: GameConfig,
    private _userSettings: UserSettings | null,
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
  traitorSpeedDebuff(): number {
    return 0.8;
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

  userSettings(): UserSettings {
    if (this._userSettings === null) {
      throw new Error("userSettings is null");
    }
    return this._userSettings;
  }

  cityTroopIncrease(): number {
    return 250_000;
  }

  falloutDefenseModifier(falloutRatio: number): number {
    // falloutRatio is between 0 and 1
    // So defense modifier is between [5, 2.5]
    return 5 - falloutRatio * 2;
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

  defensePostDefenseBonus(): number {
    return 5;
  }

  defensePostSpeedBonus(): number {
    return 3;
  }

  playerTeams(): TeamCountConfig {
    return this._gameConfig.playerTeams ?? 0;
  }

  spawnNations(): boolean {
    return this._gameConfig.nations !== "disabled";
  }

  isUnitDisabled(unitType: UnitType): boolean {
    return this._gameConfig.disabledUnits?.includes(unitType) ?? false;
  }

  bots(): number {
    return this._gameConfig.bots;
  }
  instantBuild(): boolean {
    return this._gameConfig.instantBuild;
  }
  disableNavMesh(): boolean {
    return this._gameConfig.disableNavMesh ?? false;
  }
  disableAlliances(): boolean {
    // customAllianceDuration === 0 disables alliances (the "custom alliances"
    // control at 0). The legacy boolean is still honored for older configs.
    return (
      this._gameConfig.customAllianceDuration === 0 ||
      (this._gameConfig.disableAlliances ?? false)
    );
  }
  waterNukes(): boolean {
    return this._gameConfig.waterNukes ?? false;
  }
  isRandomSpawn(): boolean {
    return this._gameConfig.randomSpawn;
  }
  infiniteGold(): boolean {
    return this._gameConfig.infiniteGold;
  }
  donateGold(): boolean {
    return this._gameConfig.donateGold;
  }
  infiniteTroops(): boolean {
    return this._gameConfig.infiniteTroops;
  }
  donateTroops(): boolean {
    return this._gameConfig.donateTroops;
  }
  goldMultiplier(): number {
    return this._gameConfig.goldMultiplier ?? 1;
  }
  startingGold(playerInfo: PlayerInfo): Gold {
    if (playerInfo.playerType === PlayerType.Bot) {
      return 0n;
    }
    return this.startingGoldFor(playerInfo);
  }

  trainSpawnRate(numPlayerFactories: number): number {
    // hyperbolic decay, midpoint at 10 factories
    // expected number of trains = numPlayerFactories  / trainSpawnRate(numPlayerFactories)
    return (numPlayerFactories + 10) * 15;
  }
  trainGold(
    rel: "self" | "team" | "ally" | "other",
    citiesVisited: number,
    player: Player | PlayerView,
  ): Gold {
    // No penalty for the first 10 cities.
    citiesVisited = Math.max(0, citiesVisited - 9);
    let baseGold: number;
    switch (rel) {
      case "ally":
        baseGold = 35_000;
        break;
      case "team":
      case "other":
        baseGold = 25_000;
        break;
      case "self":
        baseGold = 10_000;
        break;
    }
    const distPenalty = citiesVisited * 5_000;
    const gold = Math.max(5000, baseGold - distPenalty);
    return toInt(gold * this.goldMultiplierFor(player));
  }

  trainStationMinRange(): number {
    return 15;
  }
  trainStationMaxRange(): number {
    return 110;
  }
  railroadMaxSize(): number {
    return this.trainStationMaxRange() * 1.4142;
  }

  tradeShipGold(dist: number, player: Player | PlayerView): Gold {
    // Sigmoid: concave start, sharp S-curve middle, linear end - heavily punishes trades under range debuff.
    const debuff = this.tradeShipShortRangeDebuff();
    const baseGold = 75_000 / (1 + exp(-0.03 * (dist - debuff))) + 50 * dist;
    return BigInt(Math.floor(baseGold * this.goldMultiplierFor(player)));
  }

  // Probability of trade ship spawn = 1 / tradeShipSpawnRate
  tradeShipSpawnRate(
    tradeShipSpawnRejections: number,
    numTradeShips: number,
  ): number {
    const decayRate = Math.LN2 / 50;

    // Approaches 0 as numTradeShips increase
    const baseSpawnRate = 1 - sigmoid(numTradeShips, decayRate, 400);

    // Pity timer: increases spawn chance after consecutive rejections
    const rejectionModifier = 1 / (tradeShipSpawnRejections + 1);

    return Math.floor((100 * rejectionModifier) / baseSpawnRate);
  }

  unitInfo(type: UnitType): UnitInfo {
    const cached = this.unitInfoCache.get(type);
    if (cached !== undefined) {
      return cached;
    }

    let info: UnitInfo;
    switch (type) {
      case UnitType.TransportShip:
        info = {
          cost: () => 0n,
        };
        break;
      case UnitType.Warship:
        info = {
          cost: this.costWrapper(
            (numUnits: number) => Math.min(1_000_000, (numUnits + 1) * 250_000),
            UnitType.Warship,
          ),
          maxHealth: 1000,
        };
        break;
      case UnitType.Shell:
        info = {
          cost: () => 0n,
          damage: 250,
        };
        break;
      case UnitType.SAMMissile:
        info = {
          cost: () => 0n,
        };
        break;
      case UnitType.Port:
        info = {
          cost: this.costWrapper(
            (numUnits: number) => Math.min(1_000_000, pow2(numUnits) * 125_000),
            UnitType.Port,
            UnitType.Factory,
          ),
          constructionDuration: this.instantBuild() ? 0 : 5 * 10,
          upgradable: true,
        };
        break;
      case UnitType.AtomBomb:
        info = {
          cost: this.costWrapper(() => 750_000, UnitType.AtomBomb),
        };
        break;
      case UnitType.HydrogenBomb:
        info = {
          cost: this.costWrapper(() => 5_000_000, UnitType.HydrogenBomb),
        };
        break;
      case UnitType.MIRV:
        info = {
          cost: (game: Game, player: Player) => {
            if (
              player.type() === PlayerType.Human &&
              this.hasInfiniteGoldFor(player)
            ) {
              return 0n;
            }
            return 25_000_000n + game.stats().numMirvsLaunched() * 15_000_000n;
          },
        };
        break;
      case UnitType.MIRVWarhead:
        info = {
          cost: () => 0n,
        };
        break;
      case UnitType.TradeShip:
        info = {
          cost: () => 0n,
        };
        break;
      case UnitType.MissileSilo:
        info = {
          cost: this.costWrapper(() => 1_000_000, UnitType.MissileSilo),
          constructionDuration: this.instantBuild() ? 0 : 10 * 10,
          upgradable: true,
        };
        break;
      case UnitType.DefensePost:
        info = {
          cost: this.costWrapper(
            (numUnits: number) => Math.min(250_000, (numUnits + 1) * 50_000),
            UnitType.DefensePost,
          ),
          constructionDuration: this.instantBuild() ? 0 : 5 * 10,
        };
        break;
      case UnitType.SAMLauncher:
        info = {
          cost: this.costWrapper(
            (numUnits: number) =>
              Math.min(3_000_000, (numUnits + 1) * 1_500_000),
            UnitType.SAMLauncher,
          ),
          constructionDuration: this.instantBuild()
            ? 0
            : SAM_CONSTRUCTION_TICKS,
          upgradable: true,
        };
        break;
      case UnitType.City:
        info = {
          cost: this.costWrapper(
            (numUnits: number) => Math.min(1_000_000, pow2(numUnits) * 125_000),
            UnitType.City,
          ),
          constructionDuration: this.instantBuild() ? 0 : 2 * 10,
          upgradable: true,
        };
        break;
      case UnitType.Factory:
        info = {
          cost: this.costWrapper(
            (numUnits: number) => Math.min(1_000_000, pow2(numUnits) * 125_000),
            UnitType.Factory,
            UnitType.Port,
          ),
          constructionDuration: this.instantBuild() ? 0 : 2 * 10,
          upgradable: true,
        };
        break;
      case UnitType.Train:
        info = {
          cost: () => 0n,
        };
        break;
      default:
        assertNever(type);
    }

    this.unitInfoCache.set(type, info);
    return info;
  }

  private hasInfiniteGoldFor(player: Player | PlayerView): boolean {
    if (this.infiniteGold()) return true;
    const hc = this._gameConfig.hostCheats;
    return (hc?.infiniteGold ?? false) && player.isLobbyCreator();
  }

  private hasInfiniteTroopsFor(player: Player | PlayerView): boolean {
    if (this.infiniteTroops()) return true;
    return (
      (this._gameConfig.hostCheats?.infiniteTroops ?? false) &&
      player.isLobbyCreator()
    );
  }

  private hasInfiniteTroopsForInfo(playerInfo: PlayerInfo): boolean {
    if (this.infiniteTroops()) return true;
    return (
      (this._gameConfig.hostCheats?.infiniteTroops ?? false) &&
      playerInfo.isLobbyCreator
    );
  }

  private goldMultiplierFor(player: Player | PlayerView): number {
    const base = this.goldMultiplier();
    const hc = this._gameConfig.hostCheats;
    if (hc?.goldMultiplier && player.isLobbyCreator()) {
      return hc.goldMultiplier;
    }
    return base;
  }

  public conquerGoldAmount(captured: Player): Gold {
    if (
      captured.type() === PlayerType.Bot ||
      captured.type() === PlayerType.Nation
    ) {
      return captured.gold();
    } else {
      return captured.gold() / 2n;
    }
  }

  private startingGoldFor(playerInfo: PlayerInfo): Gold {
    const base = BigInt(this._gameConfig.startingGold ?? 0);
    const hc = this._gameConfig.hostCheats;
    if (hc?.startingGold && playerInfo.isLobbyCreator) {
      return base + BigInt(hc.startingGold);
    }
    return base;
  }

  private costWrapper(
    costFn: (units: number) => number,
    ...types: UnitType[]
  ): (g: Game, p: Player, extraUnits?: number) => bigint {
    return (game: Game, player: Player, extraUnits: number = 0) => {
      if (
        player.type() === PlayerType.Human &&
        this.hasInfiniteGoldFor(player)
      ) {
        return 0n;
      }
      const numUnits = types.reduce(
        (acc, type) =>
          acc +
          Math.min(player.unitsOwned(type), player.unitsConstructed(type)),
        0,
      );
      return BigInt(costFn(numUnits + extraUnits));
    };
  }

  defaultDonationAmount(sender: Player): number {
    return Math.floor(sender.troops() / 3);
  }
  donateCooldown(): Tick {
    return 10 * 10;
  }
  embargoAllCooldown(): Tick {
    return 10 * 10;
  }
  deletionMarkDuration(): Tick {
    return 30 * 10;
  }

  deleteUnitCooldown(): Tick {
    return 30 * 10;
  }
  emojiMessageDuration(): Tick {
    return 5 * 10;
  }
  emojiMessageCooldown(): Tick {
    return 5 * 10;
  }
  quickChatCooldown(): Tick {
    return 3 * 10;
  }
  targetDuration(): Tick {
    return 10 * 10;
  }
  targetCooldown(): Tick {
    return 15 * 10;
  }
  allianceRequestDuration(): Tick {
    return 20 * 10;
  }
  allianceRequestCooldown(): Tick {
    return 30 * 10;
  }
  allianceDuration(): Tick {
    // Host can set a custom alliance duration in minutes (1-15); 0 disables
    // alliances (see disableAlliances). Falls back to the 5 minute default.
    const m = this._gameConfig.customAllianceDuration;
    if (typeof m === "number" && m > 0) return m * 60 * 10;
    return 300 * 10; // 5 minutes.
  }
  temporaryEmbargoDuration(): Tick {
    return 300 * 10; // 5 minutes.
  }
  minDistanceBetweenPlayers(): number {
    return 30;
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
  boatMaxNumber(): number {
    if (this.isUnitDisabled(UnitType.TransportShip)) {
      return 0;
    }
    return 3;
  }
  numSpawnPhaseTurns(): number {
    if (this._gameConfig.gameType === GameType.Singleplayer) {
      return 100;
    }
    if (this.isRandomSpawn()) {
      return 150;
    }
    return 300;
  }
  numBots(): number {
    return this.bots();
  }

  /**
   * Per-tile attack outcome. Pure: depends only on the given input and this
   * config's tunables, never on Game/Player objects. AttackExecution gathers
   * the input from the simulation.
   *
   * Two base values come from the terrain and are scaled by the situation:
   *  - `mag`: how bloody the tile is (drives attacker troop loss)
   *  - `tileCost`: how expensive the tile is to take (higher = slower)
   *
   * Speed: each tick the attack can take about `borderSize` tiles worth of
   * budget; each tile consumes `tileCost`, scaled by how outnumbered the
   * attack is. The result reports that as a fraction of the tick.
   */
  attackLogic(input: AttackLogicInput): AttackLogicResult {
    const { attackTroops, attacker, defender } = input;
    let { mag, tileCost } = terrainAttackBase(input.terrain);

    if (defender !== null && input.defenderHasDefensePost) {
      mag *= this.defensePostDefenseBonus();
      tileCost *= this.defensePostSpeedBonus();
    }
    if (input.falloutRatio !== null) {
      const fallout = this.falloutDefenseModifier(input.falloutRatio);
      mag *= fallout;
      tileCost *= fallout;
    }

    if (defender === null) {
      const tickBudget = input.borderSize * 2;
      return {
        attackerTroopLoss: mag / (attacker.type === PlayerType.Bot ? 10 : 5),
        defenderTroopLoss: 0,
        tickFraction:
          within(
            (TERRA_NULLIUS_COST_SCALE * tileCost) / attackTroops,
            TERRA_NULLIUS_MIN_COST,
            TERRA_NULLIUS_MAX_COST,
          ) / tickBudget,
      };
    }

    if (defender.isDisconnectedTeammate) {
      // No troop loss if defender is disconnected and on same team
      mag = 0;
    }
    if (
      (attacker.type === PlayerType.Human ||
        attacker.type === PlayerType.Nation) &&
      defender.type === PlayerType.Bot
    ) {
      mag *= BOT_DEFENDER_LOSS_MULT;
    }

    // Big territories are cheaper and faster to attack from and into, so
    // late games stay dynamic. The attacker's bonus is the stronger one.
    const largeAttackerBonus = largeTerritoryBonus(
      attacker.numTiles,
      LARGE_ATTACKER_DEPTH,
    );
    const largeDefenderBonus = largeTerritoryBonus(
      defender.numTiles,
      LARGE_DEFENDER_DEPTH,
    );

    const traitorLossMod = defender.isTraitor ? this.traitorDefenseDebuff() : 1;
    const traitorCostMod = defender.isTraitor ? this.traitorSpeedDebuff() : 1;

    // Defender loses its average troops-per-tile.
    const defenderTroopLoss = defender.troops / defender.numTiles;

    // Two ratios drive the attacker's loss: how outnumbered the attack is
    // (defender army / attack stack, clamped: bigger pushes pay less per
    // tile) scales a cost made of a base plus the defender's troop density
    // (packed land is expensive, spread-thin land is cheap).
    const troopRatio = defender.troops / attackTroops;
    const attackerTroopLoss =
      mag *
      traitorLossMod *
      within(troopRatio, 0.6, 2) *
      (ATTACKER_LOSS_BASE * largeAttackerBonus * largeDefenderBonus +
        ATTACKER_LOSS_PER_DENSITY * defenderTroopLoss);

    // Speed: a tile's cost in tick-fractions grows with how outnumbered the
    // attack is. Flat at 1/5 up to parity, then rising linearly (saturating
    // at 7.5x), with a second ramp for hopeless attacks past 20x.
    const speedCost =
      (within(troopRatio, 1, 7.5) * within(troopRatio / 20, 1, 50)) /
      SPEED_COST_DIVISOR;
    return {
      attackerTroopLoss,
      defenderTroopLoss,
      tickFraction:
        (speedCost *
          tileCost *
          largeAttackerBonus *
          largeDefenderBonus *
          traitorCostMod) /
        input.borderSize,
    };
  }

  boatAttackAmount(attacker: Player, defender: Player | TerraNullius): number {
    return Math.floor(attacker.troops() / 5);
  }

  warshipShellLifetime(): number {
    return 20; // in ticks (one tick is 100ms)
  }

  radiusPortSpawn() {
    return 20;
  }

  tradeShipShortRangeDebuff(): number {
    return 300;
  }

  proximityBonusPortsNb(totalPorts: number) {
    return within(totalPorts / 3, 4, totalPorts);
  }

  attackAmount(attacker: Player, defender: Player | TerraNullius) {
    if (attacker.type() === PlayerType.Bot) {
      return attacker.troops() / 20;
    } else {
      return attacker.troops() / 5;
    }
  }

  startManpower(playerInfo: PlayerInfo): number {
    if (playerInfo.playerType === PlayerType.Bot) {
      return 10_000;
    }
    if (playerInfo.playerType === PlayerType.Nation) {
      switch (this._gameConfig.difficulty) {
        case Difficulty.Easy:
          return 12_500;
        case Difficulty.Medium:
          return 18_750;
        case Difficulty.Hard:
          return 25_000; // Like humans
        case Difficulty.Impossible:
          return 31_250;
        default:
          assertNever(this._gameConfig.difficulty);
      }
    }
    return this.hasInfiniteTroopsForInfo(playerInfo) ? 1_000_000 : 25_000;
  }

  maxTroops(player: Player | PlayerView): number {
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

  troopIncreaseRate(player: Player | PlayerView): number {
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

  goldAdditionRate(player: Player | PlayerView): Gold {
    const multiplier = this.goldMultiplierFor(player);
    let baseRate: bigint;
    if (player.type() === PlayerType.Bot) {
      baseRate = 50n;
    } else {
      baseRate = 100n;
    }
    return BigInt(Math.floor(Number(baseRate) * multiplier));
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

  nukeSpeed(unitType: UnitType): number {
    switch (unitType) {
      case UnitType.AtomBomb:
      case UnitType.HydrogenBomb:
        return 10;
      case UnitType.MIRV:
        return 15;
      case UnitType.MIRVWarhead:
        return 22;
    }
    throw new Error(`Unknown nuke type: ${unitType}`);
  }

  mirvNormalizeTargetTicks(): number {
    return 14;
  }

  defaultNukeTargetableRange(): number {
    return 150;
  }

  defaultSamRange(): number {
    return 70;
  }

  samRange(level: number): number {
    // rational growth function (level 1 = 70, level 5 just above hydro range, asymptotically approaches 150)
    return this.maxSamRange() - 480 / (level + 5);
  }

  maxSamRange(): number {
    return 150;
  }

  samUpgradeDuration(): number {
    return Math.floor(this.SAMCooldown() / 2);
  }

  dynamicSamRange(sam: Unit, currentTick: number): number {
    const state = sam.samLauncherState();
    if (state === undefined || state.upgradeStartTick === undefined) {
      return this.samRange(sam.level());
    }
    const duration = state.duration ?? this.samUpgradeDuration();
    const elapsed = currentTick - state.upgradeStartTick;
    if (elapsed >= duration) {
      return this.samRange(state.targetLevel);
    }
    const targetRange = this.samRange(state.targetLevel);
    const diff = targetRange - state.startRange;
    return state.startRange + (diff * elapsed) / duration;
  }

  defaultSamMissileSpeed(): number {
    return 12;
  }

  // Humans can be soldiers, soldiers attacking, soldiers in boat etc.
  nukeDeathFactor(
    nukeType: NukeType,
    humans: number,
    tilesOwned: number,
    maxTroops: number,
  ): number {
    if (nukeType !== UnitType.MIRVWarhead) {
      return (5 * humans) / Math.max(1, tilesOwned);
    }
    const targetTroops = 0.03 * maxTroops;
    const excessTroops = Math.max(0, humans - targetTroops);
    const scalingFactor = 500;

    const steepness = 2;
    const normalizedExcess = excessTroops / maxTroops;
    return scalingFactor * (1 - exp(-steepness * normalizedExcess));
  }

  structureMinDist(): number {
    return 15;
  }

  shellLifetime(): number {
    return 50;
  }

  warshipPatrolRange(): number {
    return 100;
  }

  warshipTargettingRange(): number {
    return 130;
  }

  warshipShellAttackRate(): number {
    return 20;
  }

  warshipDockingRange(): number {
    return 5;
  }

  warshipPortHealingBonusPerLevel(): number {
    return 5;
  }

  /** Health at or below which a warship retreats to repair, as a percent of its
   *  (veterancy-adjusted) max health, so the threshold scales with max health. */
  warshipRetreatHealthPercent(): number {
    return 75;
  }

  warshipPassiveHealing(): number {
    return 1;
  }

  warshipPassiveHealingRange(): number {
    return 150;
  }

  warshipPortSwitchThreshold(): number {
    return 0.75;
  }

  // --- Warship veterancy ---

  /** Maximum veterancy level a warship can reach. */
  warshipMaxVeterancy(): number {
    return 3;
  }

  /** Max-health boost per veterancy level, as an integer percent of base max
   *  health. Integer-only to keep src/core deterministic (no float constants). */
  warshipVeterancyHealthBonus(): number {
    return 20;
  }

  /** Shell-damage boost per veterancy level, as an integer percent of the
   *  rolled damage. Integer-only to keep src/core deterministic. */
  warshipVeterancyShellDamageBonus(): number {
    return 20;
  }

  /** Transport ships a warship must destroy to gain one veterancy level. */
  warshipVeterancyTransportKills(): number {
    return 10;
  }

  /** Trade ships a warship must capture to gain one veterancy level. */
  warshipVeterancyTradeCaptures(): number {
    return 25;
  }

  defensePostShellAttackRate(): number {
    return 100;
  }

  safeFromPiratesCooldownMax(): number {
    return 20;
  }

  defensePostTargettingRange(): number {
    return 75;
  }

  allianceExtensionPromptOffset(): number {
    return 300; // 30 seconds before expiration
  }
}
