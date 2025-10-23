import {
  Execution,
  Game,
  Nation,
  Player,
  TerrainType,
} from "../../../game/Game";
import { TileRef } from "../../../game/GameMap";
import { PseudoRandom } from "../../../PseudoRandom";
import { GameID } from "../../../Schemas";
import { simpleHash } from "../../../Util";
import { SpawnExecution } from "../../SpawnExecution";
import { BotBehavior } from "../../utils/BotBehavior";
import { DiplomacyAdvisor } from "../advisors/DiplomacyAdvisor";
import { EconomyAdvisor } from "../advisors/EconomyAdvisor";
import { MilitaryAdvisor } from "../advisors/MilitaryAdvisor";
import { MIRVAdvisor } from "../advisors/MIRVAdvisor";

export class FakeHumanCoordinator implements Execution {
  private active = true;
  private random: PseudoRandom;
  private behavior: BotBehavior | null = null; // Shared behavior logic for both bots and fakehumans
  private mg: Game;
  private player: Player | null = null;
  private diplomacyAdvisor: DiplomacyAdvisor | null = null;
  private economyAdvisor: EconomyAdvisor | null = null;
  private mirvAdvisor: MIRVAdvisor | null = null;
  private militaryAdvisor: MilitaryAdvisor | null = null;

  private attackRate: number;
  private attackTick: number;
  private triggerRatio: number;
  private reserveRatio: number;
  private expandRatio: number;

  constructor(
    gameID: GameID,
    private nation: Nation, // Nation contains PlayerInfo with PlayerType.FakeHuman
  ) {
    this.random = new PseudoRandom(
      simpleHash(nation.playerInfo.id) + simpleHash(gameID),
    );
    this.attackRate = this.random.nextInt(40, 80);
    this.attackTick = this.random.nextInt(0, this.attackRate);
    this.triggerRatio = this.random.nextInt(50, 60) / 100;
    this.reserveRatio = this.random.nextInt(30, 40) / 100;
    this.expandRatio = this.random.nextInt(10, 20) / 100;
  }

  init(mg: Game) {
    this.mg = mg;
    if (this.random.chance(10)) {
      // this.isTraitor = true
    }
  }

  tick(ticks: number) {
    if (ticks % this.attackRate !== this.attackTick) return;

    if (this.mg.inSpawnPhase()) {
      const rl = this.randomSpawnLand();
      if (rl === null) {
        console.warn(`cannot spawn ${this.nation.playerInfo.name}`);
        return;
      }
      this.mg.addExecution(new SpawnExecution(this.nation.playerInfo, rl));
      return;
    }

    if (this.player === null) {
      this.player =
        this.mg.players().find((p) => p.id() === this.nation.playerInfo.id) ??
        null;
      if (this.player === null) {
        return;
      }
    }

    if (!this.player.isAlive()) {
      this.active = false;
      return;
    }

    if (this.behavior === null) {
      // Player is unavailable during init()
      this.behavior = new BotBehavior(
        this.random,
        this.mg,
        this.player,
        this.triggerRatio,
        this.reserveRatio,
        this.expandRatio,
      );

      // Send an attack on the first tick
      this.behavior.forceSendAttack(this.mg.terraNullius());
      return;
    }

    // Try DiplomacyAdvisor first for diplomatic decisions
    this.diplomacyAdvisor ??= new DiplomacyAdvisor({
      game: this.mg,
      player: this.player,
      random: this.random,
    });

    const diplomacyRecommendation = this.diplomacyAdvisor.recommend();
    if (diplomacyRecommendation) {
      diplomacyRecommendation.execute();
    }
    // No fallback - DiplomacyAdvisor handles all diplomatic decisions

    this.behavior.handleAllianceRequests();
    this.behavior.handleAllianceExtensionRequests();

    // Try EconomyAdvisor first, fall back to original code if no recommendation
    this.economyAdvisor ??= new EconomyAdvisor({
      game: this.mg,
      player: this.player,
      random: this.random,
    });

    const economyRecommendation = this.economyAdvisor.recommend();
    if (economyRecommendation) {
      economyRecommendation.execute();
    }
    // No fallback - EconomyAdvisor handles all structure building

    // Try MIRVAdvisor first, fall back to original code if no recommendation
    this.mirvAdvisor ??= new MIRVAdvisor({
      game: this.mg,
      player: this.player,
      random: this.random,
    });

    const mirvRecommendation = this.mirvAdvisor.recommend();
    if (mirvRecommendation) {
      mirvRecommendation.execute();
    }
    // No fallback - MIRVAdvisor handles all MIRV decisions

    // Try MilitaryAdvisor for all military decisions
    this.militaryAdvisor ??= new MilitaryAdvisor({
      game: this.mg,
      player: this.player,
      random: this.random,
    });

    // Wire BotBehavior to MilitaryAdvisor for attack execution
    if (this.behavior && this.militaryAdvisor) {
      this.militaryAdvisor.setBehavior(this.behavior);
    }

    const militaryRecommendation = this.militaryAdvisor.recommend();
    if (militaryRecommendation) {
      militaryRecommendation.execute();
    }
    // No fallback - MilitaryAdvisor handles all military decisions
  }

  randomSpawnLand(): TileRef | null {
    const delta = 25;
    let tries = 0;
    while (tries < 50) {
      tries++;
      const cell = this.nation.spawnCell;
      const x = this.random.nextInt(cell.x - delta, cell.x + delta);
      const y = this.random.nextInt(cell.y - delta, cell.y + delta);
      if (!this.mg.isValidCoord(x, y)) {
        continue;
      }
      const tile = this.mg.ref(x, y);
      if (this.mg.isLand(tile) && !this.mg.hasOwner(tile)) {
        if (
          this.mg.terrainType(tile) === TerrainType.Mountain &&
          this.random.chance(2)
        ) {
          continue;
        }
        return tile;
      }
    }
    return null;
  }
  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return true;
  }
}
