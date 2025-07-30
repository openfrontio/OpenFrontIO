import { Game, Player, UnitType, PlayerType, PlayerInfo } from "../src/core/game/Game";
import { TrainingCampExecution } from "../src/core/execution/TrainingCampExecution";
import { TileRef } from "../src/core/game/GameMap";
import { setup } from "./util/Setup";

describe("TrainingCampExecution", () => {
  let game: Game;
  let player: Player;
  let trainingCampExecution: TrainingCampExecution;
  let testTile: TileRef;

  beforeEach(async () => {
    game = await setup("giantworldmap");
    
    player = game.addPlayer({
      name: "TestPlayer",
      playerType: PlayerType.Human,
      clientID: "test-client",
      id: "test-player",
      clan: null,
    });

    testTile = 100;
    
    trainingCampExecution = new TrainingCampExecution(player, testTile);
  });

  it("should create training camp successfully", () => {
    trainingCampExecution.init(game, 0);
    
    trainingCampExecution.tick(0);
    
    const trainingCamps = player.units(UnitType.TrainingCamp);
    expect(trainingCamps.length).toBe(1);
    expect(trainingCamps[0].type()).toBe(UnitType.TrainingCamp);
  });

  it("should generate troops at regular intervals", () => {
    trainingCampExecution.init(game, 0);
    
    trainingCampExecution.tick(0);
    
    const initialTroops = player.troops();
    
    trainingCampExecution.tick(50);
    
    expect(player.troops()).toBeGreaterThan(initialTroops);
  });

  it("should respect population limits", () => {
    trainingCampExecution.init(game, 0);
    
    trainingCampExecution.tick(0);
    
    const maxPopulation = 100;
    jest.spyOn(game.config(), "maxPopulation").mockReturnValue(maxPopulation);
    jest.spyOn(player, "population").mockReturnValue(maxPopulation);
    
    const initialTroops = player.troops();
    
    trainingCampExecution.tick(50);
    
    expect(player.troops()).toBe(initialTroops);
  });

  it("should increase generation rate with level", () => {
    trainingCampExecution.init(game, 0);
    
    trainingCampExecution.tick(0);
    
    const trainingCamp = player.units(UnitType.TrainingCamp)[0];
    
    const troopsLevel1 = player.troops();
    trainingCampExecution.tick(50);
    const generatedLevel1 = player.troops() - troopsLevel1;
    
    trainingCamp.increaseLevel();
    
    const troopsLevel2 = player.troops();
    trainingCampExecution.tick(100);
    const generatedLevel2 = player.troops() - troopsLevel2;
    
    expect(generatedLevel2).toBeGreaterThan(generatedLevel1);
  });

  it("should stop generating when camp is destroyed", () => {
    trainingCampExecution.init(game, 0);
    
    trainingCampExecution.tick(0);
    
    const trainingCamp = player.units(UnitType.TrainingCamp)[0];
    const initialTroops = player.troops();
    
    trainingCamp.delete();
    
    trainingCampExecution.tick(50);
    
    expect(player.troops()).toBe(initialTroops);
  });

  it("should be active when camp exists and player is alive", () => {
    trainingCampExecution.init(game, 0);
    
    expect(trainingCampExecution.isActive()).toBe(true);
    
    trainingCampExecution.tick(0);
    
    expect(trainingCampExecution.isActive()).toBe(true);
  });

  it("should not be active during spawn phase", () => {
    trainingCampExecution.init(game, 0);
    
    expect(trainingCampExecution.activeDuringSpawnPhase()).toBe(false);
  });
}); 