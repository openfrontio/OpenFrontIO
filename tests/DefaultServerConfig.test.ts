import { GameEnv } from "../src/core/configuration/Config";
import { DefaultServerConfig } from "../src/core/configuration/DefaultConfig";
import { GameMapType, GameMode } from "../src/core/game/Game";

/**
 * Mock out maxPlayersForMap, to avoid test-churn
 */
class MockedServerConfig extends DefaultServerConfig {
  constructor(private mockMaxPlayersForMap: number) {
    super();
  }

  public override maxPlayersForMap(map: GameMapType): number {
    expect(map).toBe("ignored");
    return this.mockMaxPlayersForMap;
  }
  jwtAudience(): string {
    throw new Error("Method not implemented.");
  }
  numWorkers(): number {
    throw new Error("Method not implemented.");
  }
  env(): GameEnv {
    throw new Error("Method not implemented.");
  }
}

describe("calcLobbyConfig", () => {
  beforeEach(() => {
    // The default config generates a random number of teams.
    // Just fix the random value for these tests
    jest.spyOn(Math, "random").mockReturnValue(0.5);
  });

  afterEach(() => {
    jest.spyOn(Math, "random").mockRestore();
  });

  it("Simple case for Team mode", () => {
    const config = new MockedServerConfig(50);
    const result = config.calcLobbyConfig(
      "ignored" as GameMapType,
      GameMode.Team,
    );

    expect(result).toEqual({
      maxPlayers: 72,
      numPlayerTeams: 4,
    });
  });

  it("Correctly rounds for team mode", () => {
    const config = new MockedServerConfig(25);
    const result = config.calcLobbyConfig(
      "ignored" as GameMapType,
      GameMode.Team,
    );

    expect(result).toEqual({
      // 25 * 1.5 = 37.5 -> 38
      maxPlayers: 36,
      numPlayerTeams: 4,
    });
  });

  it("should return correct values for FFA mode", () => {
    const config = new MockedServerConfig(80);
    const result = config.calcLobbyConfig(
      "ignored" as GameMapType,
      GameMode.FFA,
    );

    expect(result).toEqual({
      maxPlayers: 80,
      numPlayerTeams: undefined,
    });
  });
});
