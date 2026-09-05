import { afterEach, expect, it, vi } from "vitest";
import { ChatModal } from "../../src/client/hud/layers/ChatModal";
import { makeGameView, makePlayerView } from "../util/viewStubs";

vi.mock("../../src/client/Utils", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/client/Utils")>();
  return { ...actual, translateText: (key: string) => key };
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

it("orders chat players by territory and preserves that order within search results", async () => {
  const players = [
    { displayName: "Alpha", tilesOwned: 400 },
    { displayName: "Zulu", tilesOwned: 1200 },
    { displayName: "Bravo", tilesOwned: 600 },
    { displayName: "Zebra", tilesOwned: 1200 },
  ].map((data) => makePlayerView({ data }));
  const modal = new ChatModal();
  modal.g = makeGameView();
  vi.spyOn(modal.g, "players").mockReturnValue(players);
  document.body.append(modal);
  modal.openWithSelection("attack", "attack", players[0], players[1]);
  await modal.updateComplete;

  const names = () =>
    Array.from(modal.querySelectorAll(".player-scroll-area button"), (button) =>
      button.textContent?.trim(),
    );
  expect(names()).toEqual(["Zulu", "Zebra", "Bravo", "Alpha"]);

  const search = modal.querySelector<HTMLInputElement>(".player-search-input")!;
  search.value = "A";
  search.dispatchEvent(new Event("input", { bubbles: true }));
  await modal.updateComplete;
  expect(names()).toEqual(["Zebra", "Bravo", "Alpha", "Zulu"]);

  search.value = "";
  search.dispatchEvent(new Event("input", { bubbles: true }));
  await modal.updateComplete;
  expect(names()).toEqual(["Zulu", "Zebra", "Bravo", "Alpha"]);
});
