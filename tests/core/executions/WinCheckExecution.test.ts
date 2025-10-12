import { WinCheckExecution } from "../../../src/core/execution/WinCheckExecution";
import { GameMode } from "../../../src/core/game/Game";
import { setup } from "../../util/Setup";

describe("WinCheckExecution", () => {
  let mg: any;
  let winCheck: WinCheckExecution;

  beforeEach(async () => {
    mg = await setup("big_plains", {
      infiniteGold: true,
      gameMode: GameMode.FFA,
      maxTimerValue: 5,
      instantBuild: true,
    });
    mg.setWinner = jest.fn();
    winCheck = new WinCheckExecution();
    winCheck.init(mg, 0);
  });

  it("should call checkWinnerFFA in FFA mode", () => {
    const spy = jest.spyOn(winCheck as any, "checkWinnerFFA");
    winCheck.tick(10);
    expect(spy).toHaveBeenCalled();
  });

  it("should call checkWinnerTeam in non-FFA mode", () => {
    mg.config = jest.fn(() => ({
      gameConfig: jest.fn(() => ({
        maxTimerValue: 5,
        gameMode: GameMode.Team,
      })),
      percentageTilesOwnedToWin: jest.fn(() => 50),
    }));
    winCheck.init(mg, 0);
    const spy = jest.spyOn(winCheck as any, "checkWinnerTeam");
    winCheck.tick(10);
    expect(spy).toHaveBeenCalled();
  });

  it("should set winner in FFA if percentage is reached", () => {
    const player = {
      numTilesOwned: jest.fn(() => 81),
      name: jest.fn(() => "P1"),
    };
    mg.players = jest.fn(() => [player]);
    mg.numLandTiles = jest.fn(() => 100);
    mg.numTilesWithFallout = jest.fn(() => 0);
    winCheck.checkWinnerFFA();
    expect(mg.setWinner).toHaveBeenCalledWith(player, expect.anything());
  });

  it("should set winner in FFA if timer is 0", () => {
    const player = {
      numTilesOwned: jest.fn(() => 10),
      name: jest.fn(() => "P1"),
    };
    mg.players = jest.fn(() => [player]);
    mg.numLandTiles = jest.fn(() => 100);
    mg.numTilesWithFallout = jest.fn(() => 0);
    mg.stats = jest.fn(() => ({ stats: () => ({ mocked: true }) }));
    // Advance ticks until timeElapsed (in seconds) >= maxTimerValue * 60
    // timeElapsed = (ticks - numSpawnPhaseTurns) / 10  =>
    // ticks >= numSpawnPhaseTurns + maxTimerValue * 600
    const threshold =
      mg.config().numSpawnPhaseTurns() +
      (mg.config().gameConfig().maxTimerValue ?? 0) * 600;
    while (mg.ticks() < threshold) {
      mg.executeNextTick();
    }
    winCheck.checkWinnerFFA();
    expect(mg.setWinner).toHaveBeenCalledWith(player, expect.any(Object));
  });

  it("should not set winner if no players", () => {
    mg.players = jest.fn(() => []);
    winCheck.checkWinnerFFA();
    expect(mg.setWinner).not.toHaveBeenCalled();
  });

  it("should return false for activeDuringSpawnPhase", () => {
    expect(winCheck.activeDuringSpawnPhase()).toBe(false);
  });
});
