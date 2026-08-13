import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  apiMockFactory,
  authMockFactory,
  clanApiMockFactory,
  crazyGamesSdkMockFactory,
  setState,
  stubLocalStorage,
  utilsMockFactory,
  virtualizerMockFactory,
  waitForSubComponent,
} from "./ClanModalTestUtils";

vi.mock("@lit-labs/virtualizer/virtualize.js", () => virtualizerMockFactory());
vi.mock("../../../src/client/Api", () => apiMockFactory());
vi.mock("../../../src/client/ClanApi", () => clanApiMockFactory());
vi.mock("../../../src/client/Utils", () => utilsMockFactory());
vi.mock("../../../src/client/Auth", () => authMockFactory());
vi.mock("../../../src/client/CrazyGamesSDK", () => crazyGamesSdkMockFactory());

stubLocalStorage();

import { ClanModal } from "../../../src/client/ClanModal";

const windowResponse = (clan: Record<string, unknown>) => ({
  start: "2026-08-12T18:00:00.000Z",
  end: "2026-08-13T18:00:00.000Z",
  clan: {
    clanTag: "TST",
    games: 0,
    playerSessions: 0,
    wins: 0,
    losses: 0,
    weightedWins: 0,
    weightedLosses: 0,
    weightedWLRatio: 1,
    ...clan,
  },
});

describe("ClanDetailView — past 24 hours card", () => {
  let modal: ClanModal;

  const mockRecentStats = async (value: unknown) => {
    const { fetchClanRecentStats } =
      await import("../../../src/client/ClanApi");
    (fetchClanRecentStats as ReturnType<typeof vi.fn>).mockResolvedValue(value);
  };

  const openDetail = async () => {
    setState(modal, "selectedClanTag" as keyof ClanModal, "TST" as never);
    setState(modal, "view" as keyof ClanModal, "detail" as never);
    return waitForSubComponent(modal, "clan-detail-view");
  };

  beforeEach(async () => {
    if (!customElements.get("clan-modal")) {
      customElements.define("clan-modal", ClanModal);
    }
    modal = document.createElement("clan-modal") as ClanModal;
    modal.setAttribute("inline", "");
    document.body.appendChild(modal);
    await modal.updateComplete;
  });

  afterEach(() => {
    document.body.removeChild(modal);
    vi.clearAllMocks();
  });

  it("fetches the 24h window for the clan being viewed", async () => {
    await mockRecentStats(windowResponse({ games: 0 }));
    await openDetail();

    const { fetchClanRecentStats } =
      await import("../../../src/client/ClanApi");
    expect(fetchClanRecentStats).toHaveBeenCalledWith("TST");
  });

  it("renders the win/loss bar and weighted metrics when games were played", async () => {
    await mockRecentStats(
      windowResponse({
        games: 12,
        playerSessions: 30,
        wins: 5,
        losses: 7,
        weightedWins: 8.4,
        weightedLosses: 4.5,
        weightedWLRatio: 1.87,
      }),
    );
    const view = await openDetail();

    expect(view.textContent).toContain("clan_modal.recent_24h_title");
    expect(view.textContent).not.toContain("clan_modal.recent_24h_empty");
    // renderWLBarRow labels, plus the weighted figures.
    expect(view.textContent).toContain("5W");
    expect(view.textContent).toContain("7L");
    expect(view.textContent).toContain("8.4");
    expect(view.textContent).toContain("4.5");
    expect(view.textContent).toContain("1.87");

    const { translateText } = await import("../../../src/client/Utils");
    const gamesCall = (
      translateText as ReturnType<typeof vi.fn>
    ).mock.calls.find((c) => c[0] === "clan_modal.recent_24h_games");
    expect(gamesCall?.[1]).toEqual({ count: 12 });
  });

  it("shows the empty message instead of metrics when no games were played", async () => {
    await mockRecentStats(windowResponse({ games: 0 }));
    const view = await openDetail();

    expect(view.textContent).toContain("clan_modal.recent_24h_title");
    expect(view.textContent).toContain("clan_modal.recent_24h_empty");
    expect(view.textContent).not.toContain("leaderboard_modal.win_score");
  });

  it("hides the card entirely when the public endpoint is unavailable", async () => {
    await mockRecentStats(false);
    const view = await openDetail();

    expect(view.textContent).not.toContain("clan_modal.recent_24h_title");
    // The rest of the overview still renders.
    expect(view.textContent).toContain("clan_modal.members");
  });
});
