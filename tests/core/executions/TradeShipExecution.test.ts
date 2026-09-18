import { TradeShipExecution } from "../../../src/core/execution/TradeShipExecution";
import {
  Game,
  MessageType,
  Player,
  PlayerInfo,
  PlayerType,
  Unit,
  UnitType,
} from "../../../src/core/game/Game";
import { PathStatus } from "../../../src/core/pathfinding/types";
import {
  BOAT_INDEX_CAPTURE,
  GOLD_INDEX_STEAL,
} from "../../../src/core/StatsSchemas";
import { setup } from "../../util/Setup";
import { executeTicks } from "../../util/utils";

describe("TradeShipExecution", () => {
  let game: Game;
  let origOwner: Player;
  let dstOwner: Player;
  let pirate: Player;
  let srcPort: Unit;
  let piratePort: Unit;
  let piratePort2: Unit;
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
      addTradeGold: vi.fn(),
      addPiracyGold: vi.fn(),
      units: vi.fn(() => [dstPort]),
      unitCount: vi.fn(() => 1),
      id: vi.fn(() => 1),
      clientID: vi.fn(() => 1),
      canTrade: vi.fn(() => true),
    } as any;

    dstOwner = {
      id: vi.fn(() => 2),
      addGold: vi.fn(),
      addTradeGold: vi.fn(),
      addPiracyGold: vi.fn(),
      displayName: vi.fn(() => "Destination"),
      units: vi.fn(() => [dstPort]),
      unitCount: vi.fn(() => 1),
      clientID: vi.fn(() => 2),
      canTrade: vi.fn(() => true),
    } as any;

    pirate = {
      id: vi.fn(() => 3),
      clientID: vi.fn(() => 3),
      addGold: vi.fn(),
      addTradeGold: vi.fn(),
      addPiracyGold: vi.fn(),
      displayName: vi.fn(() => "Destination"),
      units: vi.fn(() => [piratePort, piratePort2]),
      unitCount: vi.fn(() => 2),
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
      setTargetUnit: vi.fn(),
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
      pathForTraversal: vi.fn(() => [32]),
    } as any;
    tradeShipExecution["tradeShip"] = tradeShip;
  });

  it("should initialize and tick without errors", () => {
    const pathFinder = tradeShipExecution["pathFinder"];
    tradeShipExecution.tick(1);
    expect(tradeShipExecution.isActive()).toBe(true);
    expect(pathFinder.pathForTraversal).toHaveBeenCalledOnce();
    expect(pathFinder.findPath).not.toHaveBeenCalled();
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

  it("should notify the original owner when the ship is captured", () => {
    tradeShip.owner = vi.fn(() => pirate);
    tradeShipExecution.tick(1);
    expect(game.displayMessage).toHaveBeenCalledWith(
      "events_display.trade_ship_captured",
      MessageType.UNIT_DESTROYED,
      origOwner.id(),
      undefined,
      { name: pirate.displayName() },
      tradeShip.id(),
      pirate.id(),
    );
  });

  it("should only notify the original owner once across ticks", () => {
    tradeShip.owner = vi.fn(() => pirate);
    tradeShipExecution.tick(1);
    tradeShipExecution.tick(2);
    expect(game.displayMessage).toHaveBeenCalledTimes(1);
  });

  it("should complete trade and award gold", () => {
    tradeShipExecution["pathFinder"] = {
      next: vi.fn(() => ({ status: PathStatus.COMPLETE, node: 32 })),
      findPath: vi.fn((from: number) => [from]),
      pathForTraversal: vi.fn(() => [32]),
    } as any;
    tradeShipExecution.tick(1);
    expect(tradeShip.delete).toHaveBeenCalledWith(false);
    expect(tradeShipExecution.isActive()).toBe(false);
    expect(origOwner.addGold).toHaveBeenCalled();
    expect(dstOwner.addGold).toHaveBeenCalled();
    // Both port owners earn ship-trade revenue (live gold-rate columns).
    expect(origOwner.addTradeGold).toHaveBeenCalled();
    expect(dstOwner.addTradeGold).toHaveBeenCalled();
    // A normal arrival is trade, not piracy.
    expect(origOwner.addPiracyGold).not.toHaveBeenCalled();
    expect(dstOwner.addPiracyGold).not.toHaveBeenCalled();
  });

  it("should count captured-ship payout as piracy revenue only", () => {
    // Captured ships pay steal gold to the captor — GOLD_INDEX_STEAL
    // semantics: piracy revenue, distinct from trade revenue.
    tradeShip.owner = vi.fn(() => pirate);
    tradeShipExecution["pathFinder"] = {
      next: vi.fn(() => ({ status: PathStatus.COMPLETE, node: 32 })),
      findPath: vi.fn((from: number) => [from]),
      pathForTraversal: vi.fn(() => [32]),
    } as any;
    tradeShipExecution.tick(1);
    expect(pirate.addGold).toHaveBeenCalled();
    expect(pirate.addPiracyGold).toHaveBeenCalled();
    expect(pirate.addTradeGold).not.toHaveBeenCalled();
  });
});

describe("TradeShipExecution recapture", () => {
  test("retaking your own trade ship credits no capture", async () => {
    const game = await setup("half_land_half_ocean", {}, [
      new PlayerInfo("origin", PlayerType.Human, null, "origin"),
      new PlayerInfo("partner", PlayerType.Human, null, "partner"),
      new PlayerInfo("pirate", PlayerType.Human, null, "pirate"),
    ]);
    const origin = game.player("origin");
    const partner = game.player("partner");
    const pirate = game.player("pirate");
    executeTicks(game, 50);

    const port = (owner: Player, y: number) => {
      owner.conquer(game.ref(7, y));
      return owner.buildUnit(UnitType.Port, game.ref(7, y), {});
    };
    const srcPort = port(origin, 1);
    const homePort = port(origin, 14);
    const dstPort = port(partner, 8);
    port(pirate, 4);

    const execution = new TradeShipExecution(origin, srcPort, dstPort);
    game.addExecution(execution);
    executeTicks(game, 2);
    const [tradeShip] = origin.units(UnitType.TradeShip);
    const displayMessage = vi.spyOn(game, "displayMessage");

    pirate.captureUnit(tradeShip);
    game.executeNextTick();
    // Losing the source port keeps the retaken ship sailing home instead of
    // being scrapped as a same-owner trade.
    partner.captureUnit(srcPort);
    origin.captureUnit(tradeShip);

    const goldBefore = origin.gold();
    for (let i = 0; i < 100 && execution.isActive(); i++) {
      game.executeNextTick();
    }

    expect(execution.isActive()).toBe(false);
    expect(tradeShip.targetUnit()).toBe(homePort);
    expect(origin.gold()).toBeGreaterThan(goldBefore);
    expect(origin.piracyGold()).toBe(0n);
    expect(displayMessage.mock.calls.map(([message]) => message)).not.toContain(
      "events_display.received_gold_from_captured_ship",
    );
    for (const player of [origin, partner, pirate]) {
      const stats = game.stats().getPlayerStats(player);
      expect(stats?.boats?.trade?.[BOAT_INDEX_CAPTURE] ?? 0n).toBe(0n);
      expect(stats?.gold?.[GOLD_INDEX_STEAL] ?? 0n).toBe(0n);
    }
  });
});
