import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const copyToClipboardMock = vi.hoisted(() =>
  vi.fn(async (_text: string, onSuccess?: () => void) => onSuccess?.()),
);

const fetchPublicPlayerProfileMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/client/Utils", () => ({
  translateText: vi.fn((key: string) => key),
  copyToClipboard: copyToClipboardMock,
}));

vi.mock("../../src/client/Api", () => ({
  fetchPublicPlayerProfile: fetchPublicPlayerProfileMock,
}));

vi.mock(
  "../../src/client/components/baseComponents/stats/PlayerStatsTree",
  () => {
    class FakePlayerStatsTreeView extends HTMLElement {}
    if (!customElements.get("player-stats-tree-view")) {
      customElements.define("player-stats-tree-view", FakePlayerStatsTreeView);
    }
    return { PlayerStatsTreeView: FakePlayerStatsTreeView };
  },
);

import type { CopyButton } from "../../src/client/components/CopyButton";
import { modalRouter } from "../../src/client/ModalRouter";
import { initNavigation } from "../../src/client/Navigation";
import {
  PlayerProfileModal,
  playerProfileUrl,
} from "../../src/client/PlayerProfileModal";

type ModalShell = HTMLElement & { updateComplete: Promise<boolean> };

const statsTree = { Public: { "Free For All": {} } };

describe("public player profile route", () => {
  let modal: PlayerProfileModal;
  let playPage: HTMLElement;

  beforeAll(() => {
    playPage = document.createElement("div");
    playPage.id = "page-play";
    document.body.appendChild(playPage);
    initNavigation();
  });

  afterAll(() => {
    playPage.remove();
  });

  beforeEach(async () => {
    copyToClipboardMock.mockClear();
    fetchPublicPlayerProfileMock.mockReset();
    vi.stubGlobal("localStorage", { getItem: vi.fn(() => null) });
    history.replaceState(null, "", "/");
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
    history.replaceState(null, "", "/");
    vi.unstubAllGlobals();
  });

  it("opens a shared publicID and renders the fetched stats tree", async () => {
    fetchPublicPlayerProfileMock.mockResolvedValue({
      createdAt: "2026-01-01T00:00:00.000Z",
      stats: statsTree,
    });
    history.replaceState(null, "", "/#modal=profile&publicID=shared-player");

    expect(modalRouter.routeFromHash()).toBe(true);

    await vi.waitFor(async () => {
      await modal.updateComplete;
      const shell = modal.querySelector("o-modal") as ModalShell | null;
      await shell?.updateComplete;
      const treeView = modal.querySelector("player-stats-tree-view") as
        | (HTMLElement & { statsTree?: unknown })
        | null;
      expect(modal.isOpen()).toBe(true);
      expect(treeView?.statsTree).toEqual(statsTree);
    });

    expect(fetchPublicPlayerProfileMock).toHaveBeenCalledWith("shared-player");

    const copyButton = modal.querySelector<CopyButton>("copy-button")!;
    await copyButton.updateComplete;
    expect(copyButton.copyText).toBe(playerProfileUrl("shared-player"));
    expect(copyButton.displayText).toBe("shared-player");
    expect(copyButton.compact).toBe(true);

    expect(window.location.hash).toBe("#modal=profile&publicID=shared-player");

    const backButton = modal.querySelector(
      '[slot="header"] button',
    ) as HTMLButtonElement;
    backButton.click();

    expect(modal.isOpen()).toBe(false);
    expect(window.location.hash).toBe("");
  });

  it("shows not-found when the profile fetch fails", async () => {
    fetchPublicPlayerProfileMock.mockResolvedValue(false);
    history.replaceState(null, "", "/#modal=profile&publicID=missing");

    expect(modalRouter.routeFromHash()).toBe(true);

    await vi.waitFor(async () => {
      await modal.updateComplete;
      expect(modal.isOpen()).toBe(true);
      expect(modal.querySelector("player-stats-tree-view")).toBeNull();
      expect(modal.textContent).toContain("player_profile.not_found");
    });
    expect(fetchPublicPlayerProfileMock).toHaveBeenCalledWith("missing");
  });

  it("shows not-found without fetching when publicID is missing", async () => {
    history.replaceState(null, "", "/#modal=profile");

    expect(modalRouter.routeFromHash()).toBe(true);

    await vi.waitFor(async () => {
      await modal.updateComplete;
      expect(modal.isOpen()).toBe(true);
      expect(modal.textContent).toContain("player_profile.not_found");
    });
    expect(fetchPublicPlayerProfileMock).not.toHaveBeenCalled();
  });

  it("hands back to the clan modal when opened from a clan", async () => {
    fetchPublicPlayerProfileMock.mockResolvedValue({
      createdAt: "2026-01-01T00:00:00.000Z",
      stats: statsTree,
    });
    // The clan modal decides which tab to restore (Members vs Game History)
    // via returnFromPlayerProfile — the profile modal just hands back to it.
    const returnFromPlayerProfile = vi.fn();
    const fakeClanModal = document.createElement(
      "clan-modal",
    ) as HTMLElement & {
      returnFromPlayerProfile: () => void;
    };
    fakeClanModal.returnFromPlayerProfile = returnFromPlayerProfile;
    document.body.appendChild(fakeClanModal);

    modal.openFromClan("clan-member");
    await modal.updateComplete;
    expect(modal.isOpen()).toBe(true);

    const backButton = modal.querySelector(
      '[slot="header"] button',
    ) as HTMLButtonElement;
    backButton.click();

    expect(modal.isOpen()).toBe(false);
    expect(returnFromPlayerProfile).toHaveBeenCalled();
    fakeClanModal.remove();
  });
});
