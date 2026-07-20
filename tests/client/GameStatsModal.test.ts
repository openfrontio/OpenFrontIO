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

vi.mock("../../src/client/Utils", () => ({
  translateText: vi.fn((key: string) => key),
  copyToClipboard: copyToClipboardMock,
}));

vi.mock("../../src/client/components/baseComponents/stats/GameInfoView", () => {
  class FakeGameInfoView extends HTMLElement {}
  if (!customElements.get("game-info-view")) {
    customElements.define("game-info-view", FakeGameInfoView);
  }
  return { GameInfoView: FakeGameInfoView };
});

import type { CopyButton } from "../../src/client/components/CopyButton";
import { GameStatsModal } from "../../src/client/GameStatsModal";
import { modalRouter } from "../../src/client/ModalRouter";
import { initNavigation } from "../../src/client/Navigation";

type ModalShell = HTMLElement & { updateComplete: Promise<boolean> };

describe("public game stats route", () => {
  let modal: GameStatsModal;
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
    vi.stubGlobal("localStorage", { getItem: vi.fn(() => null) });
    history.replaceState(null, "", "/");
    modalRouter.register("stats", {
      tag: "game-stats-modal",
      pageId: "page-stats",
    });
    if (!customElements.get("game-stats-modal")) {
      customElements.define("game-stats-modal", GameStatsModal);
    }

    modal = document.createElement("game-stats-modal") as GameStatsModal;
    modal.id = "page-stats";
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

  it("opens a shared gameID without mounting the authenticated account", async () => {
    history.replaceState(null, "", "/#modal=stats&gameID=public-game");

    expect(modalRouter.routeFromHash()).toBe(true);

    await vi.waitFor(async () => {
      await modal.updateComplete;
      const shell = modal.querySelector("o-modal") as ModalShell | null;
      await shell?.updateComplete;
      const statsView = modal.querySelector("game-info-view") as
        | (HTMLElement & { gameId: string | null })
        | null;
      expect(modal.isOpen()).toBe(true);
      expect(statsView?.gameId).toBe("public-game");
    });

    const copyButton = modal.querySelector<CopyButton>("copy-button")!;
    await copyButton.updateComplete;
    expect(copyButton.copyText).toBe("public-game");
    expect(copyButton.displayText).toBe("public-game");
    expect(copyButton.compact).toBe(true);
    expect(copyButton.showVisibilityToggle).toBe(false);

    const copyActions = copyButton.querySelectorAll("button");
    expect(copyActions).toHaveLength(1);
    expect(copyActions[0].textContent).toContain("public-game");
    expect(copyActions[0].getAttribute("aria-label")).toBe(
      "common.click_to_copy",
    );
    copyActions[0].click();
    await vi.waitFor(() =>
      expect(copyToClipboardMock).toHaveBeenCalledWith(
        "public-game",
        expect.any(Function),
        expect.any(Function),
      ),
    );
    await copyButton.updateComplete;
    expect(copyButton.textContent).toContain("common.copied");

    expect(document.querySelector("account-modal")).toBeNull();
    expect(window.location.hash).toBe("#modal=stats&gameID=public-game");

    const backButton = modal.querySelector(
      '[slot="header"] button',
    ) as HTMLButtonElement;
    backButton.click();

    expect(modal.isOpen()).toBe(false);
    expect(window.location.hash).toBe("");
  });
});
