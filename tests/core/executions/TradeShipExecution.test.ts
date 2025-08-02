import { jest } from "@jest/globals";

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
      canBuild: jest.fn(() => true),
      buildUnit: jest.fn((type, spawn, opts) => tradeShip),
      displayName: jest.fn(() => "Origin"),
      addGold: jest.fn(),
      units: jest.fn(() => [dstPort]),
      unitCount: jest.fn(() => 1),
      id: jest.fn(() => 1),
      canTrade: jest.fn(() => true),
    } as any;

    dstOwner = {
      id: jest.fn(() => 2),
      addGold: jest.fn(),
      displayName: jest.fn(() => "Destination"),
      units: jest.fn(() => [dstPort]),
      unitCount: jest.fn(() => 1),
      canTrade: jest.fn(() => true),
    } as any;

    pirate = {
      id: jest.fn(() => 3),
      addGold: jest.fn(),
      displayName: jest.fn(() => "Destination"),
      units: jest.fn(() => [piratePort]),
      unitCount: jest.fn(() => 1),
      canTrade: jest.fn(() => true),
    } as any;

    piratePort = {
      tile: jest.fn(() => 40011),
      owner: jest.fn(() => pirate),
      isActive: jest.fn(() => true),
    } as any;

    srcPort = {
      tile: jest.fn(() => 20011),
      owner: jest.fn(() => origOwner),
      isActive: jest.fn(() => true),
    } as any;

    dstPort = {
      tile: jest.fn(() => 30015), // 15x15
      owner: jest.fn(() => dstOwner),
      isActive: jest.fn(() => true),
    } as any;

    tradeShip = {
      isActive: jest.fn(() => true),
      owner: jest.fn(() => origOwner),
      move: jest.fn(),
      setTargetUnit: jest.fn(),
      setSafeFromPirates: jest.fn(),
      delete: jest.fn(),
      tile: jest.fn(() => 2001),
    } as any;

    tradeShipExecution = new TradeShipExecution(origOwner, srcPort, dstPort);
    tradeShipExecution.init(game, 0);
    tradeShipExecution["pathFinder"] = {
      nextTile: jest.fn(() => ({ type: 0, node: 2001 })),
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
      nextTile: jest.fn(() => ({ type: 2, node: 2001 })),
    } as any;
    tradeShipExecution.tick(1);
    expect(tradeShip.delete).toHaveBeenCalledWith(false);
    expect(tradeShipExecution.isActive()).toBe(false);
    expect(game.displayMessage).toHaveBeenCalled();
  });
});
