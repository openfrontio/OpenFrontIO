import {
  Difficulty,
  Game,
  GameMapType,
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
import { GameMap, TileRef } from "../game/GameMap";
import { PlayerView } from "../game/GameView";
import { UserSettings } from "../game/UserSettings";
import { GameConfig, GameID } from "../Schemas";
import { assertNever, simpleHash, within } from "../Util";
import { Config, GameEnv, ServerConfig, Theme } from "./Config";
import { pastelTheme } from "./PastelTheme";
import { pastelThemeDark } from "./PastelThemeDark";

export abstract class DefaultServerConfig implements ServerConfig {
  region(): string {
    if (this.env() == GameEnv.Dev) {
      return "dev";
    }
    return process.env.REGION;
  }
  gitCommit(): string {
    return process.env.GIT_COMMIT;
  }
  r2Endpoint(): string {
    return process.env.R2_ENDPOINT;
  }
  r2AccessKey(): string {
    return process.env.R2_ACCESS_KEY;
  }
  r2SecretKey(): string {
    return process.env.R2_SECRET_KEY;
  }
  abstract r2Bucket(): string;
  adminHeader(): string {
    return "x-admin-key";
  }
  adminToken(): string {
    return process.env.ADMIN_TOKEN;
  }
  abstract numWorkers(): number;
  abstract env(): GameEnv;
  abstract discordRedirectURI(): string;
  turnIntervalMs(): number {
    return 100;
  }
  gameCreationRate(): number {
    return 30 * 1000;
  }
  lobbyMaxPlayers(map: GameMapType): number {
    if (map == GameMapType.World) {
      return Math.random() < 0.3 ? 150 : 60;
    }
    if (
      [GameMapType.Mars, GameMapType.Africa, GameMapType.BlackSea].includes(map)
    ) {
      return Math.random() < 0.3 ? 70 : 50;
    }
    return Math.random() < 0.3 ? 60 : 40;
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
  constructor(
    private _serverConfig: ServerConfig,
    private _gameConfig: GameConfig,
    private _userSettings: UserSettings,
  ) {}

  traitorDefenseDebuff(): number {
    return 0.8;
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

  userSettings(): UserSettings | null {
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
    // So defense modifier is between [5, 2.5]
    return 5 - falloutRatio * 2;
  }

  defensePostRange(): number {
    return 30;
  }
  defensePostDefenseBonus(): number {
    return 5;
  }
  spawnNPCs(): boolean {
    return !this._gameConfig.disableNPCs;
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
    if (numberOfPorts <= 3) return 180;
    if (numberOfPorts <= 5) return 250;
    if (numberOfPorts <= 8) return 350;
    if (numberOfPorts <= 10) return 400;
    if (numberOfPorts <= 12) return 450;
    return 500;
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
            p.type() == PlayerType.Human && this.infiniteGold()
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
            p.type() == PlayerType.Human && this.infiniteGold()
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
            p.type() == PlayerType.Human && this.infiniteGold() ? 0 : 750_000,
          territoryBound: false,
        };
      case UnitType.HydrogenBomb:
        return {
          cost: (p: Player) =>
            p.type() == PlayerType.Human && this.infiniteGold() ? 0 : 5_000_000,
          territoryBound: false,
        };
      case UnitType.MIRV:
        return {
          cost: (p: Player) =>
            p.type() == PlayerType.Human && this.infiniteGold()
              ? 0
              : 15_000_000,
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
            p.type() == PlayerType.Human && this.infiniteGold() ? 0 : 1_000_000,
          territoryBound: true,
          constructionDuration: this.instantBuild() ? 0 : 10 * 10,
        };
      case UnitType.DefensePost:
        return {
          cost: (p: Player) =>
            p.type() == PlayerType.Human && this.infiniteGold()
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
            p.type() == PlayerType.Human && this.infiniteGold()
              ? 0
              : Math.min(
                  1_500_000 * 3,
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
            p.type() == PlayerType.Human && this.infiniteGold()
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
  percentageTilesOwnedToWin(): number {
    return 80;
  }
  boatMaxNumber(): number {
    return 3;
  }
  numSpawnPhaseTurns(): number {
    return this._gameConfig.gameType == GameType.Singleplayer ? 100 : 300;
  }
  numBots(): number {
    return this.bots();
  }
  theme(): Theme {
    return this.userSettings().darkMode() ? pastelThemeDark : pastelTheme;
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
        mag = 85;
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
      for (const dp of gm.nearbyDefensePosts(tileToConquer)) {
        if (dp.owner() == defender) {
          mag *= this.defensePostDefenseBonus();
          speed *= this.defensePostDefenseBonus();
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
      if (
        attacker.type() == PlayerType.Human &&
        defender.type() == PlayerType.Bot
      ) {
        mag *= 0.8;
      }
      if (
        attacker.type() == PlayerType.FakeHuman &&
        defender.type() == PlayerType.Bot
      ) {
        mag *= 0.8;
      }
    }

    let largeLossModifier = 1;
    if (attacker.numTilesOwned() > 100_000) {
      largeLossModifier = Math.sqrt(100_000 / attacker.numTilesOwned());
    }
    let largeSpeedMalus = 1;
    if (attacker.numTilesOwned() > 75_000) {
      // sqrt is only exponent 1/2 which doesn't slow enough huge players
      largeSpeedMalus = (75_000 / attacker.numTilesOwned()) ** 0.6;
    }

    if (defender.isPlayer()) {
      return {
        attackerTroopLoss:
          within(defender.troops() / attackTroops, 0.6, 2) *
          mag *
          0.8 *
          largeLossModifier *
          (defender.isTraitor() ? this.traitorDefenseDebuff() : 1),
        defenderTroopLoss: defender.troops() / defender.numTilesOwned(),
        tilesPerTickUsed:
          within(defender.troops() / (5 * attackTroops), 0.2, 1.5) *
          speed *
          largeSpeedMalus,
      };
    } else {
      return {
        attackerTroopLoss:
          attacker.type() == PlayerType.Bot ? mag / 10 : mag / 5,
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

  attackAmount(attacker: Player, defender: Player | TerraNullius) {
    if (attacker.type() == PlayerType.Bot) {
      return attacker.troops() / 20;
    } else {
      return attacker.troops() / 5;
    }
  }

  startManpower(playerInfo: PlayerInfo): number {
    if (playerInfo.playerType == PlayerType.Bot) {
      return 10_000;
    }
    if (playerInfo.playerType == PlayerType.FakeHuman) {
      switch (this._gameConfig.difficulty) {
        case Difficulty.Easy:
          return 2_500 * (playerInfo?.nation?.strength ?? 1);
        case Difficulty.Medium:
          return 5_000 * (playerInfo?.nation?.strength ?? 1);
        case Difficulty.Hard:
          return 20_000 * (playerInfo?.nation?.strength ?? 1);
        case Difficulty.Impossible:
          return 50_000 * (playerInfo?.nation?.strength ?? 1);
      }
    }
    return this.infiniteTroops() ? 1_000_000 : 25_000;
  }

  maxPopulation(player: Player | PlayerView): number {
    const maxPop =
      player.type() == PlayerType.Human && this.infiniteTroops()
        ? 1_000_000_000
        : 2 * (Math.pow(player.numTilesOwned(), 0.6) * 1000 + 50000) +
          player.units(UnitType.City).length * this.cityPopulationIncrease();

    if (player.type() == PlayerType.Bot) {
      return maxPop / 2;
    }

    if (player.type() == PlayerType.Human) {
      return maxPop;
    }

    switch (this._gameConfig.difficulty) {
      case Difficulty.Easy:
        return maxPop * 0.5;
      case Difficulty.Medium:
        return maxPop * 1;
      case Difficulty.Hard:
        return maxPop * 1.5;
      case Difficulty.Impossible:
        return maxPop * 2;
    }
  }

  populationIncreaseRate(player: Player): number {
    const max = this.maxPopulation(player);

    let toAdd = 10 + Math.pow(player.population(), 0.73) / 4;

    const ratio = 1 - player.population() / max;
    toAdd *= ratio;

    if (player.type() == PlayerType.Bot) {
      toAdd *= 0.7;
    }

    if (player.type() == PlayerType.FakeHuman) {
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

    return Math.min(player.population() + toAdd, max) - player.population();
  }

  goldAdditionRate(player: Player): number {
    return Math.sqrt(player.workers() * player.numTilesOwned()) / 200;
  }

  troopAdjustmentRate(player: Player): number {
    const maxDiff = this.maxPopulation(player) / 1000;
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
}
