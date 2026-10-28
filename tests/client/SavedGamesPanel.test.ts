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

import {
  type SavedGamesPanel,
  savedGameIdFrom,
  savedGameShareUrl,
} from "../../src/client/components/SavedGamesPanel";

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

function toggle(panel: Element) {
  return panel.querySelector<HTMLButtonElement>("[data-saved-games-toggle]")!;
}

/** Mounts the panel, opened as a player would unless `closed`. */
async function mount(props: Partial<SavedGamesPanel>, closed = false) {
  const panel = document.createElement("saved-games-panel");
  Object.assign(panel, props);
  document.body.appendChild(panel);
  await panel.updateComplete;
  if (!closed && toggle(panel).getAttribute("aria-expanded") !== "true") {
    toggle(panel).click();
    await panel.updateComplete;
  }
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

  it("starts closed, and loads the player's saves only once opened", async () => {
    const panel = await mount({ signedIn: true }, true);
    await settle(panel);
    expect(toggle(panel).getAttribute("aria-expanded")).toBe("false");
    expect(panel.querySelector("[data-save-code]")).toBeNull();
    expect(api.listSavedGames).not.toHaveBeenCalled();
    // The Solo modal's refresh on open waits for the panel too.
    await panel.refresh();
    expect(api.listSavedGames).not.toHaveBeenCalled();

    toggle(panel).click();
    await settle(panel);
    expect(api.listSavedGames).toHaveBeenCalledTimes(1);
    expect(panel.querySelector(`[data-save-id="${MINE.id}"]`)).not.toBeNull();

    toggle(panel).click();
    await panel.updateComplete;
    expect(panel.querySelector("[data-own-saves]")).toBeNull();
  });

  it("opens itself for a save a link names", async () => {
    api.fetchSharedSavedGame.mockResolvedValue(THEIRS);
    const panel = await mount({ signedIn: false, sharedId: THEIRS.id }, true);
    expect(toggle(panel).getAttribute("aria-expanded")).toBe("true");
    await vi.waitFor(() =>
      expect(panel.querySelector("[data-shared-save]")).not.toBeNull(),
    );
  });

  it("shows a guest without a link only the code box", async () => {
    const panel = await mount({ signedIn: false });
    await settle(panel);
    expect(panel.querySelector("[data-save-code]")).not.toBeNull();
    expect(panel.querySelector("[data-own-saves]")).toBeNull();
    expect(panel.querySelector("[data-shared-save]")).toBeNull();
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

  // Links don't open the game on Steam or the portals, so a shared save is
  // pasted in instead.
  it("opens the shared save a pasted link or code names", async () => {
    const panel = await mount({ signedIn: false });
    const opened: unknown[] = [];
    panel.addEventListener("open-shared-save", (e) =>
      opened.push((e as CustomEvent).detail),
    );
    const input = panel.querySelector<HTMLInputElement>("[data-save-code]")!;
    for (const pasted of [savedGameShareUrl(THEIRS.id), `  ${MINE.id} `]) {
      input.value = pasted;
      input.dispatchEvent(new Event("input"));
      await panel.updateComplete;
      panel
        .querySelector<HTMLButtonElement>('[data-action="open-code"]')!
        .click();
      await panel.updateComplete;
    }
    expect(opened).toEqual([THEIRS.id, MINE.id]);
    expect(input.value).toBe("");
    expect(panel.querySelector("[data-code-error]")).toBeNull();
    expect(input.getAttribute("aria-invalid")).toBe("false");
  });

  it("pastes without opening", async () => {
    const readText = vi.fn(async () => savedGameShareUrl(THEIRS.id));
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText, readText },
      configurable: true,
    });
    const panel = await mount({ signedIn: false });
    const opened: unknown[] = [];
    panel.addEventListener("open-shared-save", (e) =>
      opened.push((e as CustomEvent).detail),
    );
    panel
      .querySelector<HTMLButtonElement>('[data-action="paste-code"]')!
      .click();
    await settle(panel);
    expect(
      panel.querySelector<HTMLInputElement>("[data-save-code]")!.value,
    ).toBe(savedGameShareUrl(THEIRS.id));
    expect(opened).toEqual([]);
    expect(panel.querySelector("[data-code-error]")).toBeNull();
  });

  it("retries the shared save already offered when its code is entered again", async () => {
    api.fetchSharedSavedGame.mockResolvedValueOnce("request_failed");
    api.fetchSharedSavedGame.mockResolvedValueOnce(THEIRS);
    const panel = await mount({ signedIn: false, sharedId: THEIRS.id });
    await vi.waitFor(() =>
      expect(panel.querySelector("[data-shared-error]")).not.toBeNull(),
    );
    const opened: unknown[] = [];
    panel.addEventListener("open-shared-save", (e) =>
      opened.push((e as CustomEvent).detail),
    );
    const input = panel.querySelector<HTMLInputElement>("[data-save-code]")!;
    input.value = THEIRS.id;
    input.dispatchEvent(new Event("input"));
    await panel.updateComplete;
    panel
      .querySelector<HTMLButtonElement>('[data-action="open-code"]')!
      .click();
    await vi.waitFor(() =>
      expect(panel.querySelector("[data-shared-save]")?.textContent).toContain(
        "Their game",
      ),
    );
    expect(api.fetchSharedSavedGame).toHaveBeenCalledTimes(2);
    expect(opened).toEqual([]);
  });

  it("says when what's pasted isn't a shared game", async () => {
    const panel = await mount({ signedIn: false });
    const opened: unknown[] = [];
    panel.addEventListener("open-shared-save", (e) =>
      opened.push((e as CustomEvent).detail),
    );
    const input = panel.querySelector<HTMLInputElement>("[data-save-code]")!;
    input.value = "https://openfront.io/game/abc12345";
    input.dispatchEvent(new Event("input"));
    await panel.updateComplete;
    panel
      .querySelector<HTMLButtonElement>('[data-action="open-code"]')!
      .click();
    await panel.updateComplete;
    expect(opened).toEqual([]);
    const error = panel.querySelector("[data-code-error]")!;
    expect(error).not.toBeNull();
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-errormessage")).toBe(error.id);
  });
});

describe("savedGameIdFrom", () => {
  it("reads a bare code or a share link", () => {
    expect(savedGameIdFrom(MINE.id)).toBe(MINE.id);
    expect(savedGameIdFrom(savedGameShareUrl(MINE.id))).toBe(MINE.id);
    expect(
      savedGameIdFrom(
        `https://example.com/#modal=single-player&save=${MINE.id}`,
      ),
    ).toBe(MINE.id);
  });

  it("takes nothing else for a save", () => {
    expect(savedGameIdFrom("")).toBeNull();
    expect(savedGameIdFrom("../../users/@me")).toBeNull();
    expect(
      savedGameIdFrom("https://openfront.io/#modal=single-player"),
    ).toBeNull();
    expect(savedGameIdFrom("https://openfront.io/#save=../x")).toBeNull();
  });
});
