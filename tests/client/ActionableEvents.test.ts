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
  let replay: boolean;
  let catchingUp: boolean;

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
  // An answered card's fold ends (it runs on the card's outer wrapper).
  const endFold = (card: HTMLElement, animationName = "card-fold") => {
    const e = new Event("animationend", { bubbles: true });
    Object.defineProperty(e, "animationName", { value: animationName });
    card.parentElement!.parentElement!.dispatchEvent(e);
  };
  const icons = (card: HTMLElement) =>
    [...card.querySelectorAll("of-icon")].map((icon) =>
      icon.getAttribute("name"),
    );
  const tint = (card: HTMLElement) => card.querySelector("[data-tint]");
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
      "events_display.time_to_answer":
        "{seconds, plural, one {# second} other {# seconds}} to answer",
    };
    document.body.appendChild(langSelector);

    ticks = 0;
    updates = {};
    events = [];
    myAlliances = [];
    replay = false;
    catchingUp = false;
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
      isCatchingUp: () => catchingUp,
      myPlayer: () => players.get(ME),
      player: (id: number) => players.get(id),
      playerBySmallID: (id: number) => players.get(id),
      config: () => ({
        isReplay: () => replay,
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

    const boris = cardOf("Boris")!;
    button(boris, "reject").click();
    await display.updateComplete;
    endFold(boris);
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
    endFold(anna);
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

  it("marks a request with the handshake and leaves it untinted", async () => {
    await tick({ [GameUpdateType.AllianceRequest]: [requestFrom(ANNA)] });
    const anna = cardOf("Anna")!;

    expect(icons(anna)).toContain("alliance");
    expect(icons(anna)).not.toContain("hourglass");
    expect(tint(anna)).toBeNull();
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

  it("accepts with its sound and shows the answer", async () => {
    await tick({ [GameUpdateType.AllianceRequest]: [requestFrom(ANNA)] });
    events = [];

    button(cardOf("Anna")!, "accept").click();
    await display.updateComplete;

    expect(sounds()).toEqual(["alliance-accepted"]);
    expect(intents()).toHaveLength(1);
    expect(intents()[0]).toBeInstanceOf(SendAllianceRequestIntentEvent);
    expect(cardOf("Anna")!.dataset.answered).toBe("accept");
  });

  it("rejects with its sound and shows the answer", async () => {
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
    expect(cardOf("Anna")!.dataset.answered).toBe("reject");
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

  describe("keys", () => {
    // What a browser does with a key on a focused button: Enter presses it on
    // keydown, Space on keyup, unless the page cancelled that event.
    function pressKey(target: HTMLElement, key: "Enter" | " ") {
      for (const type of ["keydown", "keyup"] as const) {
        const event = new KeyboardEvent(type, {
          key,
          code: key === " " ? "Space" : "Enter",
          bubbles: true,
          cancelable: true,
        });
        target.dispatchEvent(event);
        const presses = key === "Enter" ? type === "keydown" : type === "keyup";
        if (presses && !event.defaultPrevented) target.click();
      }
    }

    let onWindow: string[];
    const listen = (e: KeyboardEvent) => onWindow.push(`${e.type} ${e.code}`);
    beforeEach(() => {
      onWindow = [];
      window.addEventListener("keydown", listen);
      window.addEventListener("keyup", listen);
    });
    afterEach(() => {
      window.removeEventListener("keydown", listen);
      window.removeEventListener("keyup", listen);
    });

    it.each([
      { name: "Space", key: " " },
      { name: "Enter", key: "Enter" },
    ] as const)(
      "keeps $name on Accept from the game, and accepts",
      async ({ key }) => {
        await tick({ [GameUpdateType.AllianceRequest]: [requestFrom(ANNA)] });
        const accept = button(cardOf("Anna")!, "accept");
        accept.focus();

        pressKey(accept, key);
        await display.updateComplete;

        expect(onWindow).toEqual([]);
        expect(intents()).toHaveLength(1);
        expect(intents()[0]).toBeInstanceOf(SendAllianceRequestIntentEvent);
        expect(cardOf("Anna")!.dataset.answered).toBe("accept");
      },
    );

    it("lets the game have the release of a Space held elsewhere", async () => {
      await tick({ [GameUpdateType.AllianceRequest]: [requestFrom(ANNA)] });
      const focus = button(cardOf("Anna")!, "focus");

      // The alternate view is held from the map; then a card gets focus.
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", {
          code: "Space",
          key: " ",
          bubbles: true,
        }),
      );
      focus.focus();
      focus.dispatchEvent(
        new KeyboardEvent("keyup", { code: "Space", key: " ", bubbles: true }),
      );

      expect(onWindow).toEqual(["keydown Space", "keyup Space"]);
    });

    it("leaves no focus on a card's buttons pressed with the mouse", async () => {
      await tick({ [GameUpdateType.AllianceRequest]: [requestFrom(ANNA)] });
      const anna = cardOf("Anna")!;
      const title = [...anna.querySelectorAll("button")].find(
        (b) => !b.dataset.cardAction,
      )!;
      button(anna, "accept").focus();

      // Focus left on Accept would make the next Space accept the card.
      for (const target of [title, button(anna, "reject")]) {
        const mousedown = new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
        });
        target.dispatchEvent(mousedown);
        expect(mousedown.defaultPrevented).toBe(true);
      }
      expect(anna.contains(document.activeElement)).toBe(false);
    });
  });

  describe("screen readers", () => {
    const region = () =>
      display.querySelector<HTMLElement>('[aria-live="assertive"]')!;
    const said = () =>
      [...region().querySelectorAll("p")].map((p) => p.textContent);

    it("keeps the region while no card is open", async () => {
      await tick();

      expect(region()).not.toBeNull();
      expect(said()).toEqual([]);
      expect(cards()).toHaveLength(0);
    });

    it("reads a new request out once, with the time to answer", async () => {
      await tick({ [GameUpdateType.AllianceRequest]: [requestFrom(ANNA)] });
      expect(said()).toEqual([
        "Anna asks for an alliance 20 seconds to answer",
      ]);

      // The card redraws every tick for its seconds; the region must not.
      const changes: MutationRecord[] = [];
      new MutationObserver((records) => changes.push(...records)).observe(
        region(),
        { childList: true, characterData: true, subtree: true },
      );
      await advance(10);
      await tick({ [GameUpdateType.AllianceRequest]: [requestFrom(BORIS)] });

      expect(said()).toEqual([
        "Anna asks for an alliance 20 seconds to answer",
        "Boris asks for an alliance 20 seconds to answer",
      ]);
      // Only Boris's line went in (Lit adds comment markers around it).
      const added = changes.flatMap((r) => [...r.addedNodes]);
      expect(added.filter((n) => n.nodeType !== Node.COMMENT_NODE)).toEqual([
        region().querySelectorAll("p")[1],
      ]);
      expect(changes.every((r) => r.type === "childList")).toBe(true);
      expect(changes.flatMap((r) => [...r.removedNodes])).toEqual([]);
    });

    it("reads a renewal prompt out with the time left in the alliance", async () => {
      ticks = 1000;
      myAlliances = [{ id: 7, other: BORIS, expiresAt: ticks + 250 }];
      await tick();

      expect(said()).toEqual([
        "Your alliance with Boris ends soon 25 seconds to answer",
      ]);
    });

    it("drops the line when the card goes, and says nothing on the answer", async () => {
      await tick({ [GameUpdateType.AllianceRequest]: [requestFrom(ANNA)] });
      const anna = cardOf("Anna")!;

      button(anna, "reject").click();
      await display.updateComplete;
      expect(said()).toEqual([
        "Anna asks for an alliance 20 seconds to answer",
      ]);

      endFold(anna);
      await display.updateComplete;
      expect(said()).toEqual([]);
    });

    it("stays silent in a replay and while the game catches up", async () => {
      replay = true;
      await tick({ [GameUpdateType.AllianceRequest]: [requestFrom(ANNA)] });
      replay = false;
      catchingUp = true;
      await tick({ [GameUpdateType.AllianceRequest]: [requestFrom(BORIS)] });
      catchingUp = false;
      await tick();

      expect(cards()).toHaveLength(2);
      expect(said()).toEqual([]);
    });
  });

  describe("answered card", () => {
    async function answerAnna(action = "accept") {
      await tick({ [GameUpdateType.AllianceRequest]: [requestFrom(ANNA)] });
      const anna = cardOf("Anna")!;
      button(anna, action).click();
      await display.updateComplete;
      events = [];
      return anna;
    }

    it("keeps only the answer, inert, with the line full", async () => {
      const anna = await answerAnna();

      // The others close up rather than vanish, and are out of reach at once.
      expect(actions(anna).filter((b) => !b.hasAttribute("inert"))).toEqual([
        button(anna, "accept"),
      ]);
      expect(actions(anna).every((b) => b.disabled && !b.hidden)).toBe(true);
      expect(line(anna).dataset.timeLeft).toBe("1");

      // The second click of a double click lands on the same card.
      button(anna, "accept").click();
      await display.updateComplete;
      expect(events).toEqual([]);
    });

    it("stays through the reply and its own expiry, and goes when it has folded", async () => {
      const anna = await answerAnna("reject");

      await tick({
        [GameUpdateType.AllianceRequestReply]: [
          {
            type: GameUpdateType.AllianceRequestReply,
            request: requestFrom(ANNA),
            accepted: false,
          },
        ],
      });
      await advance(300);
      expect(cards()).toEqual([anna]);

      endFold(anna);
      await display.updateComplete;
      expect(cards()).toEqual([]);
    });

    it("ignores the end of any other animation on the card", async () => {
      const anna = await answerAnna();

      // The opening the answer cut short, and the card's own rise.
      endFold(anna, "card-open");
      const rise = new Event("animationend", { bubbles: true });
      Object.defineProperty(rise, "animationName", { value: "card-fold" });
      anna.dispatchEvent(rise);
      await display.updateComplete;

      expect(cards()).toEqual([anna]);
    });

    it("keeps the rejected card's other buttons out of reach too", async () => {
      const anna = await answerAnna("reject");

      expect(anna.dataset.answered).toBe("reject");
      expect(actions(anna).filter((b) => !b.hasAttribute("inert"))).toEqual([
        button(anna, "reject"),
      ]);
      expect(line(anna).dataset.timeLeft).toBe("1");
    });

    it("ends on its fold, not on the end of its button's motion", async () => {
      const anna = await answerAnna();

      // The chosen icon's pop and the buttons closing up end first.
      const pop = new Event("animationend", { bubbles: true });
      Object.defineProperty(pop, "animationName", {
        value: "card-answer-pop",
      });
      button(anna, "accept").querySelector("of-icon")!.dispatchEvent(pop);
      button(anna, "reject").dispatchEvent(
        new Event("transitionend", { bubbles: true }),
      );
      await display.updateComplete;
      expect(cards()).toEqual([anna]);

      endFold(anna);
      await display.updateComplete;
      expect(cards()).toEqual([]);
    });

    it("is never answered by Focus", async () => {
      await tick({ [GameUpdateType.AllianceRequest]: [requestFrom(ANNA)] });
      const anna = cardOf("Anna")!;

      button(anna, "focus").click();
      await display.updateComplete;

      expect(anna.dataset.answered).toBeUndefined();
      expect(actions(anna).every((b) => !b.disabled)).toBe(true);
    });

    it("goes at once when the player dies, since it is no longer drawn", async () => {
      await answerAnna();
      await tick({ [GameUpdateType.AllianceRequest]: [requestFrom(BORIS)] });

      const me = players.get(ME)!;
      me.isAlive = () => false;
      try {
        await tick();
        me.isAlive = () => true;
        await tick();
      } finally {
        me.isAlive = () => true;
      }

      // Boris's card was still open: it is back with the player.
      expect(cards()).toEqual([cardOf("Boris")]);
    });
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

    it("stands out from a request with an hourglass and a tint", async () => {
      const card = await renewalWith(BORIS);

      expect(icons(card)).toContain("hourglass");
      expect(icons(card)).not.toContain("alliance");
      expect(tint(card)).not.toBeNull();
    });

    it("counts down to the end of the alliance", async () => {
      const card = await renewalWith(BORIS);

      // The alliance ends at 1250 and the prompt opened at 1001.
      expect(timeLeft(card)).toEqual({ seconds: "25s", line: 249 / 300 });

      await advance(150);
      expect(timeLeft(card)).toEqual({ seconds: "10s", line: 99 / 300 });
    });

    it("renews and shows the answer", async () => {
      const card = await renewalWith(BORIS);

      button(card, "renew").click();
      await display.updateComplete;

      expect(intents()).toHaveLength(1);
      expect(intents()[0]).toBeInstanceOf(SendAllianceExtensionIntentEvent);
      expect((intents()[0] as SendAllianceExtensionIntentEvent).recipient).toBe(
        players.get(BORIS),
      );
      expect(card.dataset.answered).toBe("renew");
    });

    it("ignores without sending anything and shows the answer", async () => {
      const card = await renewalWith(BORIS);

      button(card, "ignore").click();
      await display.updateComplete;

      expect(events).toEqual([]);
      expect(card.dataset.answered).toBe("ignore");
    });

    it("still goes when the alliance breaks while it shows the answer", async () => {
      const card = await renewalWith(BORIS);
      button(card, "renew").click();
      await display.updateComplete;

      myAlliances = [];
      await tick({
        [GameUpdateType.BrokeAlliance]: [
          { type: GameUpdateType.BrokeAlliance, allianceID: 7 },
        ],
      });
      expect(cards()).toEqual([card]);

      endFold(card);
      await display.updateComplete;
      expect(cards()).toEqual([]);
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
