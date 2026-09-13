import { OvertimePanel } from "../../src/client/components/OvertimePanel";
import type { GameView, PlayerView } from "../../src/client/view";
import { GameMode, Team } from "../../src/core/game/Game";

// Keys pass through with their params appended, so assertions can check both
// which string is shown and what it was filled with.
vi.mock("../../src/client/Utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Utils")>()),
  translateText: (key: string, params?: Record<string, string | number>) =>
    params ? `${key}|${Object.values(params).join(",")}` : key,
}));

function player(
  name: string,
  tiles: number,
  { alive = true, team = null as Team | null } = {},
): PlayerView {
  return {
    displayName: () => name,
    numTilesOwned: () => tiles,
    isAlive: () => alive,
    team: () => team,
  } as unknown as PlayerView;
}

interface PanelOptions {
  gameMode?: GameMode;
  players?: PlayerView[];
  elapsedSeconds?: number;
  enabled?: boolean;
}

// Deliberately no myPlayer(): the readout is about first place, so it must
// render identically for spectators, who have no player at all.
function createPanel({
  gameMode = GameMode.FFA,
  players = [],
  elapsedSeconds = 31 * 60,
  enabled = true,
}: PanelOptions = {}) {
  const game = {
    config: () => ({
      overtimeConfig: () => ({
        enabled,
        startMinutes: 30,
        dropPercentPerMinute: 1,
      }),
      percentageTilesOwnedToWin: () => 70,
      gameConfig: () => ({ gameMode }),
    }),
    elapsedGameSeconds: () => elapsedSeconds,
    numLandTiles: () => 1000,
    numTilesWithFallout: () => 0,
    playerViews: () => players,
  } as unknown as GameView;

  const panel = new OvertimePanel();
  panel.game = game;
  document.body.appendChild(panel);
  return panel;
}

describe("OvertimePanel", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows the first-place player's share in FFA, even without a local player", async () => {
    const panel = createPanel({
      players: [player("Bob", 300), player("Alice", 425), player("Eve", 100)],
    });
    await panel.updateComplete;

    expect(panel.style.display).toBe("block");
    expect(panel.textContent).toContain("overtime.first_place|Alice,42");
  });

  it("ignores eliminated players when picking first place", async () => {
    const panel = createPanel({
      players: [player("Ghost", 900, { alive: false }), player("Bob", 300)],
    });
    await panel.updateComplete;

    expect(panel.textContent).toContain("overtime.first_place|Bob,30");
  });

  it("shows the leading team's combined share in team games", async () => {
    const panel = createPanel({
      gameMode: GameMode.Team,
      players: [
        player("A", 200, { team: "Red" }),
        player("B", 300, { team: "Red" }),
        player("C", 400, { team: "Blue" }),
      ],
    });
    await panel.updateComplete;

    expect(panel.textContent).toContain("overtime.first_place|Red,50");
  });

  it("stays hidden before the start minute", async () => {
    const panel = createPanel({
      players: [player("Alice", 425)],
      elapsedSeconds: 60,
    });
    await panel.updateComplete;

    expect(panel.style.display).toBe("none");
    expect(panel.textContent).not.toContain("overtime.first_place");
  });
});
