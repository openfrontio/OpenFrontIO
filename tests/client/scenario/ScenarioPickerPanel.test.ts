import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  listMyScenarios: vi.fn(),
  listPublishedScenarios: vi.fn(),
}));
vi.mock(
  "../../../src/client/scenario/ScenariosApi",
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    listMyScenarios: api.listMyScenarios,
    listPublishedScenarios: api.listPublishedScenarios,
  }),
);

vi.mock("../../../src/client/Api", () => ({
  getApiBase: vi.fn(() => "https://api.test"),
}));

const picker = vi.hoisted(() => ({ downloadPlayableScenario: vi.fn() }));
vi.mock(
  "../../../src/client/scenario/ScenarioPicker",
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    downloadPlayableScenario: picker.downloadPlayableScenario,
  }),
);

// Side-effect import so the custom element registers.
import "../../../src/client/scenario/ScenarioPickerPanel";
import type { ScenarioPickerPanel } from "../../../src/client/scenario/ScenarioPickerPanel";

function published(n: number) {
  return {
    id: `scenario${String(n).padStart(14, "0")}`,
    name: `Scenario ${n}`,
    description: `About ${n}`,
    createdAt: "",
    latestVersion: 1,
    publishedAt: "",
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

async function panel(signedIn = false): Promise<ScenarioPickerPanel> {
  const el = document.createElement("scenario-picker-panel");
  el.signedIn = signedIn;
  document.body.replaceChildren(el);
  await el.updateComplete;
  return el;
}

async function click(el: ScenarioPickerPanel, selector: string) {
  const target = el.querySelector<HTMLElement>(selector);
  expect(target, selector).not.toBeNull();
  target!.click();
  await flush();
  await el.updateComplete;
}

describe("<scenario-picker-panel>", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listPublishedScenarios.mockResolvedValue([published(1), published(2)]);
    api.listMyScenarios.mockResolvedValue([]);
  });

  it("lists shared scenarios once opened, signed out", async () => {
    const el = await panel();
    expect(el.querySelector("[data-scenario-id]")).toBeNull();
    expect(api.listPublishedScenarios).not.toHaveBeenCalled();

    await click(el, "[data-scenarios-toggle]");

    expect(api.listMyScenarios).not.toHaveBeenCalled();
    expect(el.querySelector('[data-scenario-tab="mine"]')).toBeNull();
    const entries = el.querySelectorAll("[data-scenario-id]");
    expect(entries).toHaveLength(2);
    expect(entries[0].textContent).toContain("Scenario 1");
    expect(entries[0].textContent).toContain("About 1");
    // A short page is the last one.
    expect(el.querySelector("[data-load-more]")).toBeNull();
  });

  it("opens on the player's own scenarios, signed in, hiding drafts", async () => {
    api.listMyScenarios.mockResolvedValue([
      { ...published(3), latestVersion: 2 },
      { ...published(4), latestVersion: null },
    ]);
    const el = await panel(true);
    await click(el, "[data-scenarios-toggle]");

    const entries = el.querySelectorAll("[data-scenario-id]");
    expect(entries).toHaveLength(1);
    expect(entries[0].textContent).toContain("Scenario 3");
    expect(api.listPublishedScenarios).not.toHaveBeenCalled();
  });

  it("loads more shared scenarios a page at a time", async () => {
    const page1 = Array.from({ length: 20 }, (_, i) => published(i));
    // One published since: the last of page 1 comes again on page 2.
    const page2 = [published(19), published(20)];
    api.listPublishedScenarios
      .mockResolvedValueOnce(page1)
      .mockResolvedValueOnce(page2);
    const el = await panel();
    await click(el, "[data-scenarios-toggle]");
    expect(api.listPublishedScenarios).toHaveBeenLastCalledWith(1, 20);

    await click(el, "[data-load-more]");

    expect(api.listPublishedScenarios).toHaveBeenLastCalledWith(2, 20);
    expect(el.querySelectorAll("[data-scenario-id]")).toHaveLength(21);
    expect(el.querySelector("[data-load-more]")).toBeNull();
  });

  it("loads the next shared page only on load more", async () => {
    const page1 = Array.from({ length: 20 }, (_, i) => published(i));
    api.listPublishedScenarios.mockResolvedValue(page1);
    const el = await panel(true);
    await click(el, "[data-scenarios-toggle]");
    await click(el, '[data-scenario-tab="shared"]');
    expect(api.listPublishedScenarios).toHaveBeenCalledTimes(1);

    await click(el, '[data-scenario-tab="mine"]');
    await click(el, '[data-scenario-tab="shared"]');
    await click(el, "[data-scenarios-toggle]");
    await click(el, "[data-scenarios-toggle]");
    await click(el, '[data-scenario-tab="shared"]');

    expect(api.listPublishedScenarios).toHaveBeenCalledTimes(1);
    expect(el.querySelectorAll("[data-scenario-id]")).toHaveLength(20);
    expect(el.querySelector("[data-load-more]")).not.toBeNull();
  });

  it("retries the player's own list after it fails", async () => {
    api.listMyScenarios
      .mockResolvedValueOnce("request_failed")
      .mockResolvedValueOnce([{ ...published(3), latestVersion: 1 }]);
    const el = await panel(true);
    await click(el, "[data-scenarios-toggle]");
    expect(el.querySelector("[data-scenario-error]")?.textContent).toContain(
      "scenario_picker.error.request_failed",
    );

    await click(el, "[data-retry-mine]");

    expect(el.querySelectorAll("[data-scenario-id]")).toHaveLength(1);
    expect(el.querySelector("[data-scenario-error]")).toBeNull();
  });

  it("offers no retry when the player's session has ended", async () => {
    api.listMyScenarios.mockResolvedValueOnce("unauthorized");
    const el = await panel(true);
    await click(el, "[data-scenarios-toggle]");
    expect(el.querySelector("[data-scenario-error]")).not.toBeNull();
    expect(el.querySelector("[data-retry-mine]")).toBeNull();
  });

  it("says why the list failed, and retries", async () => {
    api.listPublishedScenarios.mockResolvedValueOnce("request_failed");
    const el = await panel();
    await click(el, "[data-scenarios-toggle]");
    expect(el.querySelector("[data-scenario-error]")?.textContent).toContain(
      "scenario_picker.error.request_failed",
    );

    await click(el, "[data-load-more]");
    expect(el.querySelectorAll("[data-scenario-id]")).toHaveLength(2);
    expect(el.querySelector("[data-scenario-error]")).toBeNull();
  });

  it("shows a placeholder for a thumbnail that doesn't load", async () => {
    const el = await panel();
    await click(el, "[data-scenarios-toggle]");
    const [first] = el.querySelectorAll("[data-scenario-id] img");
    expect(first.getAttribute("src")).toContain(
      `/scenarios/${published(1).id}/versions/1/thumbnail`,
    );

    first.dispatchEvent(new Event("error"));
    await el.updateComplete;

    expect(el.querySelectorAll("[data-thumbnail-placeholder]")).toHaveLength(1);
    expect(el.querySelectorAll("[data-scenario-id] img")).toHaveLength(1);
  });

  it("downloads a pick, then plays the chosen nation", async () => {
    const bundle = { header: {} };
    let finish!: (v: unknown) => void;
    picker.downloadPlayableScenario.mockReturnValue(
      new Promise((r) => (finish = r)),
    );
    const el = await panel();
    const plays: unknown[] = [];
    el.addEventListener("play-scenario", (e) =>
      plays.push((e as CustomEvent).detail),
    );
    await click(el, "[data-scenarios-toggle]");
    await click(el, `[data-scenario-id="${published(2).id}"]`);

    expect(picker.downloadPlayableScenario).toHaveBeenCalledWith(
      published(2).id,
    );
    expect(el.querySelector("[data-selected-scenario]")?.textContent).toContain(
      "scenario_picker.downloading",
    );

    finish({
      id: published(2).id,
      version: 1,
      bundle,
      nations: [
        { id: "fr", name: "France", flag: "fr", playable: true },
        { id: "it", name: "Italy", flag: null, playable: true },
      ],
    });
    await flush();
    await el.updateComplete;

    const play = el.querySelector<HTMLButtonElement>("[data-play-scenario]")!;
    expect(play.disabled).toBe(true);
    await click(el, '[data-nation-id="it"]');
    expect(play.disabled).toBe(false);
    await click(el, "[data-play-scenario]");

    expect(plays).toEqual([{ bundle, nationID: "it" }]);
  });

  it("says why a pick can't be played", async () => {
    picker.downloadPlayableScenario.mockResolvedValue("hash");
    const el = await panel();
    await click(el, "[data-scenarios-toggle]");
    await click(el, `[data-scenario-id="${published(1).id}"]`);

    expect(el.querySelector("[data-scenario-error]")?.textContent).toContain(
      "scenario_picker.error.hash",
    );
    expect(el.querySelector("[data-play-scenario]")).toBeNull();

    await click(el, "[data-scenario-back]");
    expect(el.querySelectorAll("[data-scenario-id]")).toHaveLength(2);
  });
});
