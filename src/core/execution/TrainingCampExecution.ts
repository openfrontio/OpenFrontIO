import { Execution, Game, Player, Unit, UnitType, MessageType } from "../game/Game";
import { TileRef } from "../game/GameMap";

export class TrainingCampExecution implements Execution {
  private trainingCamp: Unit | null = null;
  private active: boolean = true;
  private game: Game;
  private lastTroopGeneration: number = 0;
  private readonly TROOP_GENERATION_INTERVAL = 20;
  private readonly BASE_TROOP_GENERATION = 100;
  private readonly LEVEL_MULTIPLIER = 1.5;

  constructor(
    private player: Player,
    private tile: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    this.game = mg;
    this.lastTroopGeneration = ticks;
    console.log("TrainingCampExecution initialized with ticks:", ticks);
    console.log("Game config:", this.game.config());
    console.log("Player alive:", this.player.isAlive());
  }

  tick(ticks: number): void {
    console.log(`TrainingCampExecution tick ${ticks}, active: ${this.active}, camp: ${this.trainingCamp ? 'exists' : 'null'}`);
    
    if (this.trainingCamp === null) {
      console.log("Creating training camp...");
      const spawnTile = this.player.canBuild(UnitType.TrainingCamp, this.tile);
      console.log("Spawn tile result:", spawnTile);
      if (spawnTile === false) {
        console.warn("cannot build training camp");
        this.active = false;
        return;
      }
      this.trainingCamp = this.player.buildUnit(UnitType.TrainingCamp, spawnTile, {});
      console.log("Training camp created:", this.trainingCamp);
      console.log("Training camp type:", this.trainingCamp.type());
      console.log("Training camp owner:", this.trainingCamp.owner().name());
      console.log("Training camp tile:", this.trainingCamp.tile());
      console.log("Training camp active:", this.trainingCamp.isActive());
      console.log("Training camp level:", this.trainingCamp.level());
      console.log("Player troops before:", this.player.troops());
    }

    if (!this.trainingCamp.isActive()) {
      console.log("Training camp is not active - deactivating execution");
      this.active = false;
      return;
    }

    if (ticks % 50 === 0) {
      console.log(`Training camp status - active: ${this.trainingCamp.isActive()}, level: ${this.trainingCamp.level()}, owner: ${this.trainingCamp.owner().name()}`);
    }

    if (this.player !== this.trainingCamp.owner()) {
      this.player = this.trainingCamp.owner();
    }

    if (ticks % 100 === 0) {
      console.log(`Training camp level: ${this.trainingCamp.level()}, active: ${this.trainingCamp.isActive()}`);
    }

    if (ticks - this.lastTroopGeneration >= this.TROOP_GENERATION_INTERVAL) {
      console.log(`Generating troops... ticks: ${ticks}, last: ${this.lastTroopGeneration}, interval: ${this.TROOP_GENERATION_INTERVAL}`);
      this.generateTroops();
      this.lastTroopGeneration = ticks;
    } else {
      const ticksUntilGeneration = this.lastTroopGeneration + this.TROOP_GENERATION_INTERVAL - ticks;
      console.log(`Waiting for troop generation... ticks: ${ticks}, last: ${this.lastTroopGeneration}, interval: ${this.TROOP_GENERATION_INTERVAL}, ticks until generation: ${ticksUntilGeneration}`);
    }
  }

  private generateTroops(): void {
    if (!this.trainingCamp || !this.player.isAlive()) {
      console.log("Cannot generate troops - camp or player not available");
      return;
    }

    const level = this.trainingCamp.level();
    const baseGeneration = this.BASE_TROOP_GENERATION;
    const levelBonus = Math.pow(this.LEVEL_MULTIPLIER, level - 1);
    const troopsToGenerate = Math.floor(baseGeneration * levelBonus);

    const maxPopulation = this.game.config().maxPopulation(this.player);
    const currentPopulation = this.player.population();
    const availableSpace = maxPopulation - currentPopulation;

    console.log(`Training camp level ${level}, generating ${troopsToGenerate} troops`);
    console.log(`Population: ${currentPopulation}/${maxPopulation}, available: ${availableSpace}`);
    console.log(`Player troops before: ${this.player.troops()}`);

    if (availableSpace > 0) {
      const actualGeneration = Math.min(troopsToGenerate, availableSpace);
      if (actualGeneration > 0) {
        this.player.addTroops(actualGeneration);
        console.log(`Added ${actualGeneration} troops to player`);
        console.log(`Player troops after: ${this.player.troops()}`);
        
        this.game.displayMessage(
          `Camp d'entraînement niveau ${level} a généré ${actualGeneration} troupes`,
          MessageType.TRAINING_CAMP_GENERATION,
          this.player.id(),
        );
      }
    } else {
      console.log("No space available for troops");
    }
  }

  isActive(): boolean {
    console.log(`TrainingCampExecution isActive: ${this.active}, camp: ${this.trainingCamp ? 'exists' : 'null'}`);
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
} 