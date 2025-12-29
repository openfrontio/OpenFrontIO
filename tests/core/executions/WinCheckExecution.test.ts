import { WinCheckExecution } from "../../../src/core/execution/WinCheckExecution";
import { GameMode } from "../../../src/core/game/Game";
import { playerInfo, setup } from "../../util/Setup";
import { PlayerType } from "../../../src/core/game/Game";

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

  describe("vassal territory counting", () => {
    it("ignores vassal tiles when vassals are disabled", async () => {
      const game = await setup(
        "plains",
        { enableVassals: false, infiniteTroops: true },
        [playerInfo("overlord", PlayerType.Human), playerInfo("vassal", PlayerType.Human)],
      );
      const overlord = game.player("overlord");
      const vassal = game.player("vassal");
      overlord.conquer(game.ref(0, 0));
      vassal.conquer(game.ref(0, 1));
      while (game.inSpawnPhase()) {
        game.executeNextTick();
      }
      game.setWinner = jest.fn();
      game.numLandTiles = jest.fn(() => 2);
      game.numTilesWithFallout = jest.fn(() => 0);
      game.config().percentageTilesOwnedToWin = () => 50;

      game.vassalize(vassal, overlord); // should be ignored
      const localWinCheck = new WinCheckExecution();
      localWinCheck.init(game as any, game.ticks());
      localWinCheck.checkWinnerFFA();

      expect(game.setWinner).not.toHaveBeenCalled();
    });

    it("counts vassal tiles toward overlord when enabled", async () => {
      const game = await setup(
        "plains",
        { enableVassals: true, infiniteTroops: true },
        [playerInfo("overlord", PlayerType.Human), playerInfo("vassal", PlayerType.Human)],
      );
      const overlord = game.player("overlord");
      const vassal = game.player("vassal");
      overlord.conquer(game.ref(0, 0));
      vassal.conquer(game.ref(0, 1));
      while (game.inSpawnPhase()) {
        game.executeNextTick();
      }
      game.vassalize(vassal, overlord);
      game.setWinner = jest.fn();
      game.numLandTiles = jest.fn(() => 2);
      game.numTilesWithFallout = jest.fn(() => 0);
      const cfg = game.config();
      jest.spyOn(cfg, "percentageTilesOwnedToWin").mockReturnValue(50);
      jest.spyOn(cfg, "gameConfig").mockReturnValue({
        ...cfg.gameConfig(),
        maxTimerValue: undefined,
      });

      const localWinCheck = new WinCheckExecution();
      localWinCheck.init(game as any, game.ticks());
      localWinCheck.checkWinnerFFA();

      expect(game.setWinner).toHaveBeenCalled();
    });

    it("does not attribute cross-team vassal tiles when vassals are disabled (Team mode)", () => {
      const cfg = {
        gameConfig: () => ({ gameMode: GameMode.Team, maxTimerValue: undefined }),
        percentageTilesOwnedToWin: () => 50,
        numSpawnPhaseTurns: () => 0,
      };
      const stats = { stats: () => ({}) };
      const mg: any = {
        config: () => cfg,
        numLandTiles: () => 2,
        numTilesWithFallout: () => 0,
        setWinner: jest.fn(),
        stats: () => stats,
        ticks: () => 0,
      };
      const overlord = {
        numTilesOwned: () => 1,
        team: () => 1,
        overlord: () => null,
        vassals: () => [],
        name: () => "Overlord",
      };
      const vassal = {
        numTilesOwned: () => 1,
        team: () => 2,
        overlord: () => null,
        vassals: () => [],
        name: () => "Vassal",
      };
      mg.players = () => [overlord, vassal];

      const localWinCheck = new WinCheckExecution();
      localWinCheck.init(mg, 0);
      localWinCheck.checkWinnerTeam();

      expect(mg.setWinner).not.toHaveBeenCalled();
    });

    it("attributes cross-team vassal tiles to overlord team when enabled (Team mode)", () => {
      const cfg = {
        gameConfig: () => ({ gameMode: GameMode.Team, maxTimerValue: undefined }),
        percentageTilesOwnedToWin: () => 50,
        numSpawnPhaseTurns: () => 0,
      };
      const stats = { stats: () => ({}) };
      const mg: any = {
        config: () => cfg,
        numLandTiles: () => 2,
        numTilesWithFallout: () => 0,
        setWinner: jest.fn(),
        stats: () => stats,
        ticks: () => 0,
      };
      const overlord: any = {
        numTilesOwned: () => 1,
        team: () => 1,
        overlord: () => null,
        vassals: () => [],
        name: () => "Overlord",
      };
      const vassal: any = {
        numTilesOwned: () => 1,
        team: () => 2,
        overlord: () => overlord,
        vassals: () => [],
        name: () => "Vassal",
      };
      overlord.vassals = () => [vassal];
      mg.players = () => [overlord, vassal];

      const localWinCheck = new WinCheckExecution();
      localWinCheck.init(mg, 0);
      localWinCheck.checkWinnerTeam();

      expect(mg.setWinner).toHaveBeenCalled();
    });

    it("does not set winner when threshold not met even with vassals (FFA)", async () => {
      const game = await setup(
        "plains",
        { enableVassals: true, infiniteTroops: true },
        [playerInfo("overlord", PlayerType.Human), playerInfo("vassal", PlayerType.Human)],
      );
      const overlord = game.player("overlord");
      const vassal = game.player("vassal");
      overlord.conquer(game.ref(0, 0));
      vassal.conquer(game.ref(0, 1));
      while (game.inSpawnPhase()) game.executeNextTick();
      game.vassalize(vassal, overlord);
      game.setWinner = jest.fn();
      game.numLandTiles = jest.fn(() => 10);
      game.numTilesWithFallout = jest.fn(() => 0);
      const cfg = game.config();
      jest.spyOn(cfg, "percentageTilesOwnedToWin").mockReturnValue(80);
      jest.spyOn(cfg, "gameConfig").mockReturnValue({
        ...cfg.gameConfig(),
        maxTimerValue: undefined,
      });

      const localWinCheck = new WinCheckExecution();
      localWinCheck.init(game as any, game.ticks());
      localWinCheck.checkWinnerFFA();

      expect(game.setWinner).not.toHaveBeenCalled();
    });
  });
});
