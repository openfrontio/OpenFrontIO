import { StopAllTradesExecution } from "../../../src/core/execution/StopAllTradesExecution";
import { Game, Player } from "../../../src/core/game/Game";

describe("StopAllTradesExecution", () => {
  let mockGame: Game;
  let mockPlayer: Player;
  let mockTradingPartner1: Player;
  let mockTradingPartner2: Player;
  let mockAlliedPlayer: Player;

  beforeEach(() => {
    mockTradingPartner1 = {
      id: jest.fn(() => "partner1"),
      team: jest.fn(() => "team1"),
    } as unknown as Player;

    mockTradingPartner2 = {
      id: jest.fn(() => "partner2"),
      team: jest.fn(() => "team2"),
    } as unknown as Player;

    mockAlliedPlayer = {
      id: jest.fn(() => "ally1"),
      team: jest.fn(() => "team3"),
    } as unknown as Player;

    mockPlayer = {
      tradingPartners: jest.fn(() => [
        mockTradingPartner1,
        mockTradingPartner2,
        mockAlliedPlayer,
      ]),
      isAlliedWith: jest.fn((player: Player) => player === mockAlliedPlayer),
      addEmbargo: jest.fn(),
      team: jest.fn(() => "myTeam"),
    } as unknown as Player;

    mockGame = {} as unknown as Game;
  });

  it("should be active initially", () => {
    const execution = new StopAllTradesExecution(mockPlayer);
    expect(execution.isActive()).toBe(true);
  });

  it("should not be active during spawn phase", () => {
    const execution = new StopAllTradesExecution(mockPlayer);
    expect(execution.activeDuringSpawnPhase()).toBe(false);
  });

  it("should stop trades with all non-allied players when no team specified", () => {
    const execution = new StopAllTradesExecution(mockPlayer);
    execution.init(mockGame, 0);
    execution.tick(0);

    expect(mockPlayer.addEmbargo).toHaveBeenCalledWith("partner1", false);
    expect(mockPlayer.addEmbargo).toHaveBeenCalledWith("partner2", false);
    expect(mockPlayer.addEmbargo).not.toHaveBeenCalledWith("ally1", false);
    expect(execution.isActive()).toBe(false);
  });

  it("should stop trades with specific team when team ID specified", () => {
    const execution = new StopAllTradesExecution(mockPlayer, "team1");
    execution.init(mockGame, 0);
    execution.tick(0);

    expect(mockPlayer.addEmbargo).toHaveBeenCalledWith("partner1", false);
    expect(mockPlayer.addEmbargo).not.toHaveBeenCalledWith("partner2", false);
    expect(mockPlayer.addEmbargo).not.toHaveBeenCalledWith("ally1", false);
    expect(execution.isActive()).toBe(false);
  });

  it("should stop trades with specific team including allies when team ID specified", () => {
    const execution = new StopAllTradesExecution(mockPlayer, "team3");
    execution.init(mockGame, 0);
    execution.tick(0);

    expect(mockPlayer.addEmbargo).toHaveBeenCalledWith("ally1", false);
    expect(mockPlayer.addEmbargo).not.toHaveBeenCalledWith("partner1", false);
    expect(mockPlayer.addEmbargo).not.toHaveBeenCalledWith("partner2", false);
    expect(execution.isActive()).toBe(false);
  });

  it("should not stop any trades when team ID specified but no players from that team", () => {
    const execution = new StopAllTradesExecution(mockPlayer, "teamNotExist");
    execution.init(mockGame, 0);
    execution.tick(0);

    expect(mockPlayer.addEmbargo).not.toHaveBeenCalled();
    expect(execution.isActive()).toBe(false);
  });

  it("should handle undefined team ID correctly", () => {
    const execution = new StopAllTradesExecution(mockPlayer);
    execution.init(mockGame, 0);
    execution.tick(0);

    expect(mockPlayer.addEmbargo).toHaveBeenCalledWith("partner1", false);
    expect(mockPlayer.addEmbargo).toHaveBeenCalledWith("partner2", false);
    expect(mockPlayer.addEmbargo).not.toHaveBeenCalledWith("ally1", false);
    expect(execution.isActive()).toBe(false);
  });

  it("should handle errors gracefully and deactivate", () => {
    const errorMockPlayer = {
      tradingPartners: jest.fn(() => {
        throw new Error("Test error");
      }),
    } as unknown as Player;

    const consoleSpy = jest.spyOn(console, "error").mockImplementation();
    const execution = new StopAllTradesExecution(errorMockPlayer);

    execution.init(mockGame, 0);
    execution.tick(0);

    expect(consoleSpy).toHaveBeenCalledWith(
      "Error in StopAllTradesExecution:",
      expect.any(Error),
    );
    expect(execution.isActive()).toBe(false);

    consoleSpy.mockRestore();
  });
});
