import {
  Difficulty,
  GameType,
  Gold,
  PlayerInfo,
  PlayerType,
  TerrainType,
  TerraNullius,
  Tick,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { PlayerLike } from "@openfront/engine-api/game/ReadViews";
import { TeamCountConfig } from "@openfront/engine-api/Schemas";
import { NukeType } from "@openfront/engine-api/StatsSchemas";
import { Config } from "@openfront/engine-lib/configuration/Config";
import { exp, log, pow2 } from "@openfront/engine-lib/DetMath";
import {
  assertNever,
  sigmoid,
  toInt,
  within,
} from "@openfront/engine-lib/Util";
import type { EngineUnitInfo, Game, Player, Unit } from "../game/Game";

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

// attackLogic tunables
const LARGE_TERRITORY_MIDPOINT = 300_000;
const LARGE_TERRITORY_STEEPNESS = 2.5;
// Floors: a huge attacker's bonus bottoms at 0.3x (losses; speed uses the
// deeper LARGE_ATTACKER_SPEED_DEPTH below), a huge defender's at 0.7x.
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
// Speed divisor: 8.25 / 0.965, absorbing the same sigmoid tail. 8.25 is the
// old 7.5 raised ~10%: v34 pace feedback said attacks felt a bit too slow, so
// every player-vs-player attack lands ~10% faster across the board.
const SPEED_COST_DIVISOR = 8.55;
// Speed-only: the attacker's territory bonus runs a touch deeper for speed
// than the 0.7 loss depth above (floor 0.27x vs 0.3x). Paired with the 0.82
// sub-parity floor on the ratio curve, an overwhelming push lands ~18%
// faster for a small attacker, ~20% at the 300k midpoint, ~25% for giants.
const LARGE_ATTACKER_SPEED_DEPTH = 0.73;

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

/**
 * The engine's rules: everything in Config plus the tunables only the
 * simulation reads (attack resolution, costs, warships, nukes, trade).
 */
export class EngineConfig extends Config {
  private engineUnitInfoCache = new Map<UnitType, EngineUnitInfo>();

  traitorSpeedDebuff(): number {
    return 0.8;
  }

  teamLandShareWinThresholdTenths(): number {
    return 7;
  }

  setDifficulty(difficulty: Difficulty): void {
    this._gameConfig.difficulty = difficulty;
  }

  setGameType(gameType: GameType): void {
    this._gameConfig.gameType = gameType;
  }

  falloutDefenseModifier(falloutRatio: number): number {
    // falloutRatio is between 0 and 1
    // So defense modifier is between [5, 2.5]
    return 5 - falloutRatio * 2;
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

  bots(): number {
    return this._gameConfig.bots;
  }
  disableNavMesh(): boolean {
    return this._gameConfig.disableNavMesh ?? false;
  }
  waterNukes(): boolean {
    return this._gameConfig.waterNukes ?? false;
  }
  infiniteGold(): boolean {
    return this._gameConfig.infiniteGold;
  }
  donateGold(): boolean {
    return this._gameConfig.donateGold;
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

  /**
   * Global spawn throttle for the train economy, counted in Train *units*
   * (~7 per train: engine, tail, 5 cars). Up to 1.5x spawns for the very
   * first trains, ~1x around 35 units (~5 trains), then a capacity
   * sigmoid damps spawning past the ~560-unit midpoint. The damping
   * flattens onto a ~0.25 plateau past ~810 units (~115 trains), so a big
   * enough rail economy still scales at a quarter of the un-damped rate,
   * until a global hard cap far beyond any normal game collapses the
   * plateau past ~900 units (~130 trains).
   *
   * The midpoint was 300 units in v34.0. Public-game telemetry put a real
   * lobby at ~4.2 train units per player, so a 50-player game sat at ~210
   * units and a 70-player game at ~300 — i.e. normal lobbies were landing
   * on and past the knee, costing factories 35-56% of their v33 income.
   * The 61-nation benchmark this curve was tuned against peaks at 91 units,
   * roughly a quarter of a full public lobby, so it never saw that region.
   * v34.5 moved it to 500 (measured +32% train gold in matched lobbies);
   * 560 softens the remaining early/mid-game gap vs v33 (~-8% at 50
   * players, ~-18% at 80) without re-opening v33's big-lobby train
   * dominance, and leaves the plateau and hard cap untouched.
   */
  trainSaturation(numTrainUnits: number): number {
    const boost = 1 + 0.5 * exp(-numTrainUnits / 30);
    const damping = 1 - sigmoid(numTrainUnits, Math.LN2 / 100, 560);
    const plateau = 0.25 * (1 - sigmoid(numTrainUnits, Math.LN2 / 150, 900));
    return boost * Math.max(damping, plateau);
  }

  trainSpawnRate(numPlayerFactories: number, numTrainUnits: number): number {
    // hyperbolic decay, midpoint at 10 factories
    // expected number of trains = numPlayerFactories  / trainSpawnRate(numPlayerFactories)
    const rate = (numPlayerFactories + 10) * 15;
    return Math.max(1, Math.floor(rate / this.trainSaturation(numTrainUnits)));
  }

  trainGold(
    rel: "self" | "team" | "ally" | "other",
    citiesVisited: number,
    player: PlayerLike,
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
  railroadMaxSize(): number {
    return this.trainStationMaxRange() * 1.4142;
  }

  tradeShipGold(dist: number, player: PlayerLike): Gold {
    // Sigmoid: concave start, sharp S-curve middle, linear end - heavily punishes trades under range debuff.
    const debuff = this.tradeShipShortRangeDebuff();
    const baseGold = 75_000 / (1 + exp(-0.03 * (dist - debuff))) + 50 * dist;
    return BigInt(Math.floor(baseGold * this.goldMultiplierFor(player)));
  }

  /**
   * Global spawn throttle for the trade-ship economy. A mild ~1.45x odds
   * boost while the world fleet is small (the pity timer square-roots the
   * realized effect, so ~1.2x actual spawns), held through the opening
   * trading minutes and crossing the old un-boosted curve around 110
   * ships, then a capacity sigmoid damps spawning past the ~330-ship
   * midpoint. The damping flattens onto a 0.25 plateau past ~415 ships
   * (~half cadence per port after the pity timer), so heavy port
   * investment keeps scaling income linearly, until a global hard cap far
   * beyond any normal game collapses the plateau past ~800 at sea.
   *
   * The midpoint was 230 in v34.0. v33's was 400, so fleets of 150-350 —
   * reached within the opening minutes of a 40+ player lobby — ran 30-64%
   * below v33's spawn odds, which is where the "no early gold for nukes"
   * deficit lived; the opening (<130 ships) was already above v33 via the
   * boost. 330 restores that window to near-v33 while the plateau keeps
   * everything past ~450 ships (the late game) numerically unchanged.
   */
  tradeShipSaturation(numTradeShips: number): number {
    const boost = 1 + 0.45 * exp(-numTradeShips / 120);
    const damping = 1 - sigmoid(numTradeShips, Math.LN2 / 50, 330);
    const plateau = 0.25 * (1 - sigmoid(numTradeShips, Math.LN2 / 100, 800));
    return boost * Math.max(damping, plateau);
  }

  // Probability of trade ship spawn = 1 / tradeShipSpawnRate
  tradeShipSpawnRate(
    tradeShipSpawnRejections: number,
    numTradeShips: number,
  ): number {
    // Pity timer: increases spawn chance after consecutive rejections
    const rejectionModifier = 1 / (tradeShipSpawnRejections + 1);

    return Math.max(
      1,
      Math.floor(
        (100 * rejectionModifier) / this.tradeShipSaturation(numTradeShips),
      ),
    );
  }

  private hasInfiniteGoldFor(player: PlayerLike): boolean {
    if (this.infiniteGold()) return true;
    const hc = this._gameConfig.hostCheats;
    return (hc?.infiniteGold ?? false) && player.isLobbyCreator();
  }

  override unitInfo(type: UnitType): EngineUnitInfo {
    const cached = this.engineUnitInfoCache.get(type);
    if (cached !== undefined) {
      return cached;
    }
    const info = { ...super.unitInfo(type), cost: this.unitCost(type) };
    this.engineUnitInfoCache.set(type, info);
    return info;
  }

  private unitCost(type: UnitType): EngineUnitInfo["cost"] {
    switch (type) {
      case UnitType.Warship:
        return this.costWrapper(
          (numUnits: number) => Math.min(1_000_000, (numUnits + 1) * 250_000),
          UnitType.Warship,
        );
      case UnitType.Port:
        return this.costWrapper(
          (numUnits: number) => Math.min(1_000_000, pow2(numUnits) * 125_000),
          UnitType.Port,
          UnitType.Factory,
        );
      case UnitType.AtomBomb:
        return this.costWrapper(() => 750_000, UnitType.AtomBomb);
      case UnitType.HydrogenBomb:
        return this.costWrapper(() => 5_000_000, UnitType.HydrogenBomb);
      case UnitType.MIRV:
        return (game: Game, player: Player) => {
          if (
            player.type() === PlayerType.Human &&
            this.hasInfiniteGoldFor(player)
          ) {
            return 0n;
          }
          return 25_000_000n + BigInt(game.mirvsLaunched()) * 15_000_000n;
        };
      case UnitType.MissileSilo:
        return this.costWrapper(() => 1_000_000, UnitType.MissileSilo);
      case UnitType.DefensePost:
        return this.costWrapper(
          (numUnits: number) => Math.min(250_000, (numUnits + 1) * 50_000),
          UnitType.DefensePost,
        );
      case UnitType.SAMLauncher:
        return this.costWrapper(
          (numUnits: number) => Math.min(3_000_000, (numUnits + 1) * 1_500_000),
          UnitType.SAMLauncher,
        );
      case UnitType.City:
        return this.costWrapper(
          (numUnits: number) => Math.min(1_000_000, pow2(numUnits) * 125_000),
          UnitType.City,
        );
      case UnitType.Factory:
        return this.costWrapper(
          (numUnits: number) => Math.min(1_000_000, pow2(numUnits) * 125_000),
          UnitType.Factory,
          UnitType.Port,
        );
      case UnitType.TransportShip:
      case UnitType.Shell:
      case UnitType.SAMMissile:
      case UnitType.MIRVWarhead:
      case UnitType.TradeShip:
      case UnitType.Train:
        return () => 0n;
      default:
        assertNever(type);
    }
  }

  private hasInfiniteTroopsForInfo(playerInfo: PlayerInfo): boolean {
    if (this.infiniteTroops()) return true;
    return (
      (this._gameConfig.hostCheats?.infiniteTroops ?? false) &&
      playerInfo.isLobbyCreator
    );
  }

  private goldMultiplierFor(player: PlayerLike): number {
    const base = this.goldMultiplier();
    const hc = this._gameConfig.hostCheats;
    if (hc?.goldMultiplier && player.isLobbyCreator()) {
      return hc.goldMultiplier;
    }
    return base;
  }

  public conquerGoldAmount(captured: PlayerLike): Gold {
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

  defaultDonationAmount(sender: PlayerLike): number {
    return Math.floor(sender.troops() / 3);
  }
  donateCooldown(): Tick {
    return 10 * 10;
  }
  embargoAllCooldown(): Tick {
    return 10 * 10;
  }
  emojiMessageDuration(): Tick {
    return 5 * 10;
  }
  /** The window emojiMessageLimit counts over. */
  emojiMessageWindow(): Tick {
    return 5 * 10;
  }
  /**
   * How many emojis a human can send one recipient (or everyone) per
   * emojiMessageWindow, so a few can go out in a quick batch.
   */
  emojiMessageLimit(): number {
    return 5;
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
  allianceRequestCooldown(): Tick {
    return 30 * 10;
  }
  temporaryEmbargoDuration(): Tick {
    return 300 * 10; // 5 minutes.
  }
  minDistanceBetweenPlayers(): number {
    return 30;
  }
  boatMaxNumber(): number {
    if (this.isUnitDisabled(UnitType.TransportShip)) {
      return 0;
    }
    return 3;
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
    // attack is. Floored at 0.82 below parity (overwhelming stacks land ~18%
    // faster), then rising linearly (saturating at 7.5x), with a second ramp
    // for hopeless attacks past 20x.
    const speedCost =
      (within(troopRatio, 0.82, 7.5) * within(troopRatio / 20, 1, 50)) /
      SPEED_COST_DIVISOR;
    const largeAttackerSpeedBonus = largeTerritoryBonus(
      attacker.numTiles,
      LARGE_ATTACKER_SPEED_DEPTH,
    );
    return {
      attackerTroopLoss,
      defenderTroopLoss,
      tickFraction:
        (speedCost *
          tileCost *
          largeAttackerSpeedBonus *
          largeDefenderBonus *
          traitorCostMod) /
        input.borderSize,
    };
  }

  boatAttackAmount(
    attacker: PlayerLike,
    defender: PlayerLike | TerraNullius,
  ): number {
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

  attackAmount(attacker: PlayerLike, defender: PlayerLike | TerraNullius) {
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

  goldAdditionRate(player: PlayerLike): Gold {
    const multiplier = this.goldMultiplierFor(player);
    let baseRate: bigint;
    if (player.type() === PlayerType.Bot) {
      baseRate = 50n;
    } else {
      baseRate = 100n;
    }
    return BigInt(Math.floor(Number(baseRate) * multiplier));
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

  /** Shell-damage boost per veterancy level, as an integer percent of the
   *  rolled damage. Integer-only to keep the engine deterministic. */
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
}
