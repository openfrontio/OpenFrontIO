import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchPublicPlayerProfileMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/client/Api", () => ({
  fetchPublicPlayerProfile: fetchPublicPlayerProfileMock,
  fetchPublicPlayerGames: vi.fn(async () => ({
    results: [],
    nextCursor: null,
  })),
  claimReward: vi.fn(),
  getUserMe: vi.fn(async () => false),
  invalidateUserMe: vi.fn(),
}));

vi.mock("../../src/client/ProgressionApi", () => ({
  fetchPublicPlayerProgress: vi.fn(async () => ({
    prestige: 1,
    level: 42,
    lifetimeXp: 260000,
    legend: false,
    prestigeHistory: [],
    milestones: [],
  })),
  fetchProgressionConfig: vi.fn(async () => false),
}));

vi.mock("../../src/client/InGameModal", () => ({
  showInGameAlert: vi.fn(async () => {}),
}));

vi.mock("../../src/client/ProgressionAccount", () => ({
  resolveXpAccount: vi.fn(async () => ({ kind: "unknown" })),
}));

vi.mock("src/client/ClientEnv", () => ({
  ClientEnv: {
    workerPath: vi.fn(() => "w0"),
    shareOrigin: vi.fn(() => window.location.origin),
    shareBase: vi.fn(
      () => `${window.location.origin}${window.location.pathname}`,
    ),
  },
}));

vi.mock("../../src/client/TerrainMapFileLoader", () => ({
  terrainMapFileLoader: {
    getMapData: vi.fn(() => ({ webpPath: "/maps/world.webp" })),
  },
}));

vi.mock("../../src/client/Utils", () => ({
  getMapName: vi.fn((name: string) => name),
  renderDuration: vi.fn((seconds: number) => `${seconds}s`),
  translateText: vi.fn((key: string) => key),
  copyToClipboard: vi.fn(),
}));

vi.mock(
  "../../src/client/components/baseComponents/stats/PlayerStatsTree",
  () => ({}),
);

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

import { modalRouter } from "../../src/client/ModalRouter";
import { initNavigation } from "../../src/client/Navigation";
import { PlayerProfileModal } from "../../src/client/PlayerProfileModal";

type ModalShell = HTMLElement & { updateComplete: Promise<boolean> };
type CardEl = HTMLElement & { clanTag: string | null };

// Sample data: "Wonder", in AUS, LUX and NU.
const clan = (tag: string) => ({
  tag,
  name: `${tag} clan`,
  role: "member",
  joinedAt: "2026-01-01T00:00:00.000Z",
  memberCount: 3,
});

describe("player profile card clan tag", () => {
  let modal: PlayerProfileModal;
  let playPage: HTMLElement;

  async function settle(assertion: () => void): Promise<void> {
    await vi.waitFor(async () => {
      await modal.updateComplete;
      await (modal.querySelector("o-modal") as ModalShell | null)
        ?.updateComplete;
      assertion();
    });
  }

  const card = () => modal.querySelector<CardEl>("profile-card");

  beforeEach(async () => {
    vi.clearAllMocks();
    fetchPublicPlayerProfileMock.mockResolvedValue({
      createdAt: "2026-01-01T00:00:00.000Z",
      username: "Wonder",
      stats: {},
      clans: [clan("AUS"), clan("LUX"), clan("NU")],
    });
    history.replaceState(null, "", "/");
    playPage = document.createElement("div");
    playPage.id = "page-play";
    document.body.appendChild(playPage);
    initNavigation();
    modalRouter.register("profile", {
      tag: "player-profile-modal",
      pageId: "page-profile",
    });
    if (!customElements.get("player-profile-modal")) {
      customElements.define("player-profile-modal", PlayerProfileModal);
    }
    modal = document.createElement(
      "player-profile-modal",
    ) as PlayerProfileModal;
    modal.id = "page-profile";
    modal.setAttribute("inline", "");
    modal.className = "hidden page-content";
    document.body.appendChild(modal);
    await modal.updateComplete;
  });

  afterEach(() => {
    window.showPage?.("page-play");
    modal.remove();
    playPage.remove();
    history.replaceState(null, "", "/");
  });

  // Sample data: "Wonder", in AUS, LUX and NU.
  const profile = (extra: Record<string, unknown> = {}) => ({
    createdAt: "2026-01-01T00:00:00.000Z",
    username: "Wonder",
    stats: {},
    clans: [clan("AUS"), clan("LUX"), clan("NU")],
    ...extra,
  });

  it("shows the tag the API picked", async () => {
    fetchPublicPlayerProfileMock.mockResolvedValue(
      profile({ displayClanTag: "LUX" }),
    );
    modal.open({ publicID: "wonder01" });
    await settle(() => expect(card()?.clanTag).toBe("LUX"));
  });

  it("shows no tag when the API has none", async () => {
    fetchPublicPlayerProfileMock.mockResolvedValue(
      profile({ displayClanTag: null }),
    );
    modal.open({ publicID: "wonder01" });
    await settle(() => expect(card()).not.toBeNull());
    expect(card()!.clanTag).toBeNull();
  });

  it("an API without the field shows the first clan, as before", async () => {
    fetchPublicPlayerProfileMock.mockResolvedValue(profile());
    modal.open({ publicID: "wonder01" });
    await settle(() => expect(card()?.clanTag).toBe("AUS"));
  });
});
