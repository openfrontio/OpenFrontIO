import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GoToPlayerEvent } from "../../../../src/client/graphics/layers/Leaderboard";
import { TeamStats } from "../../../../src/client/graphics/layers/TeamStats";
import { GameMode } from "../../../../src/core/game/Game";

// Mocks für Utilities
vi.mock("../../src/client/Utils", () => ({
  translateText: vi.fn((key) => key),
  formatPercentage: vi.fn((val) => `${(val * 100).toFixed(0)}%`),
  renderNumber: vi.fn((val) => String(val)),
  renderTroops: vi.fn((val) => String(val)),
}));

describe("TeamStats Component", () => {
  let element: TeamStats;
  let mockGame: any;
  let mockEventBus: any;

  beforeEach(async () => {
    // 1. Mock EventBus
    mockEventBus = {
      emit: vi.fn(),
    };

    // 2. Mock GameView & PlayerViews
    const createPlayer = (id: string, team: string, tiles: number) => ({
      id,
      team: () => team,
      isAlive: () => true,
      gold: () => 100n,
      numTilesOwned: () => tiles,
      totalUnitLevels: vi.fn(() => 5),
    });

    mockGame = {
      config: () => ({
        gameConfig: () => ({ gameMode: GameMode.Team }),
        maxTroops: () => 1000,
      }),
      playerViews: vi.fn(() => [
        createPlayer("p1", "Red", 10), // Schwächerer Spieler
        createPlayer("p2", "Red", 50), // Bester Spieler in Team Red
        createPlayer("p3", "Blue", 20),
      ]),
      myPlayer: () => ({ team: () => "Red" }),
      inSpawnPhase: () => false,
      numLandTiles: () => 1000,
      numTilesWithFallout: () => 0,
    };

    if (!customElements.get("team-stats")) {
      customElements.define("team-stats", TeamStats);
    }

    element = document.createElement("team-stats") as TeamStats;
    element.game = mockGame;
    element.eventBus = mockEventBus;
    element.visible = true;

    document.body.appendChild(element);
    await element.updateComplete;
    // Initialer Tick um Daten zu laden
    element.tick();
    await element.updateComplete;
  });

  afterEach(() => {
    document.body.removeChild(element);
    vi.clearAllMocks();
  });

  describe("Sorting Interaction", () => {
    it("should change sort key and order when clicking headers", async () => {
      // Suche den Header für "Gold" (basierend auf dem translateText mock)
      const goldHeader = Array.from(
        element.querySelectorAll('[role="button"]'),
      ).find((el) =>
        el.textContent?.includes("leaderboard.gold"),
      ) as HTMLElement;

      expect(goldHeader).toBeTruthy();

      // Erster Klick: Sortiere nach Gold (desc)
      goldHeader.click();
      await element.updateComplete;
      expect((element as any)._sortKey).toBe("gold");
      expect((element as any)._sortOrder).toBe("desc");

      // Zweiter Klick: Wechselt zu asc
      goldHeader.click();
      await element.updateComplete;
      expect((element as any)._sortOrder).toBe("asc");
    });

    it("should correctly sort teams based on tiles owned", () => {
      // Team Red hat 60 Tiles (10+50), Team Blue hat 20.
      // Standard-Sortierung ist Tiles desc.
      expect(element.teams[0].teamName).toBe("Red");
      expect(element.teams[1].teamName).toBe("Blue");
    });
  });

  describe("Team Focus (GoToPlayerEvent)", () => {
    it("should emit GoToPlayerEvent for the strongest player when clicking a team row", async () => {
      // Wir suchen die Zeile für Team Red
      const redTeamRow = Array.from(
        element.querySelectorAll('[role="link"]'),
      ).find((el) => el.textContent?.includes("Red")) as HTMLElement;

      expect(redTeamRow).toBeTruthy();

      // Klick auf die Zeile
      redTeamRow.click();

      const emittedEvent = mockEventBus.emit.mock.calls[0][0];
      expect(emittedEvent).toBeInstanceOf(GoToPlayerEvent);
      expect(emittedEvent.player.id).toBe("p2");
    });
  });

  describe("UI Toggles", () => {
    it("should toggle between simple and unit stats view", async () => {
      const toggleButton = element.querySelector(
        "button.team-stats-button",
      ) as HTMLButtonElement;

      expect((element as any).showUnits).toBe(false);

      toggleButton.click();
      await element.updateComplete;

      expect((element as any).showUnits).toBe(true);
      // Prüfen ob neue Spalten gerendert werden (z.B. Launchers)
      expect(element.innerHTML).toContain("leaderboard.launchers");
    });
  });
});
