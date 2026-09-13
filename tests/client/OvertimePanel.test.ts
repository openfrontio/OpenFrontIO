import { OvertimePanel } from "../../src/client/components/OvertimePanel";
import type { GameView, PlayerView } from "../../src/client/view";
import { ColoredTeams, GameMode, Team } from "../../src/core/game/Game";

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
    id: () => name,
    displayName: () => name,
    numTilesOwned: () => tiles,
    isAlive: () => alive,
    team: () => team,
  } as unknown as PlayerView;
}

interface PanelOptions {
  gameMode?: GameMode;
  players?: PlayerView[];
  myPlayer?: PlayerView | null;
  elapsedSeconds?: number;
  enabled?: boolean;
}

// myPlayer defaults to null (a spectator): the readout is about first place,
// so it must render fully without a local player — only the bar color may
// consult it.
function createPanel({
  gameMode = GameMode.FFA,
  players = [],
  myPlayer = null,
  elapsedSeconds = 31 * 60,
  enabled = true,
}: PanelOptions = {}) {
  const game = {
    myPlayer: () => myPlayer,
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
    // A spectator has no side to root for, so the bar stays green.
    expect(panel.querySelector(".bg-green-400")).not.toBeNull();
    expect(panel.querySelector(".bg-red-400")).toBeNull();
  });

  it("colors the bar green when you lead and red when an opponent does", async () => {
    const alice = player("Alice", 425);
    const bob = player("Bob", 300);

    const leading = createPanel({ players: [alice, bob], myPlayer: alice });
    await leading.updateComplete;
    expect(leading.querySelector(".bg-green-400")).not.toBeNull();
    expect(leading.querySelector(".bg-red-400")).toBeNull();
    document.body.innerHTML = "";

    const trailing = createPanel({ players: [alice, bob], myPlayer: bob });
    await trailing.updateComplete;
    expect(trailing.querySelector(".bg-red-400")).not.toBeNull();
    expect(trailing.querySelector(".bg-green-400")).toBeNull();
  });

  it("colors the bar by whether your team leads in team games", async () => {
    const mine = player("A", 200, { team: "Red" });
    const players = [mine, player("C", 400, { team: "Blue" })];

    const trailing = createPanel({
      gameMode: GameMode.Team,
      players,
      myPlayer: mine,
    });
    await trailing.updateComplete;
    expect(trailing.textContent).toContain("overtime.first_place|Blue,40");
    expect(trailing.querySelector(".bg-red-400")).not.toBeNull();
    document.body.innerHTML = "";

    const leading = createPanel({
      gameMode: GameMode.Team,
      players,
      myPlayer: player("D", 0, { team: "Blue" }),
    });
    await leading.updateComplete;
    expect(leading.querySelector(".bg-green-400")).not.toBeNull();
    expect(leading.querySelector(".bg-red-400")).toBeNull();
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

  it("shows no first place while the bot team holds the most tiles", async () => {
    // The sim's win check evaluates only the overall max and bails out for
    // bots, so in this state nobody can win on tiles — showing the runner-up
    // as "1st" would imply a win that cannot happen.
    const panel = createPanel({
      gameMode: GameMode.Team,
      players: [
        player("bot1", 600, { team: ColoredTeams.Bot }),
        player("A", 300, { team: "Red" }),
        player("C", 100, { team: "Blue" }),
      ],
    });
    await panel.updateComplete;

    expect(panel.style.display).toBe("block");
    expect(panel.textContent).not.toContain("overtime.first_place");
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
