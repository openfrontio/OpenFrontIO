import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MessageType } from "@openfront/engine-api/game/GameTypes";
import {
  DonateEventUpdate,
  GameUpdateType,
} from "@openfront/engine-api/game/GameUpdates";
import { EventBus } from "@openfront/shared/EventBus";
import { OF_ICONS } from "../../src/client/components/OfIcon";
// Side-effect import: the @customElement decorator registers <events-display>.
import "../../src/client/hud/layers/EventsDisplay";
import type { EventsDisplay } from "../../src/client/hud/layers/EventsDisplay";
import {
  GoToPlayerEvent,
  GoToUnitEvent,
} from "../../src/client/TransformHandler";
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

let players: Map<number, ReturnType<typeof player>>;

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
    unitView?: UnitView;
    minor?: boolean;
  }): void;
  addInboundMissile(
    unit: UnitView,
    messageKey: string,
    countKey: string,
    type: MessageType,
  ): void;
  onDonateEvent(update: DonateEventUpdate): void;
}

describe("events-display", () => {
  let display: EventsDisplay;
  let langSelector: HTMLElement;
  let ticks: number;
  let goTo: GoToPlayerEvent[];
  let goToUnit: GoToUnitEvent[];

  const feed = () => display as unknown as Feed;
  const rows = () => [
    ...display.querySelectorAll<HTMLElement>("[data-event-row]"),
  ];
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
        "events_display.betrayal_debuff_ends":
          "{time} seconds left until betrayal debuff ends",
      },
    });
    document.body.appendChild(langSelector);

    players = new Map([
      [ME, player(ME)],
      [ENEMY, player(ENEMY)],
    ]);
    ticks = 0;
    goTo = [];
    goToUnit = [];
    const eventBus = new EventBus();
    eventBus.on(GoToPlayerEvent, (e) => goTo.push(e));
    eventBus.on(GoToUnitEvent, (e) => goToUnit.push(e));

    display = document.createElement("events-display") as EventsDisplay;
    display.eventBus = eventBus;
    display.game = {
      inSpawnPhase: () => false,
      ticks: () => ticks,
      myPlayer: () => players.get(ME),
      playerBySmallID: (id: number) => players.get(id),
      player: (id: string) => [...players.values()].find((p) => p.id() === id),
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

  it("puts each event in its block, and quiet good news a size down", async () => {
    attackRequest("asked", 0);
    feed().addEvent({
      description: "conquered",
      type: MessageType.CONQUERED_PLAYER,
      createdAt: 0,
    });
    feed().addEvent({
      description: "expired",
      type: MessageType.ALLIANCE_EXPIRED,
      createdAt: 0,
    });
    // A message I sent is a quiet confirmation, though chat is important.
    feed().addEvent({
      description: "sent",
      type: MessageType.CHAT,
      createdAt: 0,
      minor: true,
    });
    await advanceTo(1);

    const tier = (text: string) => rowSaying(text).dataset.tier;
    expect(tier("asked")).toBe("important");
    expect(tier("conquered")).toBe("important");
    expect(tier("expired")).toBe("routine");
    expect(tier("sent")).toBe("routine");
    expect(rowSaying("conquered").hasAttribute("data-quiet")).toBe(true);
    expect(rowSaying("asked").hasAttribute("data-quiet")).toBe(false);
  });

  it("shows the newest four routine events", async () => {
    for (let i = 0; i < 6; i++) {
      feed().addEvent({
        description: `routine ${i}`,
        type: MessageType.ALLIANCE_EXPIRED,
        createdAt: i,
      });
    }
    await advanceTo(6);

    const routine = rows().filter((r) => r.dataset.tier === "routine");
    expect(routine.map((r) => r.textContent?.trim())).toEqual([
      "routine 2",
      "routine 3",
      "routine 4",
      "routine 5",
    ]);
  });

  it("tints important rows with their tone, but not chat or routine rows", async () => {
    attackRequest("asked", 0);
    feed().addEvent({
      description: "broke",
      type: MessageType.ALLIANCE_BROKEN,
      createdAt: 0,
    });
    feed().addEvent({
      description: "chat",
      type: MessageType.CHAT,
      createdAt: 0,
    });
    feed().addEvent({
      description: "expired",
      type: MessageType.ALLIANCE_EXPIRED,
      createdAt: 0,
    });
    await advanceTo(1);

    const tone = (text: string) => rowSaying(text).dataset.tone;
    const tinted = (text: string) =>
      rowSaying(text).querySelector("[data-tint]") !== null;
    expect(tone("asked")).toBe("blue");
    expect(tone("broke")).toBe("fail");
    expect(tone("chat")).toBe("info");
    expect(tone("expired")).toBe("warn");
    expect(tinted("asked")).toBe(true);
    expect(tinted("broke")).toBe(true);
    expect(tinted("chat")).toBe(false);
    expect(tinted("expired")).toBe(false);
  });

  it("gives every row a tone", async () => {
    const types = Object.values(MessageType).filter(
      (v): v is MessageType => typeof v === "number",
    );
    for (const [i, type] of types.entries()) {
      feed().addEvent({ description: `type ${type}`, type, createdAt: i });
      await advanceTo(i);
      expect(rowSaying(`type ${type}`).dataset.tone, MessageType[type]).toMatch(
        /^(fail|warn|success|blue|info)$/,
      );
    }
  });

  it("makes a row a button only when it goes somewhere", async () => {
    attackRequest("to a player", 0);
    const unit = bomb(10);
    feed().addEvent({
      description: "to a unit",
      type: MessageType.UNIT_DESTROYED,
      createdAt: 0,
      unitView: unit,
    });
    feed().addEvent({
      description: "nowhere",
      type: MessageType.ATTACK_CANCELLED,
      createdAt: 0,
    });
    await advanceTo(1);

    rowSaying("to a player").querySelector("button")!.click();
    rowSaying("to a unit").querySelector("button")!.click();

    expect(goTo.map((e) => e.player)).toEqual([players.get(ENEMY)]);
    expect(goToUnit.map((e) => e.unit)).toEqual([unit]);
    expect(rowSaying("nowhere").querySelector("button")).toBeNull();
  });

  it("gives every message type an icon", async () => {
    const types = Object.values(MessageType).filter(
      (v): v is MessageType => typeof v === "number",
    );
    for (const [i, type] of types.entries()) {
      feed().addEvent({ description: `type ${type}`, type, createdAt: i });
      await advanceTo(i);
      const name = rowSaying(`type ${type}`)
        .querySelector("of-icon")
        ?.getAttribute("name");
      expect(name, MessageType[type]).toBeTruthy();
      expect(Object.keys(OF_ICONS), MessageType[type]).toContain(name);
    }
  });

  it("shows a troop donation with the troop icon", async () => {
    const donation = (donationType: "gold" | "troops"): DonateEventUpdate => ({
      type: GameUpdateType.DonateEvent,
      donationType,
      senderId: "p2",
      recipientId: "p1",
      amount: 1000n,
    });
    feed().onDonateEvent(donation("troops"));
    feed().onDonateEvent(donation("gold"));
    await advanceTo(1);

    const icons = rows().map((r) =>
      r.querySelector("of-icon")?.getAttribute("name"),
    );
    expect(icons).toEqual(["donate-troops", "donate-gold"]);
  });

  it("shows the betrayal debuff's seconds as text, not a button", async () => {
    Object.assign(players.get(ME)!, {
      isTraitor: () => true,
      getTraitorRemainingTicks: () => 241,
    });
    await advanceTo(1);

    const line = display.querySelector("[data-betrayal-debuff]")!;
    expect(line.textContent).toContain(
      "25 seconds left until betrayal debuff ends",
    );
    expect(line.querySelector("button")).toBeNull();
    expect(rows()).toHaveLength(0);
  });
});
