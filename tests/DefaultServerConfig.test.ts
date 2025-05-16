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

describe("calcPlayerConfig", () => {
  beforeEach(() => {
    // The default config generates a random number of teams.
    // Just fix the random value for these tests
    jest.spyOn(Math, "random").mockReturnValue(0.5);
  });

  afterEach(() => {
    jest.spyOn(Math, "random").mockRestore();
  });

  it("returns deterministic result for Team mode", () => {
    const config = new MockedServerConfig(50);
    const result = config.calcPlayerConfig(
      "ignored" as GameMapType,
      GameMode.Team,
    );

    expect(result).toEqual({
      maxPlayers: 100,
      numPlayerTeams: 4,
    });
  });

  it("Correctly rounds for team mode", () => {
    const config = new MockedServerConfig(25);
    const result = config.calcPlayerConfig(
      "ignored" as GameMapType,
      GameMode.Team,
    );

    expect(result).toEqual({
      maxPlayers: 48,
      numPlayerTeams: 4,
    });
  });

  it("Team game still has cap of 150", () => {
    jest.spyOn(Math, "random").mockReturnValue(0.9999999999999999);
    const config = new MockedServerConfig(200);
    const result = config.calcPlayerConfig(
      "ignored" as GameMapType,
      GameMode.Team,
    );

    expect(result).toEqual({
      maxPlayers: 150,
      numPlayerTeams: 6,
    });
  });

  it("should return correct values for FFA mode", () => {
    const config = new MockedServerConfig(80);
    const result = config.calcPlayerConfig(
      "ignored" as GameMapType,
      GameMode.FFA,
    );

    expect(result).toEqual({
      maxPlayers: 80,
      numPlayerTeams: undefined,
    });
  });

  it("should cap FFA mode at 150", () => {
    const config = new MockedServerConfig(300);
    const result = config.calcPlayerConfig(
      "ignored" as GameMapType,
      GameMode.FFA,
    );

    expect(result).toEqual({
      maxPlayers: 150,
      numPlayerTeams: undefined,
    });
  });
});
