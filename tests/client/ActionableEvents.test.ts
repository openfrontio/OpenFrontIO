import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AllianceRequestUpdate,
  GameUpdateType,
} from "@openfront/engine-api/game/GameUpdates";
import { EventBus } from "@openfront/shared/EventBus";
// Side-effect import: the @customElement decorator registers <actionable-events>.
import "../../src/client/hud/layers/ActionableEvents";
import type { ActionableEvents } from "../../src/client/hud/layers/ActionableEvents";
import { PlaySoundEffectEvent } from "../../src/client/sound/Sounds";
import { GoToPlayerEvent } from "../../src/client/TransformHandler";
import {
  SendAllianceExtensionIntentEvent,
  SendAllianceRejectIntentEvent,
  SendAllianceRequestIntentEvent,
} from "../../src/client/Transport";
import type { GameView } from "../../src/client/view";

const ME = 1;
const ANNA = 2;
const BORIS = 3;

// My alliances, as the renewal prompt reads them.
let myAlliances: { id: number; other: number; expiresAt: number }[] = [];

function player(smallID: number, name: string) {
  return {
    id: () => smallID,
    smallID: () => smallID,
    displayName: () => name,
    isAlive: () => true,
    isAlliedWith: () => false,
    isRequestingAllianceWith: () => true,
    alliances: () => (smallID === ME ? myAlliances : []),
  };
}

const players = new Map([
  [ME, player(ME, "Me")],
  [ANNA, player(ANNA, "Anna")],
  [BORIS, player(BORIS, "Boris")],
]);

describe("actionable-events", () => {
  let display: ActionableEvents;
  let langSelector: HTMLElement;
  let events: unknown[];
  let ticks: number;
  let updates: Partial<Record<GameUpdateType, unknown[]>>;

  // Runs one game tick carrying the given updates.
  async function tick(next: Partial<Record<GameUpdateType, unknown[]>> = {}) {
    ticks++;
    updates = next;
    display.tick();
    await display.updateComplete;
  }

  // Moves the game n ticks on; the HUD sees the last of them.
  async function advance(n: number) {
    ticks += n - 1;
    await tick();
  }

  // Made by the game on the tick it last ran, one behind the view's clock,
  // unless it arrives late.
  const requestFrom = (
    requestorID: number,
    createdAt = ticks,
  ): AllianceRequestUpdate => ({
    type: GameUpdateType.AllianceRequest,
    requestorID,
    recipientID: ME,
    createdAt,
  });

  const cards = () => [
    ...display.querySelectorAll<HTMLElement>("[data-event-card]"),
  ];
  const cardOf = (name: string) =>
    cards().find((card) => card.textContent?.includes(`${name} asks`));
  const actions = (card: HTMLElement) => [
    ...card.querySelectorAll<HTMLButtonElement>("[data-card-action]"),
  ];
  const button = (card: HTMLElement, action: string) =>
    card.querySelector<HTMLButtonElement>(`[data-card-action="${action}"]`)!;
  const seconds = (card: HTMLElement) =>
    card.querySelector<HTMLElement>("[data-card-seconds]")!;
  const line = (card: HTMLElement) =>
    card.querySelector<HTMLElement>("[data-time-left]")!;
  const timeLeft = (card: HTMLElement) => ({
    seconds: seconds(card).textContent,
    line: Number(line(card).dataset.timeLeft),
  });
  const sounds = () =>
    events
      .filter((e) => e instanceof PlaySoundEffectEvent)
      .map((e) => e.effect);
  const intents = () =>
    events.filter((e) => !(e instanceof PlaySoundEffectEvent));

  beforeEach(() => {
    document.body.innerHTML = "";
    langSelector = document.createElement("lang-selector");
    (langSelector as any).translations = {
      "events_display.request_alliance": "{name} asks for an alliance",
      "events_display.about_to_expire": "Your alliance with {name} ends soon",
      "common.duration_second_short": "s",
    };
    document.body.appendChild(langSelector);

    ticks = 0;
    updates = {};
    events = [];
    myAlliances = [];
    const eventBus = new EventBus();
    const record = (e: unknown) => events.push(e);
    eventBus.on(GoToPlayerEvent, record);
    eventBus.on(SendAllianceRequestIntentEvent, record);
    eventBus.on(SendAllianceRejectIntentEvent, record);
    eventBus.on(SendAllianceExtensionIntentEvent, record);
    eventBus.on(PlaySoundEffectEvent, record);

    display = document.createElement("actionable-events") as ActionableEvents;
    display.eventBus = eventBus;
    display.game = {
      inSpawnPhase: () => false,
      ticks: () => ticks,
      myPlayer: () => players.get(ME),
      player: (id: number) => players.get(id),
      playerBySmallID: (id: number) => players.get(id),
      config: () => ({
        allianceRequestDuration: () => 200,
        allianceExtensionPromptOffset: () => 300,
      }),
      updatesSinceLastTick: () => updates,
    } as unknown as GameView;
    document.body.appendChild(display);
  });

  afterEach(() => {
    display.remove();
    langSelector.remove();
  });

  it("keeps an open card's element when a newer card arrives above it", async () => {
    await tick({ [GameUpdateType.AllianceRequest]: [requestFrom(ANNA)] });
    const anna = cardOf("Anna");
    expect(anna).toBeDefined();

    await tick({ [GameUpdateType.AllianceRequest]: [requestFrom(BORIS)] });

    // The newest card goes on top, so Anna's card moves down a place.
    expect(cards()).toHaveLength(2);
    expect(cards()[0]).toBe(cardOf("Boris"));
    expect(cards()[1]).toBe(anna);
  });

  it("keeps an open card's element when the card above it leaves", async () => {
    await tick({ [GameUpdateType.AllianceRequest]: [requestFrom(ANNA)] });
    await tick({ [GameUpdateType.AllianceRequest]: [requestFrom(BORIS)] });
    const anna = cardOf("Anna");

    button(cardOf("Boris")!, "reject").click();
    await display.updateComplete;

    expect(cards()).toHaveLength(1);
    expect(cards()[0]).toBe(anna);
  });

  it("keeps a card's buttons on its own player as cards come and go", async () => {
    await tick({ [GameUpdateType.AllianceRequest]: [requestFrom(ANNA)] });
    await tick({ [GameUpdateType.AllianceRequest]: [requestFrom(BORIS)] });
    const anna = cardOf("Anna")!;

    button(anna, "focus").click();
    button(anna, "accept").click();
    await display.updateComplete;

    const [focus, accept] = intents() as [
      GoToPlayerEvent,
      SendAllianceRequestIntentEvent,
    ];
    expect(focus).toBeInstanceOf(GoToPlayerEvent);
    expect(focus.player).toBe(players.get(ANNA));
    expect(accept).toBeInstanceOf(SendAllianceRequestIntentEvent);
    expect(accept.recipient).toBe(players.get(ANNA));
    expect(cards()).toHaveLength(1);
    expect(cardOf("Anna")).toBeUndefined();
  });

  it("shows a request as a named group with Focus, Accept and Reject in that order", async () => {
    await tick({ [GameUpdateType.AllianceRequest]: [requestFrom(ANNA)] });
    const anna = cardOf("Anna")!;

    expect(anna.dataset.cardKind).toBe("request");
    expect(anna.getAttribute("role")).toBe("group");
    expect(anna.getAttribute("aria-label")).toBe("Anna asks for an alliance");
    expect(actions(anna).map((b) => b.dataset.cardAction)).toEqual([
      "focus",
      "accept",
      "reject",
    ]);
    expect(actions(anna).map((b) => b.textContent?.trim())).toEqual([
      "events_display.focus",
      "events_display.accept_alliance",
      "events_display.reject_alliance",
    ]);
  });

  it("plays the request sound when a request arrives", async () => {
    await tick({ [GameUpdateType.AllianceRequest]: [requestFrom(ANNA)] });

    expect(sounds()).toEqual(["alliance-suggested"]);
  });

  it("focuses the requestor from the title and from Focus, and keeps the card", async () => {
    await tick({ [GameUpdateType.AllianceRequest]: [requestFrom(ANNA)] });
    const anna = cardOf("Anna")!;
    const title = [...anna.querySelectorAll("button")].find(
      (b) => !b.dataset.cardAction,
    )!;

    title.click();
    button(anna, "focus").click();
    await display.updateComplete;

    expect(intents()).toHaveLength(2);
    for (const e of intents()) {
      expect(e).toBeInstanceOf(GoToPlayerEvent);
      expect((e as GoToPlayerEvent).player).toBe(players.get(ANNA));
    }
    expect(cardOf("Anna")).toBe(anna);
  });

  it("accepts with its sound and closes the card", async () => {
    await tick({ [GameUpdateType.AllianceRequest]: [requestFrom(ANNA)] });
    events = [];

    button(cardOf("Anna")!, "accept").click();
    await display.updateComplete;

    expect(sounds()).toEqual(["alliance-accepted"]);
    expect(intents()).toHaveLength(1);
    expect(intents()[0]).toBeInstanceOf(SendAllianceRequestIntentEvent);
    expect(cards()).toHaveLength(0);
  });

  it("rejects with its sound and closes the card", async () => {
    await tick({ [GameUpdateType.AllianceRequest]: [requestFrom(ANNA)] });
    events = [];

    button(cardOf("Anna")!, "reject").click();
    await display.updateComplete;

    expect(sounds()).toEqual(["alliance-declined"]);
    expect(intents()).toHaveLength(1);
    expect(intents()[0]).toBeInstanceOf(SendAllianceRejectIntentEvent);
    expect((intents()[0] as SendAllianceRejectIntentEvent).requestor).toBe(
      players.get(ANNA),
    );
    expect(cards()).toHaveLength(0);
  });

  it("counts a request's 20 seconds down with the game and closes it at 0", async () => {
    await tick({ [GameUpdateType.AllianceRequest]: [requestFrom(ANNA)] });
    const anna = cardOf("Anna")!;
    expect(timeLeft(anna)).toEqual({ seconds: "20s", line: 1 });

    await advance(100);
    expect(timeLeft(anna)).toEqual({ seconds: "10s", line: 0.5 });

    await advance(99);
    expect(timeLeft(anna)).toEqual({ seconds: "1s", line: 0.005 });

    await advance(1);
    expect(cards()).toHaveLength(0);
  });

  it("counts from when the engine made a request that arrives late", async () => {
    ticks = 100;
    await tick({
      [GameUpdateType.AllianceRequest]: [requestFrom(ANNA, ticks - 30)],
    });
    const anna = cardOf("Anna")!;
    expect(timeLeft(anna)).toEqual({ seconds: "17s", line: 0.85 });

    await advance(169);
    expect(timeLeft(anna)).toEqual({ seconds: "1s", line: 0.005 });

    await advance(1);
    expect(cards()).toHaveLength(0);
  });

  it("holds the time left while the game does not tick", async () => {
    await tick({ [GameUpdateType.AllianceRequest]: [requestFrom(ANNA)] });
    await advance(50);
    const anna = cardOf("Anna")!;

    // Paused: the HUD keeps drawing, the game's tick count stays.
    for (let i = 0; i < 3; i++) {
      display.requestUpdate();
      await display.updateComplete;
    }

    expect(timeLeft(anna)).toEqual({ seconds: "15s", line: 0.75 });
  });

  it("keeps the seconds and the line away from screen readers", async () => {
    await tick({ [GameUpdateType.AllianceRequest]: [requestFrom(ANNA)] });
    const anna = cardOf("Anna")!;

    expect(seconds(anna).getAttribute("aria-hidden")).toBe("true");
    expect(line(anna).getAttribute("aria-hidden")).toBe("true");
  });

  describe("renewal card", () => {
    async function renewalWith(other: number) {
      // Late in the game: the prompt skips alliances checked within the
      // last prompt window, and an unchecked one counts as checked at 0.
      ticks = 1000;
      myAlliances = [{ id: 7, other, expiresAt: ticks + 250 }];
      await tick();
      return cards().find((card) => card.dataset.cardKind === "renewal")!;
    }

    it("shows Focus, Renew and Ignore in that order", async () => {
      const card = await renewalWith(BORIS);

      expect(card.getAttribute("role")).toBe("group");
      expect(card.getAttribute("aria-label")).toBe(
        "Your alliance with Boris ends soon",
      );
      expect(actions(card).map((b) => b.dataset.cardAction)).toEqual([
        "focus",
        "renew",
        "ignore",
      ]);
    });

    it("counts down to the end of the alliance", async () => {
      const card = await renewalWith(BORIS);

      // The alliance ends at 1250 and the prompt opened at 1001.
      expect(timeLeft(card)).toEqual({ seconds: "25s", line: 249 / 300 });

      await advance(150);
      expect(timeLeft(card)).toEqual({ seconds: "10s", line: 99 / 300 });
    });

    it("renews and closes", async () => {
      const card = await renewalWith(BORIS);

      button(card, "renew").click();
      await display.updateComplete;

      expect(intents()).toHaveLength(1);
      expect(intents()[0]).toBeInstanceOf(SendAllianceExtensionIntentEvent);
      expect((intents()[0] as SendAllianceExtensionIntentEvent).recipient).toBe(
        players.get(BORIS),
      );
      expect(cards()).toHaveLength(0);
    });

    it("ignores without sending anything and closes", async () => {
      const card = await renewalWith(BORIS);

      button(card, "ignore").click();
      await display.updateComplete;

      expect(events).toEqual([]);
      expect(cards()).toHaveLength(0);
    });

    it("focuses the ally and keeps the card", async () => {
      const card = await renewalWith(BORIS);

      button(card, "focus").click();
      await display.updateComplete;

      expect(intents()).toHaveLength(1);
      expect((intents()[0] as GoToPlayerEvent).player).toBe(players.get(BORIS));
      expect(cards()).toEqual([card]);
    });
  });
});
