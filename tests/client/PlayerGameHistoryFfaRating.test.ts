import type { FfaRatingGameDelta } from "@openfront/shared/ApiSchemas";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Api", () => ({
  fetchPublicPlayerGames: vi.fn(),
}));

vi.mock("../../src/client/TerrainMapFileLoader", () => ({
  terrainMapFileLoader: {
    getMapData: vi.fn(() => {
      throw new Error("unknown map");
    }),
  },
}));

vi.mock("../../src/client/Utils", () => ({
  translateText: (k: string, p?: Record<string, string | number>) =>
    p ? `${k}:${JSON.stringify(p)}` : k,
  getMapName: () => null,
  renderDuration: () => "10m",
  copyToClipboard: vi.fn(),
  showToast: vi.fn(),
}));

class FakeIntersectionObserver {
  constructor(_callback: IntersectionObserverCallback) {}
  observe() {}
  disconnect() {}
  unobserve() {}
  takeRecords() {
    return [];
  }
  root = null;
  rootMargin = "";
  thresholds = [];
}
vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);

import { fetchPublicPlayerGames } from "../../src/client/Api";
import type { PlayerGameHistoryView } from "../../src/client/components/baseComponents/stats/PlayerGameHistoryView";
import "../../src/client/components/baseComponents/stats/PlayerGameHistoryView";

const game = (gameId: string, ffaRating?: FfaRatingGameDelta | null) => ({
  gameId,
  start: "2026-10-20T00:00:00.000Z",
  durationSeconds: 600,
  map: "",
  mode: "Free For All",
  type: "Public",
  playerTeams: null,
  rankedType: "unranked",
  result: "victory",
  totalPlayers: 24,
  username: "bob",
  clanTag: null,
  ffaRating,
});

let view: PlayerGameHistoryView;
afterEach(() => view?.remove());

async function renderHistory(
  g: ReturnType<typeof game>,
): Promise<PlayerGameHistoryView> {
  vi.mocked(fetchPublicPlayerGames).mockResolvedValue({
    results: [g],
    nextCursor: null,
  } as never);
  view = document.createElement(
    "player-game-history-view",
  ) as PlayerGameHistoryView;
  view.publicId = "p1";
  document.body.appendChild(view);
  await vi.waitFor(async () => {
    await view.updateComplete;
    expect(view.textContent).toContain("bob");
  });
  return view;
}

describe("<player-game-history-view> FFA rating", () => {
  it("shows the rating change, its split and expected win on a rated FFA row", async () => {
    await renderHistory(
      game("g1", {
        before: 1600.4,
        after: 1612.6,
        expected: 0.0623,
        deltaResult: 9.1,
        deltaPlace: 3.1,
      }),
    );
    const chip = view.querySelector<HTMLElement>("[data-ffa-rating-change]")!;
    expect(chip.textContent).toContain("+12");
    expect(chip.title).toBe("ffa_rating.result +9 · ffa_rating.placement +3");
    expect(chip.className).toContain("text-green-400");
    expect(
      view.querySelector("[data-ffa-rating-expected]")!.textContent,
    ).toContain('ffa_rating.expected:{"pct":"6.2"}');
    expect(view.textContent).toContain("ffa_rating.title");
  });

  it("colours a loss red", async () => {
    await renderHistory(
      game("g3", {
        before: 1600,
        after: 1590,
        expected: 0.2,
        deltaResult: -8,
        deltaPlace: -2,
      }),
    );
    const chip = view.querySelector<HTMLElement>("[data-ffa-rating-change]")!;
    expect(chip.textContent).toContain("-10");
    expect(chip.className).toContain("text-red-400");
  });

  it.each([null, undefined])(
    "shows no rating on a row whose ffaRating is %s",
    async (ffaRating) => {
      await renderHistory(game("g2", ffaRating));
      expect(view.querySelector("[data-ffa-rating-change]")).toBeNull();
      expect(view.querySelector("[data-ffa-rating-expected]")).toBeNull();
    },
  );
});
