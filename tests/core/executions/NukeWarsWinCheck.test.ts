import { WinCheckExecution } from "../../../src/core/execution/WinCheckExecution";
import {
  ColoredTeams,
  Game,
  GameMode,
  Player,
  Team,
} from "../../../src/core/game/Game";

describe("NukeWars Win Check", () => {
  let winCheck: WinCheckExecution;
  let mg: jest.Mocked<Game>;

  beforeEach(() => {
    winCheck = new WinCheckExecution();
    mg = {
      config: jest.fn().mockReturnValue({
        gameConfig: jest.fn().mockReturnValue({
          gameMode: GameMode.NukeWars,
          maxTimerValue: 5,
        }),
        numSpawnPhaseTurns: jest.fn().mockReturnValue(0),
      }),
      players: jest.fn(),
      numLandTiles: jest.fn(),
      numTilesWithFallout: jest.fn(),
      setWinner: jest.fn(),
      ticks: jest.fn().mockReturnValue(0),
      stats: jest.fn().mockReturnValue({
        stats: jest.fn(),
      }),
    } as unknown as jest.Mocked<Game>;
  });

  it("should declare winner when a team drops below 5% territory", () => {
    const team1Players = [
      {
        numTilesOwned: jest.fn().mockReturnValue(40),
        team: jest.fn().mockReturnValue("Team1" as Team),
      },
    ] as unknown as Player[];

    const team2Players = [
      {
        numTilesOwned: jest.fn().mockReturnValue(4), // < 5% territory
        team: jest.fn().mockReturnValue("Team2" as Team),
      },
    ] as unknown as Player[];

    mg.players.mockReturnValue([...team1Players, ...team2Players]);
    mg.numLandTiles.mockReturnValue(100);
    mg.numTilesWithFallout.mockReturnValue(0);

    winCheck.init(mg, 0);
    winCheck.checkWinnerNukeWars();

    // Team1 should win since Team2 is below 5%
    expect(mg.setWinner).toHaveBeenCalledWith("Team1", expect.anything());
  });

  it("should not declare bot team as winner", () => {
    const botTeamPlayers = [
      {
        numTilesOwned: jest.fn().mockReturnValue(90),
        team: jest.fn().mockReturnValue(ColoredTeams.Bot as Team),
      },
    ] as unknown as Player[];

    const playerTeamPlayers = [
      {
        numTilesOwned: jest.fn().mockReturnValue(4),
        team: jest.fn().mockReturnValue("Team1" as Team),
      },
    ] as unknown as Player[];

    mg.players.mockReturnValue([...botTeamPlayers, ...playerTeamPlayers]);
    mg.numLandTiles.mockReturnValue(100);
    mg.numTilesWithFallout.mockReturnValue(0);

    winCheck.init(mg, 0);
    winCheck.checkWinnerNukeWars();

    // Should not declare bot team as winner even if other team is < 5%
    expect(mg.setWinner).not.toHaveBeenCalledWith(
      ColoredTeams.Bot,
      expect.anything(),
    );
  });

  it("should declare winner with most territory when time runs out", () => {
    const team1Players = [
      {
        numTilesOwned: jest.fn().mockReturnValue(60),
        team: jest.fn().mockReturnValue("Team1" as Team),
      },
    ] as unknown as Player[];

    const team2Players = [
      {
        numTilesOwned: jest.fn().mockReturnValue(40),
        team: jest.fn().mockReturnValue("Team2" as Team),
      },
    ] as unknown as Player[];

    mg.players.mockReturnValue([...team1Players, ...team2Players]);
    mg.numLandTiles.mockReturnValue(100);
    mg.numTilesWithFallout.mockReturnValue(0);
    mg.ticks.mockReturnValue(5 * 60 * 10 + 1); // Just past time limit

    winCheck.init(mg, 0);
    winCheck.checkWinnerNukeWars();

    // Team1 should win since they have more territory when time expires
    expect(mg.setWinner).toHaveBeenCalledWith("Team1", expect.anything());
  });
});
