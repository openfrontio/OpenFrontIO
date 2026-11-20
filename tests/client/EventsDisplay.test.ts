import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MessageType } from "@openfront/engine-api/game/GameTypes";
import { EventBus } from "@openfront/shared/EventBus";
// Side-effect import: the @customElement decorator registers <events-display>.
import "../../src/client/hud/layers/EventsDisplay";
import type { EventsDisplay } from "../../src/client/hud/layers/EventsDisplay";
import { GoToPlayerEvent } from "../../src/client/TransformHandler";
import type { GameView, UnitView } from "../../src/client/view";

const ME = 1;
const ENEMY = 2;

function player(smallID: number) {
  return {
    smallID: () => smallID,
    id: () => `p${smallID}`,
    displayName: () => `Player${smallID}`,
    isAlive: () => true,
    isTraitor: () => false,
    getTraitorRemainingTicks: () => 0,
  };
}

const players = new Map([
  [ME, player(ME)],
  [ENEMY, player(ENEMY)],
]);

function bomb(id: number) {
  return {
    id: () => id,
    isActive: () => true,
    owner: () => players.get(ENEMY),
  } as unknown as UnitView;
}

// The private parts of the element the tests drive.
interface Feed {
  addEvent(event: {
    description: string;
    type: MessageType;
    createdAt: number;
    focusID?: number;
  }): void;
  addInboundMissile(
    unit: UnitView,
    messageKey: string,
    countKey: string,
    type: MessageType,
  ): void;
}

describe("events-display", () => {
  let display: EventsDisplay;
  let langSelector: HTMLElement;
  let ticks: number;
  let goTo: GoToPlayerEvent[];

  const feed = () => display as unknown as Feed;
  const rows = () => [...display.querySelectorAll("[data-event-row]")];
  const rowSaying = (text: string) =>
    rows().find((r) => r.textContent?.includes(text)) as HTMLElement;

  async function advanceTo(tick: number) {
    ticks = tick;
    display.tick();
    await display.updateComplete;
  }

  function attackRequest(name: string, createdAt: number, focusID = ENEMY) {
    feed().addEvent({
      description: name,
      type: MessageType.ATTACK_REQUEST,
      createdAt,
      focusID,
    });
  }

  beforeEach(() => {
    document.body.innerHTML = "";
    langSelector = document.createElement("lang-selector");
    Object.assign(langSelector, {
      currentLang: "en",
      translations: {
        "events_display.atom_bomb_inbound": "{name} - atom bomb inbound",
        "events_display.atom_bomb_inbound_count":
          "{name} - {count, plural, other {# atom bombs}} inbound",
      },
    });
    document.body.appendChild(langSelector);

    ticks = 0;
    goTo = [];
    const eventBus = new EventBus();
    eventBus.on(GoToPlayerEvent, (e) => goTo.push(e));

    display = document.createElement("events-display") as EventsDisplay;
    display.eventBus = eventBus;
    display.game = {
      inSpawnPhase: () => false,
      ticks: () => ticks,
      myPlayer: () => players.get(ME),
      playerBySmallID: (id: number) => players.get(id),
      updatesSinceLastTick: () => null,
    } as unknown as GameView;
    document.body.appendChild(display);
  });

  afterEach(() => {
    display.remove();
    langSelector.remove();
  });

  it("keeps a row's element when an older row expires", async () => {
    attackRequest("first", 0);
    attackRequest("second", 40);
    await advanceTo(50);
    const second = rowSaying("second");

    // Rows live 80 ticks: the first goes, the second stays.
    await advanceTo(85);

    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toBe(second);
    expect(second.textContent).toContain("second");
  });

  it("keeps focus on the event whose button has it", async () => {
    attackRequest("first", 0, ME);
    attackRequest("second", 40, ENEMY);
    await advanceTo(50);
    const button = rowSaying("second").querySelector("button")!;
    button.focus();

    await advanceTo(85);

    expect(document.activeElement).toBe(button);
    expect(button.textContent).toContain("second");
    button.click();
    expect(goTo).toHaveLength(1);
    expect(goTo[0].player).toBe(players.get(ENEMY));
  });

  it("keeps a missile line's element when a new bomb moves it under newer rows", async () => {
    feed().addInboundMissile(
      bomb(10),
      "events_display.atom_bomb_inbound",
      "events_display.atom_bomb_inbound_count",
      MessageType.NUKE_INBOUND,
    );
    await advanceTo(5);
    attackRequest("newer", 5);
    await advanceTo(10);
    const line = rowSaying("atom bomb inbound");
    expect(rows()[0]).toBe(line);

    // A second bomb restarts the line's timer, so it sorts after "newer".
    feed().addInboundMissile(
      bomb(11),
      "events_display.atom_bomb_inbound",
      "events_display.atom_bomb_inbound_count",
      MessageType.NUKE_INBOUND,
    );
    await advanceTo(20);

    expect(rows()).toHaveLength(2);
    expect(rows()[1]).toBe(line);
    expect(line.textContent).toContain("Player2 - 2 atom bombs inbound");
    expect(rows()[0].textContent).toContain("newer");
  });
});
