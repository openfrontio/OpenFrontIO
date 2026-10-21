import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  listSavedGames: vi.fn(),
  updateSavedGame: vi.fn(),
  deleteSavedGame: vi.fn(),
  fetchSharedSavedGame: vi.fn(),
}));
vi.mock("../../src/client/SavedGamesApi", () => api);

const dialogs = vi.hoisted(() => ({
  showInGameConfirm: vi.fn(async () => true),
  showInGameAlert: vi.fn(async () => true),
}));
vi.mock("../../src/client/InGameModal", () => dialogs);

import "../../src/client/components/SavedGamesPanel";
import type { SavedGamesPanel } from "../../src/client/components/SavedGamesPanel";

const MINE = {
  id: "mine0000000000000000aa",
  name: "My game",
  map: "World",
  tick: 3000,
  sizeBytes: 100,
  public: false,
  createdAt: "2026-10-19T14:05:00.000Z",
};
const THEIRS = { ...MINE, id: "theirs00000000000000bb", name: "Their game" };

async function mount(props: Partial<SavedGamesPanel>) {
  const panel = document.createElement("saved-games-panel");
  Object.assign(panel, props);
  document.body.appendChild(panel);
  await panel.updateComplete;
  return panel;
}

async function settle(panel: SavedGamesPanel) {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
    await panel.updateComplete;
  }
}

function action(panel: Element, id: string, name: string) {
  return panel.querySelector<HTMLButtonElement>(
    `[data-save-id="${id}"] [data-action="${name}"]`,
  )!;
}

describe("saved-games-panel", () => {
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    api.listSavedGames.mockResolvedValue([MINE]);
    writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows nothing to a guest without a link", async () => {
    const panel = await mount({ signedIn: false });
    await settle(panel);
    expect(panel.textContent?.trim()).toBe("");
    expect(api.listSavedGames).not.toHaveBeenCalled();
  });

  // The Solo modal refreshes the panel on every open, guests included.
  it("doesn't ask a guest's saves on refresh", async () => {
    const panel = await mount({ signedIn: false });
    await panel.refresh();
    expect(api.listSavedGames).not.toHaveBeenCalled();
  });

  it("lists the player's saves and starts one from Play", async () => {
    const panel = await mount({ signedIn: true });
    await settle(panel);
    expect(api.listSavedGames).toHaveBeenCalledTimes(1);
    expect(panel.querySelector(`[data-save-id="${MINE.id}"]`)).not.toBeNull();

    const loads: unknown[] = [];
    panel.addEventListener("load-saved-game", (e) =>
      loads.push((e as CustomEvent).detail),
    );
    action(panel, MINE.id, "play").click();
    expect(loads).toEqual([{ id: MINE.id, shared: false }]);
  });

  it("holds Play while a game is starting", async () => {
    const panel = await mount({ signedIn: true, busy: true });
    await settle(panel);
    expect(action(panel, MINE.id, "play").disabled).toBe(true);
  });

  it("shares a save and copies its link", async () => {
    api.updateSavedGame.mockResolvedValue({ ...MINE, public: true });
    const panel = await mount({ signedIn: true });
    await settle(panel);

    action(panel, MINE.id, "toggle-share").click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));

    expect(api.updateSavedGame).toHaveBeenCalledWith(MINE.id, { public: true });
    expect(writeText.mock.calls[0][0]).toMatch(
      new RegExp(`/#modal=single-player&save=${MINE.id}$`),
    );
    await settle(panel);
    expect(action(panel, MINE.id, "copy-link")).not.toBeNull();
  });

  it("explains a name the API won't put on a shared save", async () => {
    api.updateSavedGame.mockResolvedValue("rejected");
    const panel = await mount({ signedIn: true });
    await settle(panel);

    action(panel, MINE.id, "toggle-share").click();
    await vi.waitFor(() =>
      expect(panel.querySelector("[data-row-error]")?.textContent).toContain(
        "saved_games.error.name_not_shareable",
      ),
    );
    expect(writeText).not.toHaveBeenCalled();
  });

  it("renames a save", async () => {
    api.updateSavedGame.mockResolvedValue({ ...MINE, name: "Renamed" });
    const panel = await mount({ signedIn: true });
    await settle(panel);

    action(panel, MINE.id, "rename").click();
    await settle(panel);
    const input = panel.querySelector<HTMLInputElement>(
      `[data-save-id="${MINE.id}"] input`,
    )!;
    input.value = "Renamed";
    input.dispatchEvent(new Event("input"));
    action(panel, MINE.id, "rename-save").click();

    await vi.waitFor(() =>
      expect(
        panel.querySelector(`[data-save-id="${MINE.id}"]`)?.textContent,
      ).toContain("Renamed"),
    );
    expect(api.updateSavedGame).toHaveBeenCalledWith(MINE.id, {
      name: "Renamed",
    });
  });

  it("deletes a save once the player confirms", async () => {
    api.deleteSavedGame.mockResolvedValue(true);
    const panel = await mount({ signedIn: true });
    await settle(panel);

    action(panel, MINE.id, "delete").click();
    await vi.waitFor(() =>
      expect(panel.querySelector(`[data-save-id="${MINE.id}"]`)).toBeNull(),
    );
    expect(dialogs.showInGameConfirm).toHaveBeenCalledTimes(1);
    expect(api.deleteSavedGame).toHaveBeenCalledWith(MINE.id);
  });

  it("keeps a save the player didn't confirm deleting", async () => {
    dialogs.showInGameConfirm.mockResolvedValueOnce(false);
    const panel = await mount({ signedIn: true });
    await settle(panel);

    action(panel, MINE.id, "delete").click();
    await settle(panel);
    expect(api.deleteSavedGame).not.toHaveBeenCalled();
    expect(panel.querySelector(`[data-save-id="${MINE.id}"]`)).not.toBeNull();
  });

  it("offers a shared save from a link, even to a guest", async () => {
    api.fetchSharedSavedGame.mockResolvedValue(THEIRS);
    const panel = await mount({ signedIn: false, sharedId: THEIRS.id });
    await vi.waitFor(() =>
      expect(panel.querySelector("[data-shared-save]")?.textContent).toContain(
        "Their game",
      ),
    );

    const loads: unknown[] = [];
    panel.addEventListener("load-saved-game", (e) =>
      loads.push((e as CustomEvent).detail),
    );
    panel
      .querySelector<HTMLButtonElement>('[data-action="play-shared"]')!
      .click();
    expect(loads).toEqual([{ id: THEIRS.id, shared: true }]);
  });

  it("says when a linked save isn't available", async () => {
    api.fetchSharedSavedGame.mockResolvedValue("not_found");
    const panel = await mount({ signedIn: false, sharedId: THEIRS.id });
    await vi.waitFor(() =>
      expect(panel.querySelector("[data-shared-error]")?.textContent).toContain(
        "saved_games.error.shared_not_found",
      ),
    );
  });
});
