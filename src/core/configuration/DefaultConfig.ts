import { JWK } from "jose";
import { z } from "zod";
import {
  Difficulty,
  Duos,
  Game,
  GameMapType,
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
import { GameConfig, GameID } from "../Schemas";
import { assertNever, simpleHash, within } from "../Util";
import { Config, GameEnv, NukeMagnitude, ServerConfig, Theme } from "./Config";
import { PastelTheme } from "./PastelTheme";
import { PastelThemeDark } from "./PastelThemeDark";

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

const numPlayersConfig = {
  [GameMapType.GatewayToTheAtlantic]: [80, 60, 40],
  [GameMapType.SouthAmerica]: [70, 50, 40],
  [GameMapType.NorthAmerica]: [80, 60, 50],
  [GameMapType.Africa]: [100, 80, 50],
  [GameMapType.Europe]: [80, 50, 30],
  [GameMapType.Australia]: [50, 40, 30],
  [GameMapType.Iceland]: [50, 40, 30],
  [GameMapType.Britannia]: [50, 40, 30],
  [GameMapType.Asia]: [60, 50, 30],
  [GameMapType.FalklandIslands]: [80, 50, 30],
  [GameMapType.Baikal]: [60, 50, 40],
  [GameMapType.Mena]: [60, 50, 30],
  [GameMapType.Mars]: [50, 40, 30],
  [GameMapType.Oceania]: [30, 20, 10],
  [GameMapType.Japan]: [50, 40, 30],
  [GameMapType.FaroeIslands]: [50, 40, 30],
  [GameMapType.DeglaciatedAntarctica]: [50, 40, 30],
  [GameMapType.EuropeClassic]: [80, 30, 50],
  [GameMapType.BetweenTwoSeas]: [40, 50, 30],
  [GameMapType.BlackSea]: [40, 50, 30],
  [GameMapType.Pangaea]: [40, 20, 30],
  [GameMapType.World]: [150, 80, 50],
  [GameMapType.WorldMapGiant]: [150, 100, 60],
  [GameMapType.Halkidiki]: [50, 40, 30],
} as const satisfies Record<GameMapType, [number, number, number]>;

const TERRAIN_EFFECTS = {
  [TerrainType.Plains]: { mag: 1.1, speed: 0.8 }, // higher speed, lower damage
  [TerrainType.Highland]: { mag: 1.2, speed: 1 },
  [TerrainType.Mountain]: { mag: 1.3, speed: 1.25 },
} as const;

export abstract class DefaultServerConfig implements ServerConfig {
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
    const jwks = JwksSchema.parse(await response.json());
    this.publicKey = jwks.keys[0];
    return this.publicKey;
  }
  otelEnabled(): boolean {
    return (
      Boolean(this.otelEndpoint()) &&
      Boolean(this.otelUsername()) &&
      Boolean(this.otelPassword())
    );
  }
  otelEndpoint(): string {
    return process.env.OTEL_ENDPOINT ?? "";
  }
  otelUsername(): string {
    return process.env.OTEL_USERNAME ?? "";
  }
  otelPassword(): string {
    return process.env.OTEL_PASSWORD ?? "";
  }
  region(): string {
    if (this.env() === GameEnv.Dev) {
      return "dev";
    }
    return process.env.REGION ?? "";
  }
  gitCommit(): string {
    return process.env.GIT_COMMIT ?? "";
  }
  r2Endpoint(): string {
    return `https://${process.env.CF_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  }
  r2AccessKey(): string {
    return process.env.R2_ACCESS_KEY ?? "";
  }
  r2SecretKey(): string {
    return process.env.R2_SECRET_KEY ?? "";
  }

  r2Bucket(): string {
    return process.env.R2_BUCKET ?? "";
  }

  adminHeader(): string {
    return "x-admin-key";
  }
  adminToken(): string {
    return process.env.ADMIN_TOKEN ?? "dummy-admin-token";
  }
  abstract numWorkers(): number;
  abstract env(): GameEnv;
  turnIntervalMs(): number {
    return 100;
  }
  gameCreationRate(): number {
    return 60 * 1000;
  }

  lobbyMaxPlayers(map: GameMapType, mode: GameMode): number {
    const [l, m, s] = numPlayersConfig[map] ?? [50, 30, 20];
    const r = Math.random();
    const base = r < 0.3 ? l : r < 0.6 ? m : s;
    return Math.min(mode === GameMode.Team ? Math.ceil(base * 1.5) : base, 150);
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
  isReplay(): boolean {
    return this._isReplay;
  }

  samHittingChance(): number {
    return 0.8;
  }

  samWarheadHittingChance(): number {
    return 0.5;
  }

  traitorDefenseDebuff(): number {
    return 0.5;
  }
  traitorDuration(): number {
    return 30 * 10; // 30 seconds
  }
  spawnImmunityDuration(): Tick {
    return 5 * 10;
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

  difficultyModifier(difficulty: Difficulty): number {
    switch (difficulty) {
      case Difficulty.Easy:
        return 1;
      case Difficulty.Medium:
        return 3;
      case Difficulty.Hard:
        return 9;
      case Difficulty.Impossible:
        return 18;
    }
  }

  cityPopulationIncrease(): number {
    return 250_000;
  }

  falloutDefenseModifier(falloutRatio: number): number {
    // falloutRatio is between 0 and 1
    // So defense modifier is between [3, 1]
    return 2 - falloutRatio;
  }
  SAMCooldown(): number {
    return 75;
  }
  SiloCooldown(): number {
    return 75;
  }

  defensePostRange(): number {
    return 40;
  }
  defensePostLossMultiplier(): number {
    return 6;
  }
  defensePostSpeedMultiplier(): number {
    return 3;
  }
  playerTeams(): number | typeof Duos {
    return this._gameConfig.playerTeams ?? 0;
  }

  spawnNPCs(): boolean {
    return !this._gameConfig.disableNPCs;
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
  infiniteGold(): boolean {
    return this._gameConfig.infiniteGold;
  }
  infiniteTroops(): boolean {
    return this._gameConfig.infiniteTroops;
  }
  tradeShipGold(dist: number): Gold {
    return 10000 + 150 * Math.pow(dist, 1.1);
  }
  tradeShipSpawnRate(numberOfPorts: number): number {
    return Math.round(10 * Math.pow(numberOfPorts, 0.4));
  }

  unitInfo(type: UnitType): UnitInfo {
    switch (type) {
      case UnitType.TransportShip:
        return {
          cost: () => 0,
          territoryBound: false,
        };
      case UnitType.Warship:
        return {
          cost: (p: Player) =>
            p.type() === PlayerType.Human && this.infiniteGold()
              ? 0
              : Math.min(
                  1_000_000,
                  (p.unitsIncludingConstruction(UnitType.Warship).length + 1) *
                    250_000,
                ),
          territoryBound: false,
          maxHealth: 1000,
        };
      case UnitType.Shell:
        return {
          cost: () => 0,
          territoryBound: false,
          damage: 250,
        };
      case UnitType.SAMMissile:
        return {
          cost: () => 0,
          territoryBound: false,
        };
      case UnitType.Port:
        return {
          cost: (p: Player) =>
            p.type() === PlayerType.Human && this.infiniteGold()
              ? 0
              : Math.min(
                  1_000_000,
                  Math.pow(
                    2,
                    p.unitsIncludingConstruction(UnitType.Port).length,
                  ) * 125_000,
                ),
          territoryBound: true,
          constructionDuration: this.instantBuild() ? 0 : 2 * 10,
        };
      case UnitType.AtomBomb:
        return {
          cost: (p: Player) =>
            p.type() === PlayerType.Human && this.infiniteGold() ? 0 : 750_000,
          territoryBound: false,
        };
      case UnitType.HydrogenBomb:
        return {
          cost: (p: Player) =>
            p.type() === PlayerType.Human && this.infiniteGold()
              ? 0
              : 5_000_000,
          territoryBound: false,
        };
      case UnitType.MIRV:
        return {
          cost: (p: Player) =>
            p.type() === PlayerType.Human && this.infiniteGold()
              ? 0
              : 25_000_000,
          territoryBound: false,
        };
      case UnitType.MIRVWarhead:
        return {
          cost: () => 0,
          territoryBound: false,
        };
      case UnitType.TradeShip:
        return {
          cost: () => 0,
          territoryBound: false,
        };
      case UnitType.MissileSilo:
        return {
          cost: (p: Player) =>
            p.type() === PlayerType.Human && this.infiniteGold()
              ? 0
              : 1_000_000,
          territoryBound: true,
          constructionDuration: this.instantBuild() ? 0 : 10 * 10,
        };
      case UnitType.DefensePost:
        return {
          cost: (p: Player) =>
            p.type() === PlayerType.Human && this.infiniteGold()
              ? 0
              : Math.min(
                  250_000,
                  (p.unitsIncludingConstruction(UnitType.DefensePost).length +
                    1) *
                    50_000,
                ),
          territoryBound: true,
          constructionDuration: this.instantBuild() ? 0 : 5 * 10,
        };
      case UnitType.SAMLauncher:
        return {
          cost: (p: Player) =>
            p.type() === PlayerType.Human && this.infiniteGold()
              ? 0
              : Math.min(
                  3_000_000,
                  (p.unitsIncludingConstruction(UnitType.SAMLauncher).length +
                    1) *
                    1_500_000,
                ),
          territoryBound: true,
          constructionDuration: this.instantBuild() ? 0 : 30 * 10,
        };
      case UnitType.City:
        return {
          cost: (p: Player) =>
            p.type() === PlayerType.Human && this.infiniteGold()
              ? 0
              : Math.min(
                  1_000_000,
                  Math.pow(
                    2,
                    p.unitsIncludingConstruction(UnitType.City).length,
                  ) * 125_000,
                ),
          territoryBound: true,
          constructionDuration: this.instantBuild() ? 0 : 2 * 10,
        };
      case UnitType.Construction:
        return {
          cost: () => 0,
          territoryBound: true,
        };
      default:
        assertNever(type);
    }
  }
  defaultDonationAmount(sender: Player): number {
    return Math.floor(sender.troops() / 3);
  }
  donateCooldown(): Tick {
    return 10 * 10;
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
  allianceRequestCooldown(): Tick {
    return 30 * 10;
  }
  allianceDuration(): Tick {
    return 600 * 10; // 10 minutes.
  }
  temporaryEmbargoDuration(): Tick {
    return 300 * 10; // 5 minutes.
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
    const type = gm.terrainType(tileToConquer);
    const mod = TERRAIN_EFFECTS[type];
    if (!mod) {
      throw new Error(`terrain type ${type} not supported`);
    }
    let mag = mod.mag;
    let speed = mod.speed;

    const attackerType = attacker.type();
    const defenderIsPlayer = defender.isPlayer();
    const defenderType = defenderIsPlayer ? defender.type() : null;

    if (defenderIsPlayer) {
      for (const dp of gm.nearbyUnits(
        tileToConquer,
        gm.config().defensePostRange(),
        UnitType.DefensePost,
      )) {
        if (dp.unit.owner() === defender) {
          mag *= this.defensePostLossMultiplier();
          speed *= this.defensePostSpeedMultiplier();
          break;
        }
      }
    }

    if (gm.hasFallout(tileToConquer)) {
      const falloutRatio = gm.numTilesWithFallout() / gm.numLandTiles();
      mag *= this.falloutDefenseModifier(falloutRatio);
      speed *= this.falloutDefenseModifier(falloutRatio);
    }

    if (attacker.isPlayer() && defenderIsPlayer) {
      if (
        (attackerType === PlayerType.Human ||
          attackerType === PlayerType.FakeHuman) &&
        defenderType === PlayerType.Bot
      ) {
        mag *= 0.6;
        speed *= 0.6;
      }
    }
    if (attackerType === PlayerType.Bot) {
      speed *= 4; // slow bot attacks
    }
    if (defenderIsPlayer) {
      const defenderTroops = defender.troops();
      const defenderTiles = defender.numTilesOwned();
      const defenderDensity = defenderTroops / defenderTiles;
      const attackRatio = defenderTroops / attackTroops;
      const traitorDebuff = defender.isTraitor()
        ? this.traitorDefenseDebuff()
        : 1;
      const baseTroopLoss = 16;
      const baseTileCost = 30;
      const attackStandardSize = 10_000;
      return {
        attackerTroopLoss:
          mag * (baseTroopLoss + defenderDensity * traitorDebuff),
        defenderTroopLoss: defenderDensity,
        tilesPerTickUsed:
          baseTileCost *
          within(defenderDensity, 3, 100) ** 0.2 *
          (attackStandardSize / attackTroops) ** 0.1 *
          speed *
          within(attackRatio, 0.1, 20) ** 0.35,
      };
    } else {
      return {
        attackerTroopLoss: 16 * mag,
        defenderTroopLoss: 0,
        tilesPerTickUsed: 492 * speed * within(attackTroops, 1, 10000) ** -0.3,
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
      return 10 * numAdjacentTilesWithEnemy;
    } else {
      return 12 * numAdjacentTilesWithEnemy;
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
      return 6_000;
    }
    if (playerInfo.playerType === PlayerType.FakeHuman) {
      switch (this._gameConfig.difficulty) {
        case Difficulty.Easy:
          return 2_500 + 1000 * (playerInfo?.nation?.strength ?? 1);
        case Difficulty.Medium:
          return 6_000 + 2000 * (playerInfo?.nation?.strength ?? 1);
        case Difficulty.Hard:
          return 20_000 + 4000 * (playerInfo?.nation?.strength ?? 1);
        case Difficulty.Impossible:
          return 50_000 + 8000 * (playerInfo?.nation?.strength ?? 1);
      }
    }
    return this.infiniteTroops() ? 1_000_000 : 20_000;
  }

  maxPopulation(player: Player | PlayerView): number {
    const maxPop =
      player.type() === PlayerType.Human && this.infiniteTroops()
        ? 1_000_000_000
        : 1 * (player.numTilesOwned() * 30 + 50000) +
          player.units(UnitType.City).length * this.cityPopulationIncrease();

    if (player.type() === PlayerType.Bot) {
      return maxPop / 2;
    }

    if (player.type() === PlayerType.Human) {
      return maxPop;
    }

    switch (this._gameConfig.difficulty) {
      case Difficulty.Easy:
        return maxPop * 0.4;
      case Difficulty.Medium:
        return maxPop * 0.8;
      case Difficulty.Hard:
        return maxPop * 1.4;
      case Difficulty.Impossible:
        return maxPop * 1.8;
    }
  }

  populationIncreaseRate(player: Player): number {
    const max = this.maxPopulation(player);
    //population grows proportional to current population with growth decreasing as it approaches max
    // smaller countries recieve a boost to pop growth to speed up early game
    const baseAdditionRate = 10;
    const basePopGrowthRate = 1100 / max + 1 / 160;
    const reproductionPop = 0.9 * player.troops() + 1.1 * player.workers();
    let toAdd = baseAdditionRate + basePopGrowthRate * reproductionPop;
    const totalPop = player.totalPopulation();
    const ratio = 1 - totalPop / max;
    toAdd *= ratio;

    if (player.type() === PlayerType.Bot) {
      toAdd *= 0.7;
    }

    if (player.type() === PlayerType.FakeHuman) {
      switch (this._gameConfig.difficulty) {
        case Difficulty.Easy:
          toAdd *= 0.9;
          break;
        case Difficulty.Medium:
          toAdd *= 1;
          break;
        case Difficulty.Hard:
          toAdd *= 1.1;
          break;
        case Difficulty.Impossible:
          toAdd *= 1.2;
          break;
      }
    }

    return Math.min(totalPop + toAdd, max) - totalPop;
  }

  goldAdditionRate(player: Player): number {
    return 0.045 * player.workers() ** 0.7;
  }

  troopAdjustmentRate(player: Player): number {
    const maxDiff = this.maxPopulation(player) / 500;
    const target = player.population() * player.targetTroopRatio();
    const diff = target - player.troops();
    if (Math.abs(diff) < maxDiff) {
      return diff;
    }
    const adjustment = maxDiff * Math.sign(diff);
    // Can ramp down troops much faster
    if (adjustment < 0) {
      return adjustment * 5;
    }
    return adjustment;
  }

  nukeMagnitudes(unitType: UnitType): NukeMagnitude {
    switch (unitType) {
      case UnitType.MIRVWarhead:
        return { inner: 25, outer: 30 };
      case UnitType.AtomBomb:
        return { inner: 12, outer: 30 };
      case UnitType.HydrogenBomb:
        return { inner: 80, outer: 100 };
    }
    throw new Error(`Unknown nuke type: ${unitType}`);
  }

  defaultNukeSpeed(): number {
    return 4;
  }

  // Humans can be population, soldiers attacking, soldiers in boat etc.
  nukeDeathFactor(humans: number, tilesOwned: number): number {
    return (5 * humans) / Math.max(1, tilesOwned);
  }

  structureMinDist(): number {
    // TODO: Increase this to ~15 once upgradable structures are implemented.
    return 1;
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
}
