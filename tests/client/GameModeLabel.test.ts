import { afterEach, beforeEach, describe, expect, it } from "vitest";
import en from "../../resources/lang/en.json";
import { getGameModeLabel } from "../../src/client/Utils";
import {
  Duos,
  GameMode,
  GameType,
  HumansVsNations,
  Quads,
  Trios,
} from "../../src/core/game/Game";
import { GameConfig } from "../../src/core/Schemas";

function flatten(
  value: Record<string, unknown>,
  prefix = "",
  out: Record<string, string> = {},
): Record<string, string> {
  for (const [key, child] of Object.entries(value)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof child === "string") out[fullKey] = child;
    else flatten(child as Record<string, unknown>, fullKey, out);
  }
  return out;
}

function label(config: Partial<GameConfig>): string {
  return getGameModeLabel(config as GameConfig);
}

describe("getGameModeLabel", () => {
  let languageFixture: HTMLElement | undefined;

  beforeEach(() => {
    const translations = flatten(en);
    languageFixture = document.createElement("lang-selector");
    Object.assign(languageFixture, {
      translations,
      defaultTranslations: translations,
      currentLang: "en",
    });
    document.body.appendChild(languageFixture);
  });

  afterEach(() => {
    languageFixture?.remove();
    languageFixture = undefined;
  });

  it("names FFA", () => {
    expect(label({ gameMode: GameMode.FFA, maxPlayers: 50 })).toBe(
      "Free for All",
    );
  });

  it.each([
    [Duos, 20, "Duos (10 teams of 2)"],
    [Trios, 30, "Trios (10 teams of 3)"],
    [Quads, 50, "Quads (12 teams of 4)"],
  ])("leads with the preset name for %s", (playerTeams, maxPlayers, want) => {
    expect(label({ gameMode: GameMode.Team, playerTeams, maxPlayers })).toBe(
      want,
    );
  });

  it("drops the team count when the lobby has no usable cap", () => {
    expect(label({ gameMode: GameMode.Team, playerTeams: Duos })).toBe(
      "Duos (teams of 2)",
    );
    expect(
      label({ gameMode: GameMode.Team, playerTeams: Quads, maxPlayers: 3 }),
    ).toBe("Quads (teams of 4)");
  });

  it("describes a numeric team count", () => {
    expect(
      label({ gameMode: GameMode.Team, playerTeams: 5, maxPlayers: 100 }),
    ).toBe("5 teams of 20");
    expect(label({ gameMode: GameMode.Team, playerTeams: 5 })).toBe("5 teams");
  });

  it("names a numeric team count after the preset it matches", () => {
    expect(
      label({ gameMode: GameMode.Team, playerTeams: 5, maxPlayers: 10 }),
    ).toBe("Duos (5 teams of 2)");
    expect(
      label({ gameMode: GameMode.Team, playerTeams: 4, maxPlayers: 16 }),
    ).toBe("Quads (4 teams of 4)");
  });

  it("shows only the team count when teams would be uneven", () => {
    expect(
      label({ gameMode: GameMode.Team, playerTeams: 5, maxPlayers: 11 }),
    ).toBe("5 teams");
    expect(
      label({ gameMode: GameMode.Team, playerTeams: 7, maxPlayers: 50 }),
    ).toBe("7 teams");
  });

  it("counts both sides of a public Humans vs Nations lobby", () => {
    expect(
      label({
        gameMode: GameMode.Team,
        gameType: GameType.Public,
        nations: "default",
        playerTeams: HumansVsNations,
        maxPlayers: 20,
      }),
    ).toBe("20 Humans vs 20 Nations");
  });

  it("leaves the nation count out when the host picked it", () => {
    for (const nations of ["default", 5] as const) {
      expect(
        label({
          gameMode: GameMode.Team,
          gameType: GameType.Private,
          nations,
          playerTeams: HumansVsNations,
          maxPlayers: 20,
        }),
      ).toBe("Humans vs Nations");
    }
  });
});
