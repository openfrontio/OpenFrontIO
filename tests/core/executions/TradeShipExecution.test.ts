import { TradeShipExecution } from "../../../src/core/execution/TradeShipExecution";
import { Game, Player, Unit } from "../../../src/core/game/Game";
import { setup } from "../../util/Setup";

describe("TradeShipExecution", () => {
  let game: Game;
  let origOwner: Player;
  let dstOwner: Player;
  let pirate: Player;
  let srcPort: Unit;
  let piratePort: Unit;
  let tradeShip: Unit;
  let dstPort: Unit;
  let tradeShipExecution: TradeShipExecution;

  beforeEach(async () => {
    // Mock Game, Player, Unit, and required methods

    game = await setup("ocean_and_land", {
      infiniteGold: true,
      instantBuild: true,
    });
    game.displayMessage = jest.fn();
    origOwner = {
      addGold: jest.fn(),
      buildUnit: jest.fn((type, spawn, opts) => tradeShip),
      canBuild: jest.fn(() => true),
      canTrade: jest.fn(() => true),
      displayName: jest.fn(() => "Origin"),
      id: jest.fn(() => 1),
      unitCount: jest.fn(() => 1),
      units: jest.fn(() => [dstPort]),
    } as any;

    dstOwner = {
      addGold: jest.fn(),
      canTrade: jest.fn(() => true),
      displayName: jest.fn(() => "Destination"),
      id: jest.fn(() => 2),
      unitCount: jest.fn(() => 1),
      units: jest.fn(() => [dstPort]),
    } as any;

    pirate = {
      addGold: jest.fn(),
      canTrade: jest.fn(() => true),
      displayName: jest.fn(() => "Destination"),
      id: jest.fn(() => 3),
      unitCount: jest.fn(() => 1),
      units: jest.fn(() => [piratePort]),
    } as any;

    piratePort = {
      isActive: jest.fn(() => true),
      owner: jest.fn(() => pirate),
      tile: jest.fn(() => 40011),
    } as any;

    srcPort = {
      isActive: jest.fn(() => true),
      owner: jest.fn(() => origOwner),
      tile: jest.fn(() => 20011),
    } as any;

    dstPort = {
      isActive: jest.fn(() => true),
      owner: jest.fn(() => dstOwner),
      tile: jest.fn(() => 30015), // 15x15
    } as any;

    tradeShip = {
      delete: jest.fn(),
      isActive: jest.fn(() => true),
      move: jest.fn(),
      owner: jest.fn(() => origOwner),
      setSafeFromPirates: jest.fn(),
      setTargetUnit: jest.fn(),
      tile: jest.fn(() => 2001),
    } as any;

    tradeShipExecution = new TradeShipExecution(origOwner, srcPort, dstPort);
    tradeShipExecution.init(game, 0);
    tradeShipExecution["pathFinder"] = {
      nextTile: jest.fn(() => ({ node: 2001, type: 0 })),
    } as any;
    tradeShipExecution["tradeShip"] = tradeShip;
  });

  it("should initialize and tick without errors", () => {
    tradeShipExecution.tick(1);
    expect(tradeShipExecution.isActive()).toBe(true);
  });

  it("should deactivate if tradeShip is not active", () => {
    tradeShip.isActive = jest.fn(() => false);
    tradeShipExecution.tick(1);
    expect(tradeShipExecution.isActive()).toBe(false);
  });

  it("should delete ship if port owner changes to current owner", () => {
    dstPort.owner = jest.fn(() => origOwner);
    tradeShipExecution.tick(1);
    expect(tradeShip.delete).toHaveBeenCalledWith(false);
    expect(tradeShipExecution.isActive()).toBe(false);
  });

  it("should pick another port if ship is captured", () => {
    tradeShip.owner = jest.fn(() => pirate);
    tradeShipExecution.tick(1);
    expect(tradeShip.setTargetUnit).toHaveBeenCalledWith(piratePort);
  });

  it("should complete trade and award gold", () => {
    tradeShipExecution["pathFinder"] = {
      nextTile: jest.fn(() => ({ node: 2001, type: 2 })),
    } as any;
    tradeShipExecution.tick(1);
    expect(tradeShip.delete).toHaveBeenCalledWith(false);
    expect(tradeShipExecution.isActive()).toBe(false);
    expect(game.displayMessage).toHaveBeenCalled();
  });
});
