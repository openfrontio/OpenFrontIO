import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AllianceRequestUpdate,
  GameUpdateType,
} from "@openfront/engine-api/game/GameUpdates";
import { EventBus } from "@openfront/shared/EventBus";
// Side-effect import: the @customElement decorator registers <actionable-events>.
import "../../src/client/hud/layers/ActionableEvents";
import type { ActionableEvents } from "../../src/client/hud/layers/ActionableEvents";
import { GoToPlayerEvent } from "../../src/client/TransformHandler";
import {
  SendAllianceRejectIntentEvent,
  SendAllianceRequestIntentEvent,
} from "../../src/client/Transport";
import type { GameView } from "../../src/client/view";

const ME = 1;
const ANNA = 2;
const BORIS = 3;

function player(smallID: number, name: string) {
  return {
    smallID: () => smallID,
    displayName: () => name,
    isAlive: () => true,
    isAlliedWith: () => false,
    isRequestingAllianceWith: () => true,
    alliances: () => [],
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

  const requestFrom = (requestorID: number): AllianceRequestUpdate => ({
    type: GameUpdateType.AllianceRequest,
    requestorID,
    recipientID: ME,
    createdAt: ticks,
  });

  const cards = () => [
    ...display.querySelectorAll<HTMLElement>("[data-event-card]"),
  ];
  const cardOf = (name: string) =>
    cards().find((card) => card.textContent?.includes(`${name} asks`));
  const button = (card: HTMLElement, key: string) =>
    [...card.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === key,
    ) as HTMLButtonElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    langSelector = document.createElement("lang-selector");
    (langSelector as any).translations = {
      "events_display.request_alliance": "{name} asks for an alliance",
    };
    document.body.appendChild(langSelector);

    ticks = 0;
    updates = {};
    events = [];
    const eventBus = new EventBus();
    const record = (e: unknown) => events.push(e);
    eventBus.on(GoToPlayerEvent, record);
    eventBus.on(SendAllianceRequestIntentEvent, record);
    eventBus.on(SendAllianceRejectIntentEvent, record);

    display = document.createElement("actionable-events") as ActionableEvents;
    display.eventBus = eventBus;
    display.game = {
      inSpawnPhase: () => false,
      ticks: () => ticks,
      myPlayer: () => players.get(ME),
      player: () => undefined,
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

    button(cardOf("Boris")!, "events_display.reject_alliance").click();
    await display.updateComplete;

    expect(cards()).toHaveLength(1);
    expect(cards()[0]).toBe(anna);
  });

  it("keeps a card's buttons on its own player as cards come and go", async () => {
    await tick({ [GameUpdateType.AllianceRequest]: [requestFrom(ANNA)] });
    await tick({ [GameUpdateType.AllianceRequest]: [requestFrom(BORIS)] });
    const anna = cardOf("Anna")!;

    button(anna, "events_display.focus").click();
    button(anna, "events_display.accept_alliance").click();
    await display.updateComplete;

    const [focus, accept] = events as [
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
});
