import { EventBus } from "@openfront/shared/EventBus";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../resources/lang/en.json";
import { ChatModal } from "../../src/client/hud/layers/ChatModal";
import { SendQuickChatEvent } from "../../src/client/Transport";
import type { PlayerView } from "../../src/client/view";
import { makeGameView, makePlayerView } from "../util/viewStubs";

// Real English text, so short labels and full phrases can be told apart.
function lookup(key: string): string {
  let node: unknown = en;
  for (const part of key.split(".")) {
    node = (node as Record<string, unknown> | undefined)?.[part];
  }
  return typeof node === "string" ? node : key;
}

// Whether the player's language has its own short chip labels.
let ownShortLabels = true;

vi.mock("../../src/client/Utils", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/client/Utils")>();
  return {
    ...actual,
    translateText: (key: string) => lookup(key),
    hasOwnTranslation: (key: string) =>
      (ownShortLabels || !key.startsWith("chat.short.")) && lookup(key) !== key,
  };
});

describe("ChatModal", () => {
  let modal: ChatModal;
  let sent: SendQuickChatEvent[];
  let me: PlayerView;
  let bob: PlayerView;
  let players: PlayerView[];

  const player = (
    displayName: string,
    smallID: number,
    tilesOwned: number,
    attacks: { attackerID: number; targetID: number }[] = [],
  ) =>
    makePlayerView({
      data: {
        displayName,
        id: displayName.toLowerCase(),
        smallID,
        tilesOwned,
        outgoingAttacks: attacks.map((a) => ({
          ...a,
          troops: 1,
          id: `${a.attackerID}-${a.targetID}`,
          retreating: false,
        })),
      },
    });

  const chip = (text: string) =>
    Array.from(modal.querySelectorAll("section button")).find(
      (b) => b.textContent?.trim() === text,
    ) as HTMLButtonElement;

  const pickerNames = () =>
    Array.from(modal.querySelectorAll(".grid button"), (b) =>
      b.textContent?.trim(),
    );

  beforeEach(async () => {
    ownShortLabels = true;
    me = player("Me", 1, 100);
    bob = player("Bob", 2, 300);
    players = [
      me,
      bob,
      player("Small", 3, 50),
      player("Huge", 4, 5000),
      player("Rival", 5, 200),
    ];
    // I'm attacking Rival, so Rival is the likeliest subject.
    me = player("Me", 1, 100, [{ attackerID: 1, targetID: 5 }]);
    players[0] = me;

    modal = new ChatModal();
    modal.g = makeGameView();
    vi.spyOn(modal.g, "players").mockReturnValue(players);
    const eventBus = new EventBus();
    sent = [];
    eventBus.on(SendQuickChatEvent, (e) => sent.push(e));
    modal.initEventBus(eventBus);
    document.body.append(modal);
    modal.open(me, bob);
    await modal.updateComplete;
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  const allPhrasesSwitch = () =>
    modal.querySelector('button[role="switch"]') as HTMLButtonElement;

  it("shows the core phrases of every category at once", () => {
    const headings = Array.from(modal.querySelectorAll("section h3"), (h) =>
      h.textContent?.trim(),
    );
    expect(headings).toEqual([
      "Help",
      "Attack",
      "Defend",
      "Greetings",
      "Miscellaneous",
      "Warnings",
    ]);
    expect(chip("GG!")).toBeDefined();
    expect(chip("Thanks!")).toBeDefined();
    expect(chip("Bye!")).toBeUndefined();
  });

  it("switches between the core phrases and all of them, remembering the choice", async () => {
    allPhrasesSwitch().click();
    await modal.updateComplete;
    expect(allPhrasesSwitch().getAttribute("aria-checked")).toBe("true");
    expect(chip("Bye!")).toBeDefined();
    expect(chip("GG!")).toBeDefined();

    modal.close();
    modal.open(me, bob);
    await modal.updateComplete;
    expect(chip("Bye!")).toBeDefined();

    allPhrasesSwitch().click();
    await modal.updateComplete;
    expect(chip("Bye!")).toBeUndefined();
  });

  it("keeps core phrases first in each category with all phrases on", async () => {
    allPhrasesSwitch().click();
    await modal.updateComplete;
    const greetings = Array.from(modal.querySelectorAll("section"))
      .find(
        (sec) => sec.querySelector("h3")?.textContent?.trim() === "Greetings",
      )!
      .querySelectorAll("button");
    expect(
      Array.from(greetings)
        .slice(0, 4)
        .map((b) => b.title),
    ).toEqual(["Hello!", "Good luck!", "GG!", "Thanks!"]);
  });

  it("sends a phrase without a player in one click", async () => {
    chip("GG!").click();
    await modal.updateComplete;

    expect(sent).toHaveLength(1);
    expect(sent[0].recipient).toBe(bob);
    expect(sent[0].quickChatKey).toBe("greet.gg");
    expect(sent[0].target).toBeUndefined();
    expect(modal.isOpen).toBe(false);
  });

  it("shows some phrases under another category, sending their own key", async () => {
    const section = (heading: string) =>
      Array.from(modal.querySelectorAll("section")).find(
        (sec) => sec.querySelector("h3")?.textContent?.trim() === heading,
      )!;
    const titles = (heading: string) =>
      Array.from(section(heading).querySelectorAll("button"), (b) => b.title);

    expect(titles("Miscellaneous")).toEqual([
      "Let’s go!",
      "Oops, wrong button!",
    ]);
    expect(titles("Attack")).toEqual([
      "Attack ___!",
      "Launch a MIRV at ___!",
      "Attack the crown!",
      "Let’s team up against ___!",
    ]);
    expect(titles("Greetings")).not.toContain("Oops, wrong button!");

    chip("Oops, wrong button!").click();
    expect(sent[0].quickChatKey).toBe("greet.oops");
  });

  it("shows long phrases by their short label, with the full phrase on hover", async () => {
    allPhrasesSwitch().click();
    await modal.updateComplete;
    const button = chip("Peace? Stalemate.");
    expect(button.title).toBe(
      "Let's make peace. This is a stalemate, we will both lose.",
    );
  });

  it("shows the full phrase when the player's language lacks the short label", async () => {
    ownShortLabels = false;
    allPhrasesSwitch().click();
    await modal.updateComplete;
    expect(chip("Peace? Stalemate.")).toBeUndefined();
    expect(
      chip("Let's make peace. This is a stalemate, we will both lose."),
    ).toBeDefined();
  });

  it("asks for the player a phrase names, then sends with that player", async () => {
    const attack = Array.from(modal.querySelectorAll("section button")).find(
      (b) => b.getAttribute("title") === "Attack ___!",
    ) as HTMLButtonElement;
    attack.click();
    await modal.updateComplete;
    expect(sent).toHaveLength(0);

    // Players fighting me or Bob first, then by size.
    expect(pickerNames()).toEqual(["Rival", "Huge", "Bob", "Me", "Small"]);

    (modal.querySelectorAll(".grid button")[1] as HTMLButtonElement).click();
    expect(sent).toHaveLength(1);
    expect(sent[0].quickChatKey).toBe("attack.attack");
    expect(sent[0].target).toBe("huge");
    expect(modal.isOpen).toBe(false);
  });

  it("filters the players by search and sends the top match on Enter", async () => {
    modal.openWithSelection("attack", "focus", me, bob);
    await modal.updateComplete;

    const input = modal.querySelector("input")!;
    expect(document.activeElement).toBe(input);
    input.value = "sm";
    input.dispatchEvent(new Event("input"));
    await modal.updateComplete;
    expect(pickerNames()).toEqual(["Small"]);

    modal
      .querySelector("input")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(sent).toHaveLength(1);
    expect(sent[0].quickChatKey).toBe("attack.focus");
    expect(sent[0].target).toBe("small");
  });

  it("ignores Enter that confirms an IME composition", async () => {
    modal.openWithSelection("attack", "focus", me, bob);
    await modal.updateComplete;

    modal
      .querySelector("input")!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", isComposing: true }),
      );
    expect(sent).toHaveLength(0);
    expect(modal.isOpen).toBe(true);
  });

  it("goes back from the player picker to the phrases", async () => {
    modal.openWithSelection("attack", "focus", me, bob);
    await modal.updateComplete;

    (
      modal.querySelector('button[aria-label="Back"]') as HTMLButtonElement
    ).click();
    await modal.updateComplete;

    expect(chip("GG!")).toBeDefined();
    expect(sent).toHaveLength(0);
  });
});
