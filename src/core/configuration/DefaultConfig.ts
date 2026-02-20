import { JWK } from "jose";
import { z } from "zod";
import {
  Difficulty,
  Game,
  GameMode,
  GameType,
  Gold,
  Player,
  PlayerInfo,
  PlayerType,
  TerrainType,
  TerraNullius,
  Tick,
  UnitInfo,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PlayerView } from "../game/GameView";
import { UserSettings } from "../game/UserSettings";
import { GameConfig, GameID, TeamCountConfig } from "../Schemas";
import { NukeType } from "../StatsSchemas";
import { assertNever, sigmoid, simpleHash, within } from "../Util";
import { Config, GameEnv, NukeMagnitude, ServerConfig, Theme } from "./Config";
import { Env } from "./Env";
import { PastelTheme } from "./PastelTheme";
import { PastelThemeDark } from "./PastelThemeDark";

const DEFENSE_DEBUFF_MIDPOINT = 150_000;
const DEFENSE_DEBUFF_DECAY_RATE = Math.LN2 / 50000;
const DEFAULT_SPAWN_IMMUNITY_TICKS = 5 * 10;

const JwksSchema = z.object({
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

export abstract class DefaultServerConfig implements ServerConfig {
  turnstileSecretKey(): string {
    return Env.TURNSTILE_SECRET_KEY ?? "";
  }
  abstract turnstileSiteKey(): string;
  allowedFlares(): string[] | undefined {
    return;
  }
  stripePublishableKey(): string {
    return Env.STRIPE_PUBLISHABLE_KEY ?? "";
  }
  domain(): string {
    return Env.DOMAIN ?? "";
  }
  subdomain(): string {
    return Env.SUBDOMAIN ?? "";
  }

  private publicKey: JWK;
  abstract jwtAudience(): string;
  jwtIssuer(): string {
    const audience = this.jwtAudience();
    return audience === "localhost"
      ? "http://localhost:8787"
      : `https://api.${audience}`;
  }
  async jwkPublicKey(): Promise<JWK> {
    if (this.publicKey) return this.publicKey;
    const jwksUrl = this.jwtIssuer() + "/.well-known/jwks.json";
    console.log(`Fetching JWKS from ${jwksUrl}`);
    const response = await fetch(jwksUrl);
    const result = JwksSchema.safeParse(await response.json());
    if (!result.success) {
      const error = z.prettifyError(result.error);
      console.error("Error parsing JWKS", error);
      throw new Error("Invalid JWKS");
    }
    this.publicKey = result.data.keys[0];
    return this.publicKey;
  }
  otelEnabled(): boolean {
    return (
      this.env() !== GameEnv.Dev &&
      Boolean(this.otelEndpoint()) &&
      Boolean(this.otelAuthHeader())
    );
  }
  otelEndpoint(): string {
    return Env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "";
  }
  otelAuthHeader(): string {
    return Env.OTEL_AUTH_HEADER ?? "";
  }
  gitCommit(): string {
    return Env.GIT_COMMIT ?? "";
  }

  apiKey(): string {
    return Env.API_KEY ?? "";
  }

  adminHeader(): string {
    return "x-admin-key";
  }
  adminToken(): string {
    const token = Env.ADMIN_TOKEN;
    if (!token) {
      throw new Error("ADMIN_TOKEN not set");
    }
    return token;
  }
  abstract numWorkers(): number;
  abstract env(): GameEnv;
  turnIntervalMs(): number {
    return 100;
  }
  gameCreationRate(): number {
    return 60 * 1000;
  }

  workerIndex(gameID: GameID): number {
    return simpleHash(gameID) % this.numWorkers();
  }
  workerPath(gameID: GameID): string {
    return `w${this.workerIndex(gameID)}`;
  }
  workerPort(gameID: GameID): number {
    return this.workerPortByIndex(this.workerIndex(gameID));
  }
  workerPortByIndex(index: number): number {
    return 3001 + index;
  }
}

export class DefaultConfig implements Config {
  private pastelTheme: PastelTheme = new PastelTheme();
  private pastelThemeDark: PastelThemeDark = new PastelThemeDark();
  constructor(
    private _serverConfig: ServerConfig,
    private _gameConfig: GameConfig,
    private _userSettings: UserSettings | null,
    private _isReplay: boolean,
  ) {}

  stripePublishableKey(): string {
    return Env.STRIPE_PUBLISHABLE_KEY ?? "";
  }

  isReplay(): boolean {
    return this._isReplay;
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
  spawnImmunityDuration(): Tick {
    return (
      this._gameConfig.spawnImmunityDuration ?? DEFAULT_SPAWN_IMMUNITY_TICKS
    );
  }
  hasExtendedSpawnImmunity(): boolean {
    return this.spawnImmunityDuration() > DEFAULT_SPAWN_IMMUNITY_TICKS;
  }

  gameConfig(): GameConfig {
    return this._gameConfig;
  }

  serverConfig(): ServerConfig {
    return this._serverConfig;
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
  SAMCooldown(): number {
    return 75;
  }
  SiloCooldown(): number {
    return 75;
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
    return !this._gameConfig.disableNations;
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
    return BigInt(this._gameConfig.startingGold ?? 0);
  }

  trainSpawnRate(numPlayerFactories: number): number {
    // hyperbolic decay, midpoint at 10 factories
    // expected number of trains = numPlayerFactories  / trainSpawnRate(numPlayerFactories)
    return (numPlayerFactories + 10) * 18;
  }
  trainGold(rel: "self" | "team" | "ally" | "other"): Gold {
    const multiplier = this.goldMultiplier();
    let baseGold: bigint;
    switch (rel) {
      case "ally":
        baseGold = 35_000n;
        break;
      case "team":
      case "other":
        baseGold = 25_000n;
        break;
      case "self":
        baseGold = 10_000n;
        break;
    }
    return BigInt(Math.floor(Number(baseGold) * multiplier));
  }

  trainStationMinRange(): number {
    return 15;
  }
  trainStationMaxRange(): number {
    return 100;
  }
  railroadMaxSize(): number {
    return 120;
  }

  tradeShipGold(dist: number, numPorts: number): Gold {
    // Sigmoid: concave start, sharp S-curve middle, linear end - heavily punishes trades under range debuff.
    const debuff = this.tradeShipShortRangeDebuff();
    const baseGold =
      100_000 / (1 + Math.exp(-0.03 * (dist - debuff))) + 100 * dist;
    const numPortBonus = numPorts - 1;
    // Hyperbolic decay, midpoint at 5 ports, 3x bonus max.
    const bonus = 1 + 2 * (numPortBonus / (numPortBonus + 5));
    const multiplier = this.goldMultiplier();
    return BigInt(Math.floor(baseGold * bonus * multiplier));
  }

  // Probability of trade ship spawn = 1 / tradeShipSpawnRate
  tradeShipSpawnRate(
    numTradeShips: number,
    numPlayerPorts: number,
    numPlayerTradeShips: number,
  ): number {
    // Geometric mean of base spawn rate and port multiplier
    const combined = Math.sqrt(
      this.tradeShipBaseSpawn(numTradeShips, numPlayerTradeShips) *
        this.tradeShipPortMultiplier(numPlayerPorts),
    );

    return Math.floor(25 / combined);
  }

  private tradeShipBaseSpawn(
    numTradeShips: number,
    numPlayerTradeShips: number,
  ): number {
    if (numPlayerTradeShips < 3) {
      // If other players have many ports, then they can starve out smaller players.
      // So this prevents smaller players from being completely starved out.
      return 1;
    }
    const decayRate = Math.LN2 / 10;
    return 1 - sigmoid(numTradeShips, decayRate, 55);
  }

  private tradeShipPortMultiplier(numPlayerPorts: number): number {
    // Hyperbolic decay function with midpoint at 10 ports
    // Expected trade ship spawn rate is proportional to numPlayerPorts * multiplier
    // Gradual decay prevents scenario where more ports => fewer ships
    const decayRate = 1 / 10;
    return 1 / (1 + decayRate * numPlayerPorts);
  }

  unitInfo(type: UnitType): UnitInfo {
    switch (type) {
      case UnitType.TransportShip:
        return {
          cost: () => 0n,
          territoryBound: false,
        };
      case UnitType.Warship:
        return {
          cost: this.costWrapper(
            (numUnits: number) => Math.min(1_000_000, (numUnits + 1) * 250_000),
            UnitType.Warship,
          ),
          territoryBound: false,
          maxHealth: 1000,
        };
      case UnitType.Shell:
        return {
          cost: () => 0n,
          territoryBound: false,
          damage: 250,
        };
      case UnitType.SAMMissile:
        return {
          cost: () => 0n,
          territoryBound: false,
        };
      case UnitType.Port:
        return {
          cost: this.costWrapper(
            (numUnits: number) =>
              Math.min(1_000_000, Math.pow(2, numUnits) * 125_000),
            UnitType.Port,
            UnitType.Factory,
          ),
          territoryBound: true,
          constructionDuration: this.instantBuild() ? 0 : 2 * 10,
          upgradable: true,
          canBuildTrainStation: true,
        };
      case UnitType.AtomBomb:
        return {
          cost: this.costWrapper(() => 750_000, UnitType.AtomBomb),
          territoryBound: false,
        };
      case UnitType.HydrogenBomb:
        return {
          cost: this.costWrapper(() => 5_000_000, UnitType.HydrogenBomb),
          territoryBound: false,
        };
      case UnitType.MIRV:
        return {
          cost: (game: Game, player: Player) => {
            if (player.type() === PlayerType.Human && this.infiniteGold()) {
              return 0n;
            }
            return 25_000_000n + game.stats().numMirvsLaunched() * 15_000_000n;
          },
          territoryBound: false,
        };
      case UnitType.MIRVWarhead:
        return {
          cost: () => 0n,
          territoryBound: false,
        };
      case UnitType.TradeShip:
        return {
          cost: () => 0n,
          territoryBound: false,
        };
      case UnitType.MissileSilo:
        return {
          cost: this.costWrapper(() => 1_000_000, UnitType.MissileSilo),
          territoryBound: true,
          constructionDuration: this.instantBuild() ? 0 : 10 * 10,
          upgradable: true,
        };
      case UnitType.DefensePost:
        return {
          cost: this.costWrapper(
            (numUnits: number) => Math.min(250_000, (numUnits + 1) * 50_000),
            UnitType.DefensePost,
          ),
          territoryBound: true,
          constructionDuration: this.instantBuild() ? 0 : 5 * 10,
        };
      case UnitType.SAMLauncher:
        return {
          cost: this.costWrapper(
            (numUnits: number) =>
              Math.min(3_000_000, (numUnits + 1) * 1_500_000),
            UnitType.SAMLauncher,
          ),
          territoryBound: true,
          constructionDuration: this.instantBuild() ? 0 : 30 * 10,
          upgradable: true,
        };
      case UnitType.City:
        return {
          cost: this.costWrapper(
            (numUnits: number) =>
              Math.min(1_000_000, Math.pow(2, numUnits) * 125_000),
            UnitType.City,
          ),
          territoryBound: true,
          constructionDuration: this.instantBuild() ? 0 : 2 * 10,
          upgradable: true,
          canBuildTrainStation: true,
        };
      case UnitType.Factory:
        return {
          cost: this.costWrapper(
            (numUnits: number) =>
              Math.min(1_000_000, Math.pow(2, numUnits) * 125_000),
            UnitType.Factory,
            UnitType.Port,
          ),
          territoryBound: true,
          constructionDuration: this.instantBuild() ? 0 : 2 * 10,
          canBuildTrainStation: true,
          experimental: true,
          upgradable: true,
        };
      case UnitType.Train:
        return {
          cost: () => 0n,
          territoryBound: false,
          experimental: true,
        };
      default:
        assertNever(type);
    }
  }

  private costWrapper(
    costFn: (units: number) => number,
    ...types: UnitType[]
  ): (g: Game, p: Player) => bigint {
    return (game: Game, player: Player) => {
      if (player.type() === PlayerType.Human && this.infiniteGold()) {
        return 0n;
      }
      const numUnits = types.reduce(
        (acc, type) =>
          acc +
          Math.min(player.unitsOwned(type), player.unitsConstructed(type)),
        0,
      );
      return BigInt(costFn(numUnits));
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
    return 300 * 10; // 5 minutes.
  }
  temporaryEmbargoDuration(): Tick {
    return 300 * 10; // 5 minutes.
  }
  minDistanceBetweenPlayers(): number {
    return 30;
  }

  percentageTilesOwnedToWin(): number {
    if (this._gameConfig.gameMode === GameMode.Team) {
      return 95;
    }
    return 80;
  }
  boatMaxNumber(): number {
    return 3;
  }
  numSpawnPhaseTurns(): number {
    return this._gameConfig.gameType === GameType.Singleplayer ? 100 : 300;
  }
  numBots(): number {
    return this.bots();
  }
  theme(): Theme {
    return this.userSettings()?.darkMode()
      ? this.pastelThemeDark
      : this.pastelTheme;
  }

  attackLogic(
    gm: Game,
    attackTroops: number,
    attacker: Player,
    defender: Player | TerraNullius,
    tileToConquer: TileRef,
  ): {
    attackerTroopLoss: number;
    defenderTroopLoss: number;
    tilesPerTickUsed: number;
  } {
    let mag = 0;
    let speed = 0;
    const type = gm.terrainType(tileToConquer);
    switch (type) {
      case TerrainType.Plains:
        mag = 80;
        speed = 16.5;
        break;
      case TerrainType.Highland:
        mag = 100;
        speed = 20;
        break;
      case TerrainType.Mountain:
        mag = 120;
        speed = 25;
        break;
      default:
        throw new Error(`terrain type ${type} not supported`);
    }
    if (defender.isPlayer()) {
      // City defense bonus based on density and area
      const maxCitySearchRadius = 50;
      const nearbyCities = gm.nearbyUnits(
        tileToConquer,
        maxCitySearchRadius,
        UnitType.City,
        ({ unit: u }) => u.owner() === defender && !u.isUnderConstruction(),
      );
      for (const { unit: city, distSquared } of nearbyCities) {
        const areaRadius = city.areaRadius() || 0;
        if (areaRadius > 0 && Math.sqrt(distSquared) <= areaRadius) {
          // Denser cities are harder to capture
          // Density bonus scales from 1.5x up to ~3x or more based on age and area
          const density = city.density() || 0;
          const densityBonus = 1.5 + density * 2;
          mag *= densityBonus;
          speed *= 0.7; // Moving through a city is slower
          break;
        }
      }

      for (const dp of gm.nearbyUnits(
        tileToConquer,
        gm.config().defensePostRange(),
        UnitType.DefensePost,
      )) {
        if (dp.unit.owner() === defender) {
          mag *= this.defensePostDefenseBonus();
          speed *= this.defensePostSpeedBonus();
          break;
        }
      }
    }

    if (gm.hasFallout(tileToConquer)) {
      const falloutRatio = gm.numTilesWithFallout() / gm.numLandTiles();
      mag *= this.falloutDefenseModifier(falloutRatio);
      speed *= this.falloutDefenseModifier(falloutRatio);
    }

    if (attacker.isPlayer() && defender.isPlayer()) {
      if (defender.isDisconnected() && attacker.isOnSameTeam(defender)) {
        // No troop loss if defender is disconnected and on same team
        mag = 0;
      }
      if (
        attacker.type() === PlayerType.Human &&
        defender.type() === PlayerType.Bot
      ) {
        mag *= 0.8;
      }
      if (
        attacker.type() === PlayerType.Nation &&
        defender.type() === PlayerType.Bot
      ) {
        mag *= 0.8;
      }
    }

    if (defender.isPlayer()) {
      const defenseSig =
        1 -
        sigmoid(
          defender.numTilesOwned(),
          DEFENSE_DEBUFF_DECAY_RATE,
          DEFENSE_DEBUFF_MIDPOINT,
        );

      const largeDefenderSpeedDebuff = 0.7 + 0.3 * defenseSig;
      const largeDefenderAttackDebuff = 0.7 + 0.3 * defenseSig;

      let largeAttackBonus = 1;
      if (attacker.numTilesOwned() > 100_000) {
        largeAttackBonus = Math.sqrt(100_000 / attacker.numTilesOwned()) ** 0.7;
      }
      let largeAttackerSpeedBonus = 1;
      if (attacker.numTilesOwned() > 100_000) {
        largeAttackerSpeedBonus = (100_000 / attacker.numTilesOwned()) ** 0.6;
      }

      return {
        attackerTroopLoss:
          within(defender.troops() / attackTroops, 0.6, 2) *
          mag *
          0.8 *
          largeDefenderAttackDebuff *
          largeAttackBonus *
          (defender.isTraitor() ? this.traitorDefenseDebuff() : 1),
        defenderTroopLoss:
          defender.troops() / Math.max(1, defender.numTilesOwned()),
        tilesPerTickUsed:
          within(defender.troops() / (5 * attackTroops), 0.2, 1.5) *
          speed *
          largeDefenderSpeedDebuff *
          largeAttackerSpeedBonus *
          (defender.isTraitor() ? this.traitorSpeedDebuff() : 1),
      };
    } else {
      return {
        attackerTroopLoss:
          attacker.type() === PlayerType.Bot ? mag / 10 : mag / 5,
        defenderTroopLoss: 0,
        tilesPerTickUsed: within(
          (2000 * Math.max(10, speed)) / attackTroops,
          5,
          100,
        ),
      };
    }
  }

  attackTilesPerTick(
    attackTroops: number,
    attacker: Player,
    defender: Player | TerraNullius,
    numAdjacentTilesWithEnemy: number,
  ): number {
    if (defender.isPlayer()) {
      return (
        within(((5 * attackTroops) / defender.troops()) * 2, 0.01, 0.5) *
        numAdjacentTilesWithEnemy *
        3
      );
    } else {
      return numAdjacentTilesWithEnemy * 2;
    }
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
    return this.infiniteTroops() ? 1_000_000 : 25_000;
  }

  maxTroops(player: Player | PlayerView): number {
    const maxTroops =
      player.type() === PlayerType.Human && this.infiniteTroops()
        ? 1_000_000_000
        : 2 * (Math.pow(player.numTilesOwned(), 0.6) * 1000 + 50000) +
          player
            .units(UnitType.City)
            .filter((city) => !city.isUnderConstruction())
            .reduce((acc, city) => {
              const area = Math.PI * Math.pow(city.areaRadius() || 1, 2);
              const density = city.density() || 0;
              const population = area * 1500 * (1 + density);
              return acc + (isNaN(population) ? 0 : population);
            }, 0);

    if (player.type() === PlayerType.Bot) {
      return Math.max(1, maxTroops / 3);
    }

    if (player.type() === PlayerType.Human) {
      return Math.max(1, maxTroops);
    }

    switch (this._gameConfig.difficulty) {
      case Difficulty.Easy:
        return Math.max(1, maxTroops * 0.5);
      case Difficulty.Medium:
        return Math.max(1, maxTroops * 0.75);
      case Difficulty.Hard:
        return Math.max(1, maxTroops * 1); // Like humans
      case Difficulty.Impossible:
        return Math.max(1, maxTroops * 1.25);
      default:
        assertNever(this._gameConfig.difficulty);
    }
  }

  troopIncreaseRate(player: Player): number {
    const max = this.maxTroops(player);

    let toAdd = 10 + Math.pow(player.troops(), 0.73) / 4;

    const ratio = 1 - player.troops() / max;
    toAdd *= ratio;

    if (player.type() === PlayerType.Bot) {
      toAdd *= 0.6;
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

  goldAdditionRate(player: Player): Gold {
    const multiplier = this.goldMultiplier();
    let baseRate: bigint;
    if (player.type() === PlayerType.Bot) {
      baseRate = 50n;
    } else {
      baseRate = 100n;
    }

    // Cities generate extra gold based on area and density
    let cityIncome = 0;
    for (const city of player.units(UnitType.City)) {
      if (!city.isUnderConstruction()) {
        const area = Math.PI * Math.pow(city.areaRadius() || 1, 2);
        const density = city.density() || 0;
        cityIncome += area * 0.1 * (1 + density);
      }
    }

    if (isNaN(cityIncome)) {
      cityIncome = 0;
    }

    return BigInt(Math.floor((Number(baseRate) + cityIncome) * multiplier));
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

  defaultNukeSpeed(): number {
    return 6;
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
    return scalingFactor * (1 - Math.exp(-steepness * normalizedExcess));
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
