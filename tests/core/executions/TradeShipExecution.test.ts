import { TradeShipExecution } from "../../../src/core/execution/TradeShipExecution";
import { Game, Player, Unit } from "../../../src/core/game/Game";
import { PathStatus } from "../../../src/core/pathfinding/types";
import { setup } from "../../util/Setup";

describe("TradeShipExecution", () => {
  let game: Game;
  let origOwner: Player;
  let dstOwner: Player;
  let pirate: Player;
  let halfPirate: Player;
  let srcPort: Unit;
  let piratePort: Unit;
  let piratePort2: Unit;
  let halfPiratePort: Unit;
  let tradeShip: Unit;
  let dstPort: Unit;
  let tradeShipExecution: TradeShipExecution;
  let currentTarget: Unit | null = null;

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
      displayName: vi.fn(() => "Destination 1"),
      units: vi.fn(() => [piratePort, piratePort2]),
      unitCount: vi.fn(() => 2),
      canTrade: vi.fn(() => true),
    } as any;

    halfPirate = {
      id: vi.fn(() => 4),
      addGold: vi.fn(),
      displayName: vi.fn(() => "Destination 2"),
      units: vi.fn(() => [halfPiratePort]),
      unitCount: vi.fn(() => 1),
      canTrade: vi.fn(() => true),
    } as any;

    piratePort = {
      id: vi.fn(() => 201),
      tile: vi.fn(() => 56),
      owner: vi.fn(() => pirate),
      isActive: vi.fn(() => true),
      isUnderConstruction: vi.fn(() => false),
      isMarkedForDeletion: vi.fn(() => false),
    } as any;

    piratePort2 = {
      id: vi.fn(() => 202),
      tile: vi.fn(() => 75),
      owner: vi.fn(() => pirate),
      isActive: vi.fn(() => true),
      isUnderConstruction: vi.fn(() => false),
      isMarkedForDeletion: vi.fn(() => false),
    } as any;

    halfPiratePort = {
      id: vi.fn(() => 301),
      tile: vi.fn(() => 11),
      owner: vi.fn(() => halfPirate),
      isActive: vi.fn(() => true),
      isUnderConstruction: vi.fn(() => false),
      isMarkedForDeletion: vi.fn(() => false),
    } as any;

    srcPort = {
      id: vi.fn(() => 101),
      tile: vi.fn(() => 10),
      owner: vi.fn(() => origOwner),
      isActive: vi.fn(() => true),
      isUnderConstruction: vi.fn(() => false),
      isMarkedForDeletion: vi.fn(() => false),
    } as any;

    dstPort = {
      id: vi.fn(() => 102),
      tile: vi.fn(() => 100),
      owner: vi.fn(() => dstOwner),
      isActive: vi.fn(() => true),
      isUnderConstruction: vi.fn(() => false),
      isMarkedForDeletion: vi.fn(() => false),
    } as any;

    tradeShip = {
      isActive: vi.fn(() => true),
      owner: vi.fn(() => origOwner),
      id: vi.fn(() => 123),
      move: vi.fn(),
      setTargetUnit: vi.fn((port: Unit) => {
        currentTarget = port;
      }),
      targetUnit: vi.fn(() => currentTarget),
      setSafeFromPirates: vi.fn(),
      touch: vi.fn(),
      delete: vi.fn(),
      tile: vi.fn(() => 32),
    } as any;

    tradeShipExecution = new TradeShipExecution(origOwner, srcPort, dstPort);
    tradeShipExecution.init(game, 0);
    tradeShipExecution["pathFinder"] = {
      next: vi.fn(() => ({ status: PathStatus.NEXT, node: 32 })),
      findPath: vi.fn((from: number) => [from]),
    } as any;
    tradeShipExecution["tradeShip"] = tradeShip;

    vi.spyOn(game, "players").mockReturnValue([
      origOwner,
      dstOwner,
      pirate,
      halfPirate,
    ]);
    vi.spyOn(game, "getWaterComponent").mockReturnValue(1);
    vi.spyOn(game, "hasWaterComponent").mockReturnValue(true);
    vi.spyOn(game, "manhattanDist").mockReturnValue(10);

    currentTarget = null;
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

  it("should pick another port if destination is embargoed and ship not captured", () => {
    dstOwner.canTrade = vi.fn(() => false);
    halfPirate.canTrade = vi.fn(() => true);
    pirate.canTrade = vi.fn(() => false);
    origOwner.canTrade = vi.fn((target: Player) => {
      if (target.id() === halfPirate.id()) return true;
      return false;
    });

    tradeShipExecution.tick(1);
    expect(tradeShip.delete).not.toHaveBeenCalled();
    expect(tradeShipExecution.isActive()).toBe(true);
    expect(tradeShip.targetUnit()).toBe(halfPiratePort);
    expect(tradeShip.touch).toHaveBeenCalled();
  });

  it("should complete trade and award gold", () => {
    tradeShipExecution["pathFinder"] = {
      next: vi.fn(() => ({ status: PathStatus.COMPLETE, node: 32 })),
      findPath: vi.fn((from: number) => [from]),
    } as any;
    tradeShipExecution.tick(1);
    expect(tradeShip.delete).toHaveBeenCalledWith(false);
    expect(tradeShipExecution.isActive()).toBe(false);
    expect(origOwner.addGold).toHaveBeenCalled();
    expect(dstOwner.addGold).toHaveBeenCalled();
  });
});
