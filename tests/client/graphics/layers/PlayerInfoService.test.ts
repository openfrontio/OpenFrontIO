/**
 * @jest-environment jsdom
 */
import { TransformHandler } from "../../../../src/client/graphics/TransformHandler";
import { PlayerInfoService } from "../../../../src/client/graphics/layers/PlayerInfoService";
import {
  PlayerProfile,
  Relation,
  UnitType,
} from "../../../../src/core/game/Game";
import {
  GameView,
  PlayerView,
  UnitView,
} from "../../../../src/core/game/GameView";

describe("PlayerInfoService", () => {
  let game: GameView;
  let transform: TransformHandler;
  let playerInfoService: PlayerInfoService;
  let mockPlayer: PlayerView;
  let mockUnit: UnitView;

  beforeEach(() => {
    game = {
      isValidCoord: jest.fn().mockReturnValue(true),
      ref: jest.fn().mockReturnValue({ x: 10, y: 10 }),
      owner: jest.fn(),
      isLand: jest.fn().mockReturnValue(false),
      units: jest.fn().mockReturnValue([]),
      x: jest.fn().mockReturnValue(100),
      y: jest.fn().mockReturnValue(100),
      myPlayer: jest.fn().mockReturnValue(null),
    } as any;

    transform = {
      screenToWorldCoordinates: jest.fn().mockReturnValue({ x: 10, y: 10 }),
    } as any;

    mockPlayer = {
      name: jest.fn().mockReturnValue("TestPlayer"),
      isPlayer: jest.fn().mockReturnValue(true),
      troops: jest.fn().mockReturnValue(10),
      gold: jest.fn().mockReturnValue(5000),
      outgoingAttacks: jest.fn().mockReturnValue([{ troops: 5 }]),
      totalUnitLevels: jest.fn().mockReturnValue(5),
      units: jest.fn().mockReturnValue([]),
      profile: jest.fn().mockResolvedValue({} as PlayerProfile),
    } as any;

    mockUnit = {
      type: jest.fn().mockReturnValue("Warship"),
      tile: jest.fn().mockReturnValue({ x: 10, y: 10 }),
      owner: jest.fn().mockReturnValue(mockPlayer),
      hasHealth: jest.fn().mockReturnValue(true),
      health: jest.fn().mockReturnValue(80),
    } as any;

    playerInfoService = new PlayerInfoService(game, transform);
  });

  it("should initialize correctly", () => {
    expect(playerInfoService).toBeDefined();
  });

  it("should find nearest unit within detection radius", () => {
    const mockUnits = [mockUnit];
    game.units = jest.fn().mockReturnValue(mockUnits);

    const result = playerInfoService.findNearestUnit({ x: 100, y: 100 });

    expect(result).toBe(mockUnit);
    expect(game.units).toHaveBeenCalledWith(
      UnitType.Warship,
      UnitType.TradeShip,
      UnitType.TransportShip,
    );
  });

  it("should return null if no unit within detection radius", () => {
    game.units = jest.fn().mockReturnValue([]);

    const result = playerInfoService.findNearestUnit({ x: 100, y: 100 });

    expect(result).toBeNull();
  });

  it("should get hover info for player territory", async () => {
    game.owner = jest.fn().mockReturnValue(mockPlayer);

    const result = await playerInfoService.getHoverInfo(50, 50);

    expect(result.player).toBe(mockPlayer);
    expect(result.unit).toBeNull();
    expect(result.mouseX).toBe(50);
    expect(result.mouseY).toBe(50);
  });

  it("should get hover info for unit in water", async () => {
    game.owner = jest.fn().mockReturnValue(null);
    game.units = jest.fn().mockReturnValue([mockUnit]);

    const mockFindNearestUnit = jest
      .spyOn(playerInfoService, "findNearestUnit")
      .mockReturnValue(mockUnit);

    const result = await playerInfoService.getHoverInfo(50, 50);

    expect(result.player).toBeNull();
    expect(result.unit).toBe(mockUnit);
    expect(mockFindNearestUnit).toHaveBeenCalled();
  });

  it("should return empty hover info for invalid coordinates", async () => {
    game.isValidCoord = jest.fn().mockReturnValue(false);

    const result = await playerInfoService.getHoverInfo(50, 50);

    expect(result.player).toBeNull();
    expect(result.unit).toBeNull();
  });

  it("should get correct relation class", () => {
    expect(playerInfoService.getRelationClass(Relation.Hostile)).toBe(
      "text-red-500",
    );
    expect(playerInfoService.getRelationClass(Relation.Distrustful)).toBe(
      "text-red-300",
    );
    expect(playerInfoService.getRelationClass(Relation.Neutral)).toBe(
      "text-white",
    );
    expect(playerInfoService.getRelationClass(Relation.Friendly)).toBe(
      "text-green-500",
    );
  });

  it("should get correct relation for players", () => {
    const myPlayer = { isFriendly: jest.fn().mockReturnValue(false) } as any;
    game.myPlayer = jest.fn().mockReturnValue(myPlayer);

    expect(playerInfoService.getRelation(myPlayer)).toBe(Relation.Friendly);

    myPlayer.isFriendly.mockReturnValue(true);
    expect(playerInfoService.getRelation(mockPlayer)).toBe(Relation.Friendly);

    myPlayer.isFriendly.mockReturnValue(false);
    expect(playerInfoService.getRelation(mockPlayer)).toBe(Relation.Neutral);
  });

  it("should shorten display name when too long", () => {
    mockPlayer.name = jest
      .fn()
      .mockReturnValue("VeryLongPlayerNameThatShouldBeShortened");

    const result = playerInfoService.getShortDisplayName(mockPlayer);

    expect(result).toBe("VeryLongPlayerName…");
    expect(result.length).toBeLessThanOrEqual(20);
  });

  it("should calculate player stats correctly", () => {
    const stats = playerInfoService.calculatePlayerStats(mockPlayer);

    expect(stats).toContainEqual(["defending_troops", "1"]);
    expect(stats).toContainEqual(["attacking_troops", "0"]);
    expect(stats).toContainEqual(["gold", "5.00K"]);
  });

  it("should format stats into rows correctly", () => {
    const { row1, row2 } = playerInfoService.formatStats(mockPlayer);

    expect(row1.length).toBeGreaterThan(0);
    expect(row2.length).toBeGreaterThan(0);
    expect(row1.some((stat) => stat.includes("🛡️"))).toBe(true);
    expect(row2.some((stat) => stat.includes("⚓"))).toBe(true);
  });

  it("should filter out empty stat values", () => {
    mockPlayer.troops = jest.fn().mockReturnValue(0);
    mockPlayer.gold = jest.fn().mockReturnValue(0);
    mockPlayer.outgoingAttacks = jest.fn().mockReturnValue([]);
    mockPlayer.totalUnitLevels = jest.fn().mockReturnValue(0);
    mockPlayer.units = jest.fn().mockReturnValue([]);

    const { row1, row2 } = playerInfoService.formatStats(mockPlayer);

    expect(row1.length).toBe(0);
    expect(row2.length).toBe(0);
  });
});
