import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LevelBadge as LevelBadgeElement } from "../../../src/client/components/LevelBadge";
import {
  badgeFrameScheduled,
  badgesDrawn,
  pendingBadges,
  STAGGER_ABOVE,
} from "../../../src/client/components/LevelBadgeFill";
import "../../../src/client/components/LobbyPlayerView";
import type { LobbyTeamView } from "../../../src/client/components/LobbyPlayerView";
import { GameMode } from "../../../src/core/game/Game";
import { UserSettings } from "../../../src/core/game/UserSettings";
import { packLevelBadge } from "../../../src/core/LevelBadgeWire";
import type { ClientInfo } from "../../../src/core/Schemas";

// A full lobby's badges arrive in one render; past a handful they are drawn
// over the following frames (LevelBadgeFill) instead of all in one.

function roster(n: number, from = 0): ClientInfo[] {
  return Array.from({ length: n }, (_, k) => {
    const i = from + k;
    return {
      clientID: `c${i}`,
      username: `Player${i}`,
      clanTag: null,
      levelBadge: packLevelBadge({
        level: 1 + ((i * 37) % 100),
        prestige: i % 11,
        legend: i === 7,
      }),
    };
  });
}

const badges = (view: Element) =>
  Array.from(view.querySelectorAll<LevelBadgeElement>("level-badge"));
const waitingSquares = (view: Element) =>
  view.querySelectorAll("level-badge > [data-badge-waiting]");
const drawnBadges = (view: Element) =>
  view.querySelectorAll("level-badge > svg[role=img]");

// Mounts the view and lets every badge finish its first render, but no
// animation frame: what the first paint shows.
async function mount(
  clients: ClientInfo[],
  props: Partial<LobbyTeamView> = {},
): Promise<LobbyTeamView> {
  const view = document.createElement("lobby-player-view") as LobbyTeamView;
  view.gameMode = GameMode.FFA;
  view.teamCount = 2;
  Object.assign(view, props, { clients });
  document.body.append(view);
  await view.updateComplete;
  await Promise.all(badges(view).map((b) => b.updateComplete));
  return view;
}

async function update(view: LobbyTeamView, clients: ClientInfo[]) {
  view.clients = clients;
  await view.updateComplete;
  await Promise.all(badges(view).map((b) => b.updateComplete));
}

// A 150-player roster is slow to build in jsdom (300 badges in team mode),
// more so with the rest of the suite running alongside.
describe("lobby badges arriving many at once", { timeout: 20_000 }, () => {
  // jsdom's frames are 16 ms apart and its layout-free "frames" are slow to
  // build badges in, which would make a 300-badge fill take seconds; frames
  // here come back as soon as the event loop is free.
  let cancel: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(
      (cb) => setTimeout(() => cb(performance.now()), 0) as unknown as number,
    );
    cancel = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation((id) => clearTimeout(id));
    localStorage.clear();
    (
      UserSettings as unknown as { cache: Map<string, string | null> }
    ).cache.clear();
  });

  afterEach(async () => {
    document.body.replaceChildren();
    await badgesDrawn();
    vi.restoreAllMocks();
  });

  for (const [mode, perPlayer] of [
    [GameMode.FFA, 1],
    [GameMode.Team, 2],
  ] as const) {
    describe(`${mode}`, () => {
      it("draws 150 players' badges over later frames, then all of them", async () => {
        const view = await mount(roster(150), { gameMode: mode });

        // First paint: every row has its badge element, holding its square.
        expect(badges(view).length).toBe(150 * perPlayer);
        expect(waitingSquares(view).length).toBe(150 * perPlayer);
        expect(drawnBadges(view).length).toBe(0);
        expect(badgeFrameScheduled()).toBe(true);

        await badgesDrawn();

        expect(waitingSquares(view).length).toBe(0);
        expect(drawnBadges(view).length).toBe(150 * perPlayer);
        expect(pendingBadges()).toBe(0);
        expect(badgeFrameScheduled()).toBe(false);
        // Each one is the player's own badge.
        const labels = badges(view)
          .slice(0, 3)
          .map((b) => b.querySelector("svg")?.getAttribute("aria-label"));
        expect(labels).toEqual([
          "progression.level",
          "progression.level, progression.prestige",
          "progression.level, progression.prestige",
        ]);
      });
    });
  }

  it("draws an 8-player FFA lobby straight away", async () => {
    expect(8).toBeLessThanOrEqual(STAGGER_ABOVE);
    const view = await mount(roster(8));

    expect(drawnBadges(view).length).toBe(8);
    expect(waitingSquares(view).length).toBe(0);
    expect(pendingBadges()).toBe(0);
  });

  it("staggers an 8-player team lobby's 16 badges and completes", async () => {
    const view = await mount(roster(8), { gameMode: GameMode.Team });

    expect(waitingSquares(view).length).toBe(16);
    await badgesDrawn();
    expect(drawnBadges(view).length).toBe(16);
    expect(waitingSquares(view).length).toBe(0);
  });

  it("holds exactly the drawn badge's box while waiting", async () => {
    const view = await mount(roster(150));
    const first = badges(view)[0];
    const square = first.querySelector<HTMLElement>("[data-badge-waiting]")!;
    const hostClass = first.className;

    expect(square.style.width).toBe("24px");
    expect(square.style.height).toBe("24px");
    expect(square.classList.contains("block")).toBe(true);
    expect(square.getAttribute("aria-hidden")).toBe("true");
    // The badge sits in front of the name from the first paint on.
    expect(first.parentElement!.firstElementChild).toBe(first);
    expect(first.parentElement!.textContent).toContain("Player0");

    await badgesDrawn();

    const svg = first.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("24");
    expect(svg.getAttribute("height")).toBe("24");
    expect(svg.classList.contains("block")).toBe(true);
    // Same host element, same classes: the row around it is unchanged.
    expect(badges(view)[0]).toBe(first);
    expect(first.className).toBe(hostClass);
  });

  it("draws a single join straight away, also during a fill", async () => {
    const players = roster(150);
    const view = await mount(players);
    expect(pendingBadges()).toBe(150);

    await update(view, [...players, ...roster(1, 150)]);

    const joined = badges(view)[badges(view).length - 1];
    expect(joined.querySelector("svg[role=img]")).not.toBeNull();
    expect(pendingBadges()).toBe(150);

    await badgesDrawn();
    await update(view, [...players, ...roster(2, 150)]);
    const last = badges(view)[badges(view).length - 1];
    expect(last.querySelector("svg[role=img]")).not.toBeNull();
    expect(pendingBadges()).toBe(0);
    expect(badgeFrameScheduled()).toBe(false);
  });

  it("redraws a changed badge on a drawn list straight away", async () => {
    const players = roster(150);
    const view = await mount(players);
    await badgesDrawn();

    const changed = players.map((c, i) =>
      i === 3
        ? {
            ...c,
            levelBadge: packLevelBadge({
              level: 1,
              prestige: 0,
              legend: true,
            }),
          }
        : c,
    );
    await update(view, changed);

    expect(
      badges(view)[3].querySelector("svg")?.getAttribute("data-level-band"),
    ).toBe("legend");
    expect(pendingBadges()).toBe(0);
  });

  it("shows no other player's badge with anonymous names on", async () => {
    new UserSettings().toggleRandomName();
    const view = await mount(roster(150), { currentClientID: "c0" });

    // Only the viewer's own badge, drawn at once (it arrives alone).
    expect(badges(view).length).toBe(1);
    expect(drawnBadges(view).length).toBe(1);
    expect(pendingBadges()).toBe(0);
  });

  it("shows no badges, and holds no squares, for an anonymised roster", async () => {
    // The server sends anonymised entries without a level badge.
    const anonymous = roster(150).map(({ levelBadge: _, ...c }) => c);
    const view = await mount(anonymous, {
      gameMode: GameMode.Team,
      anonymizeNames: true,
    });

    expect(badges(view).length).toBe(0);
    expect(view.querySelector(".lobby-level-slot")).toBeNull();
    expect(pendingBadges()).toBe(0);
    expect(badgeFrameScheduled()).toBe(false);
  });

  it("cancels the pending frames when the list is removed mid-fill", async () => {
    cancel.mockClear();
    const view = await mount(roster(150), { gameMode: GameMode.Team });
    // Let the fill get going: the ordering frame, then a drawing frame.
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => setTimeout(r, 0));
    const waitingBefore = pendingBadges();
    expect(waitingBefore).toBeGreaterThan(0);
    expect(waitingBefore).toBeLessThan(300);

    view.remove();

    expect(pendingBadges()).toBe(0);
    expect(badgeFrameScheduled()).toBe(false);
    expect(cancel).toHaveBeenCalled();
    // Nothing is drawn into the removed list afterwards.
    const stillWaiting = waitingSquares(view).length;
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(waitingSquares(view).length).toBe(stillWaiting);
    await expect(badgesDrawn()).resolves.toBeUndefined();
  });

  it("draws a list re-attached mid-fill once it is back", async () => {
    const view = await mount(roster(150));
    view.remove();
    expect(pendingBadges()).toBe(0);

    document.body.append(view);
    expect(pendingBadges()).toBe(150);
    await badgesDrawn();
    expect(drawnBadges(view).length).toBe(150);
  });
});
