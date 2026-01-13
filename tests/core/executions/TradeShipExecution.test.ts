import { TradeShipExecution } from "../../../src/core/execution/TradeShipExecution";
import { Game, Player, Unit } from "../../../src/core/game/Game";
import { PathStatus } from "../../../src/core/pathfinding/types";
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
    game.displayMessage = vi.fn();
    origOwner = {
      canBuild: vi.fn(() => true),
      buildUnit: vi.fn((type, spawn, opts) => tradeShip),
      displayName: vi.fn(() => "Origin"),
      addGold: vi.fn(),
      units: vi.fn(() => [dstPort]),
      unitCount: vi.fn(() => 1),
      id: vi.fn(() => 1),
      clientID: vi.fn(() => 1),
      canTrade: vi.fn(() => true),
    } as any;

    dstOwner = {
      id: vi.fn(() => 2),
      addGold: vi.fn(),
      displayName: vi.fn(() => "Destination"),
      units: vi.fn(() => [dstPort]),
      unitCount: vi.fn(() => 1),
      clientID: vi.fn(() => 2),
      canTrade: vi.fn(() => true),
    } as any;

    pirate = {
      id: vi.fn(() => 3),
      addGold: vi.fn(),
      displayName: vi.fn(() => "Destination"),
      units: vi.fn(() => [piratePort]),
      unitCount: vi.fn(() => 1),
      canTrade: vi.fn(() => true),
    } as any;

    piratePort = {
      tile: vi.fn(() => 40011),
      owner: vi.fn(() => pirate),
      isActive: vi.fn(() => true),
    } as any;

    srcPort = {
      tile: vi.fn(() => 20011),
      owner: vi.fn(() => origOwner),
      isActive: vi.fn(() => true),
    } as any;

    dstPort = {
      tile: vi.fn(() => 30015), // 15x15
      owner: vi.fn(() => dstOwner),
      isActive: vi.fn(() => true),
    } as any;

    tradeShip = {
      isActive: vi.fn(() => true),
      owner: vi.fn(() => origOwner),
      move: vi.fn(),
      setTargetUnit: vi.fn(),
      setSafeFromPirates: vi.fn(),
      delete: vi.fn(),
      tile: vi.fn(() => 2001),
    } as any;

    tradeShipExecution = new TradeShipExecution(origOwner, srcPort, dstPort);
    tradeShipExecution.init(game, 0);
    tradeShipExecution["pathFinder"] = {
      next: vi.fn(() => ({ status: PathStatus.NEXT, node: 2001 })),
    } as any;
    tradeShipExecution["tradeShip"] = tradeShip;
  });

  it("should initialize and tick without errors", () => {
    tradeShipExecution.tick(1);
    expect(tradeShipExecution.isActive()).toBe(true);
  });

  it("should deactivate if tradeShip is not active", () => {
    tradeShip.isActive = vi.fn(() => false);
    tradeShipExecution.tick(1);
    expect(tradeShipExecution.isActive()).toBe(false);
  });

  it("should delete ship if port owner changes to current owner", () => {
    dstPort.owner = vi.fn(() => origOwner);
    tradeShipExecution.tick(1);
    expect(tradeShip.delete).toHaveBeenCalledWith(false);
    expect(tradeShipExecution.isActive()).toBe(false);
  });

  it("should pick another port if ship is captured", () => {
    tradeShip.owner = vi.fn(() => pirate);
    tradeShipExecution.tick(1);
    expect(tradeShip.setTargetUnit).toHaveBeenCalledWith(piratePort);
  });

  it("should complete trade and award gold", () => {
    tradeShipExecution["pathFinder"] = {
      next: vi.fn(() => ({ status: PathStatus.COMPLETE, node: 2001 })),
    } as any;
    tradeShipExecution.tick(1);
    expect(tradeShip.delete).toHaveBeenCalledWith(false);
    expect(tradeShipExecution.isActive()).toBe(false);
    expect(game.displayMessage).toHaveBeenCalled();
  });
});
