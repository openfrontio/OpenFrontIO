import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MessageType } from "@openfront/engine-api/game/GameTypes";
import {
  AllianceRequestReplyUpdate,
  AllianceRequestUpdate,
  DisplayMessageUpdate,
  DonateEventUpdate,
  EmojiUpdate,
  GameUpdateType,
  UnitIncomingUpdate,
} from "@openfront/engine-api/game/GameUpdates";
import { EventBus } from "@openfront/shared/EventBus";
import en from "../../resources/lang/en.json";
import fr from "../../resources/lang/fr.json";
import { OF_ICONS } from "../../src/client/components/OfIcon";
// Side-effect import: the @customElement decorator registers <events-display>.
import "../../src/client/hud/layers/EventsDisplay";
import type { EventsDisplay } from "../../src/client/hud/layers/EventsDisplay";
import {
  GoToPlayerEvent,
  GoToUnitEvent,
} from "../../src/client/TransformHandler";
import { SendAllianceRequestIntentEvent } from "../../src/client/Transport";
import type { GameView, PlayerView, UnitView } from "../../src/client/view";

const ME = 1;
const ENEMY = 2;

function player(smallID: number) {
  return {
    smallID: () => smallID,
    id: () => `p${smallID}`,
    displayName: () => `Player${smallID}`,
    isPlayer: () => true,
    isAlive: () => true,
    isTraitor: () => false,
    getTraitorRemainingTicks: () => 0,
    isRequestingAllianceWith: () => false,
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
  onDisplayMessageEvent(update: DisplayMessageUpdate): void;
}

describe("events-display", () => {
  let display: EventsDisplay;
  let langSelector: HTMLElement;
  let ticks: number;
  let updates: Partial<Record<GameUpdateType, unknown[]>> | null;
  let replay: boolean;
  let catchingUp: boolean;
  let goTo: GoToPlayerEvent[];
  let goToUnit: GoToUnitEvent[];

  const feed = () => display as unknown as Feed;
  // The rows in the feed, not those folding away after it.
  const rows = () => [
    ...display.querySelectorAll<HTMLElement>(
      "[data-event-row]:not([data-leaving])",
    ),
  ];
  const leaving = () => [
    ...display.querySelectorAll<HTMLElement>("[data-event-row][data-leaving]"),
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
        "common.duration_second_short": "s",
        "events_display.alliance_accepted": "accepted",
        "events_display.alliance_rejected": "rejected",
        "events_display.alliance_request_sent":
          "Alliance request sent to {name}.",
        "events_display.alliance_request_status":
          "{name} {status} your alliance request",
        "events_display.atom_bomb_detonated": "{name} - atom bomb detonated",
        "events_display.atom_bomb_inbound": "{name} - atom bomb inbound",
        "events_display.atom_bomb_inbound_count":
          "{name} - {count, plural, other {# atom bombs}} inbound",
        "events_display.betrayal_debuff_ends":
          "{time} seconds left until betrayal debuff ends",
        "events_display.log_label": "Game events",
        "events_display.mirv_inbound_alarm":
          en.events_display.mirv_inbound_alarm,
        "events_display.mirv_inbound_alarm_count":
          en.events_display.mirv_inbound_alarm_count,
        // Emoji first, as some languages put it.
        "events_display.sent_emoji": "{emoji} sent to {name}",
        "events_display.sent_emoji_all": "Sent everyone: {emoji}",
        "events_display.received_gold_from_player":
          "Received {gold} gold from {name}",
        "events_display.trade_ship_captured":
          "Your trade ship was captured by {name}",
        "events_display.unit_destroyed": "Your {unit} was destroyed",
      },
    });
    document.body.appendChild(langSelector);

    players = new Map([
      [ME, player(ME)],
      [ENEMY, player(ENEMY)],
    ]);
    ticks = 0;
    updates = null;
    replay = false;
    catchingUp = false;
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
      isCatchingUp: () => catchingUp,
      myPlayer: () => players.get(ME),
      playerBySmallID: (id: number) => players.get(id),
      player: (id: string) => [...players.values()].find((p) => p.id() === id),
      unit: (id: number) => bomb(id),
      updatesSinceLastTick: () => {
        const since = updates;
        updates = null;
        return since;
      },
      config: () => ({
        isReplay: () => replay,
        traitorDuration: () => 300,
        allianceRequestDuration: () => 200,
      }),
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

    it("keeps Space and Enter on a row from the game, and presses the row", async () => {
      attackRequest("a row", 0);
      await advanceTo(1);
      const button = rowSaying("a row").querySelector("button")!;
      button.focus();

      pressKey(button, " ");
      pressKey(button, "Enter");

      expect(onWindow).toEqual([]);
      expect(goTo.map((e) => e.player)).toEqual([
        players.get(ENEMY),
        players.get(ENEMY),
      ]);
    });

    it("lets the game have the release of a Space held elsewhere", async () => {
      attackRequest("a row", 0);
      await advanceTo(1);
      const button = rowSaying("a row").querySelector("button")!;

      // The alternate view is held from the map; then a row gets focus.
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", {
          code: "Space",
          key: " ",
          bubbles: true,
        }),
      );
      button.focus();
      button.dispatchEvent(
        new KeyboardEvent("keyup", { code: "Space", key: " ", bubbles: true }),
      );

      expect(onWindow).toEqual(["keydown Space", "keyup Space"]);
    });

    it("leaves no focus on a row pressed with the mouse", async () => {
      attackRequest("first", 0);
      attackRequest("second", 0);
      await advanceTo(1);
      const first = rowSaying("first").querySelector("button")!;
      const second = rowSaying("second").querySelector("button")!;
      first.focus();

      const mousedown = new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
      });
      second.dispatchEvent(mousedown);

      expect(mousedown.defaultPrevented).toBe(true);
      expect(document.activeElement).not.toBe(first);
      expect(document.activeElement).not.toBe(second);
    });
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

  it("drains a line under the betrayal debuff as its time runs out", async () => {
    let remaining = 240;
    Object.assign(players.get(ME)!, {
      isTraitor: () => true,
      getTraitorRemainingTicks: () => remaining,
    });
    attackRequest("Attack them", 1);
    await advanceTo(1);

    const lines = () => [
      ...display.querySelectorAll<HTMLElement>("[data-time-left]"),
    ];
    expect(lines()).toHaveLength(1);
    expect(lines()[0].closest("[data-betrayal-debuff]")).not.toBeNull();
    expect(lines()[0].getAttribute("aria-hidden")).toBe("true");
    expect(Number(lines()[0].dataset.timeLeft)).toBeCloseTo(0.8);

    remaining = 60;
    await advanceTo(2);
    expect(Number(lines()[0].dataset.timeLeft)).toBeCloseTo(0.2);
    expect(rowSaying("Attack them").querySelector("[data-time-left]")).toBe(
      null,
    );
  });

  describe("a row that goes", () => {
    const end = (row: HTMLElement, type = "animationend") =>
      row.dispatchEvent(new Event(type, { bubbles: true }));

    it("folds away in its place, inert, and goes when its animation ends", async () => {
      attackRequest("first", 0);
      attackRequest("second", 40);
      await advanceTo(50);
      const first = rowSaying("first");

      await advanceTo(85);

      expect(leaving()).toEqual([first]);
      expect(first.hasAttribute("inert")).toBe(true);
      expect(first.nextElementSibling).toBe(rowSaying("second"));
      expect(rowSaying("second").hasAttribute("inert")).toBe(false);

      // A redraw does not drop it; its animation's end does.
      await advanceTo(86);
      expect(leaving()).toEqual([first]);
      end(first);
      await display.updateComplete;
      expect(leaving()).toEqual([]);
      expect(rows().map((r) => r.textContent?.trim())).toEqual(["second"]);
    });

    it("waits for its own animation, not its content's", async () => {
      // A naval warning goes when its boat does, maybe before its content
      // has eased in.
      let afloat = true;
      const boat = { ...bomb(10), isActive: () => afloat } as UnitView;
      feed().addEvent({
        description: "boat",
        type: MessageType.NAVAL_INVASION_INBOUND,
        createdAt: 0,
        unitView: boat,
      });
      await advanceTo(1);
      afloat = false;
      await advanceTo(2);
      const [row] = leaving();

      end(row.querySelector("button")!);
      await display.updateComplete;
      expect(leaving()).toEqual([row]);

      end(row, "animationcancel");
      await display.updateComplete;
      expect(leaving()).toEqual([]);
    });

    it("folds a burst away together, and only the routine rows on screen", async () => {
      for (let i = 0; i < 6; i++) {
        attackRequest(`important ${i}`, 0);
        feed().addEvent({
          description: `routine ${i}`,
          type: MessageType.ALLIANCE_EXPIRED,
          createdAt: 0,
        });
      }
      await advanceTo(1);

      await advanceTo(80);

      expect(rows()).toEqual([]);
      expect(leaving().map((r) => r.textContent?.trim())).toEqual([
        "routine 2",
        "routine 3",
        "routine 4",
        "routine 5",
        "important 0",
        "important 1",
        "important 2",
        "important 3",
        "important 4",
        "important 5",
      ]);
      for (const row of leaving()) end(row);
      await display.updateComplete;
      expect(leaving()).toEqual([]);
    });

    it("keeps the newest four routine rows while one folds away", async () => {
      for (let i = 0; i < 4; i++) {
        feed().addEvent({
          description: `routine ${i}`,
          type: MessageType.ALLIANCE_EXPIRED,
          createdAt: i,
        });
      }
      await advanceTo(4);
      feed().addEvent({
        description: "routine 4",
        type: MessageType.ALLIANCE_EXPIRED,
        createdAt: 80,
      });

      // Routine 0 expires on the tick routine 4 pushes it out of the four:
      // it goes at once, as any row pushed out does.
      await advanceTo(80);
      expect(leaving()).toEqual([]);

      await advanceTo(81);
      expect(leaving().map((r) => r.textContent?.trim())).toEqual([
        "routine 1",
      ]);
      expect(rows().map((r) => r.textContent?.trim())).toEqual([
        "routine 2",
        "routine 3",
        "routine 4",
      ]);
    });

    it("goes at once if it came and went between two draws", async () => {
      await advanceTo(1);
      attackRequest("never drawn", 1);
      ticks = 2;
      display.tick();

      await advanceTo(90);

      expect(rows()).toEqual([]);
      expect(leaving()).toEqual([]);
    });

    it("does not outlive the game it folded in", async () => {
      attackRequest("first", 0);
      await advanceTo(1);
      await advanceTo(85);
      expect(leaving()).toHaveLength(1);

      display.dispose();

      expect((display as unknown as { leaving: unknown[] }).leaving).toEqual(
        [],
      );
    });

    it("goes at once when a replay seeks back before it", async () => {
      attackRequest("from later on", 50);
      await advanceTo(60);

      await advanceTo(20);

      expect(rows()).toEqual([]);
      expect(leaving()).toEqual([]);
    });

    it("goes at once when a replay seeks back before it while it folds", async () => {
      attackRequest("from later on", 50);
      await advanceTo(60);
      await advanceTo(130);
      expect(leaving()).toHaveLength(1);

      await advanceTo(20);

      expect(rows()).toEqual([]);
      expect(leaving()).toEqual([]);
    });

    it("goes at once under reduced motion", async () => {
      const original = window.matchMedia;
      window.matchMedia = ((query: string) => ({
        matches: query === "(prefers-reduced-motion: reduce)",
      })) as unknown as typeof window.matchMedia;
      try {
        attackRequest("first", 0);
        await advanceTo(1);
        await advanceTo(80);
      } finally {
        window.matchMedia = original;
      }

      expect(rows()).toEqual([]);
      expect(leaving()).toEqual([]);
    });

    it("goes at once while the page is hidden", async () => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => true,
      });
      try {
        attackRequest("first", 0);
        await advanceTo(1);
        await advanceTo(80);
      } finally {
        delete (document as { hidden?: boolean }).hidden;
      }

      expect(rows()).toEqual([]);
      expect(leaving()).toEqual([]);
    });

    it("is forgotten when the feed is hidden", async () => {
      attackRequest("first", 0);
      await advanceTo(1);
      await advanceTo(80);
      expect(leaving()).toHaveLength(1);

      // Dead, then (in a test only) alive again: nothing left to fold.
      players.get(ME)!.isAlive = () => false;
      await advanceTo(81);
      expect(leaving()).toEqual([]);
      players.get(ME)!.isAlive = () => true;
      await advanceTo(82);
      expect(leaving()).toEqual([]);
    });
  });

  describe("names and amounts", () => {
    const strong = (row: HTMLElement) =>
      [...row.querySelectorAll("strong")].map((el) => el.textContent);

    it("sets them in bold in the translated sentence", async () => {
      feed().onDonateEvent({
        type: GameUpdateType.DonateEvent,
        donationType: "gold",
        senderId: "p2",
        recipientId: "p1",
        amount: 500n,
      });
      await advanceTo(1);

      const row = rowSaying("Received");
      expect(row.textContent?.trim()).toBe("Received 500 gold from Player2");
      expect(strong(row)).toEqual(["500", "Player2"]);
    });

    it("keeps the name in bold as a missile line's count changes", async () => {
      for (const id of [10, 11]) {
        feed().addInboundMissile(
          bomb(id),
          "events_display.atom_bomb_inbound",
          "events_display.atom_bomb_inbound_count",
          MessageType.NUKE_INBOUND,
        );
      }
      await advanceTo(1);

      const line = rowSaying("inbound");
      expect(line.textContent?.trim()).toBe("Player2 - 2 atom bombs inbound");
      expect(strong(line)).toEqual(["Player2"]);
    });

    it("sets this viewer's name for the player in bold in an engine message", async () => {
      feed().onDisplayMessageEvent({
        type: GameUpdateType.DisplayEvent,
        message: "events_display.trade_ship_captured",
        messageType: MessageType.UNIT_DESTROYED,
        playerID: ME,
        params: { name: "RealName" },
        focusPlayerID: ENEMY,
      });
      feed().onDisplayMessageEvent({
        type: GameUpdateType.DisplayEvent,
        message: "A message without a key",
        messageType: MessageType.UNIT_DESTROYED,
        playerID: ME,
      });
      await advanceTo(1);

      const captured = rowSaying("captured");
      expect(captured.textContent).not.toContain("RealName");
      expect(strong(captured)).toEqual(["Player2"]);
      expect(strong(rowSaying("without a key"))).toEqual([]);
    });

    it("keeps a right-to-left name from reordering the sentence", async () => {
      players.get(ENEMY)!.displayName = () => "سارة";
      feed().onDonateEvent({
        type: GameUpdateType.DonateEvent,
        donationType: "gold",
        senderId: "p2",
        recipientId: "p1",
        amount: 500n,
      });
      await advanceTo(1);

      const name = [...rowSaying("Received").querySelectorAll("strong")].find(
        (el) => el.textContent === "سارة",
      );
      expect(name?.getAttribute("dir")).toBe("auto");
    });
  });

  describe("emojis", () => {
    const emoji = (
      senderID: number,
      recipientID: number | "AllPlayers",
    ): EmojiUpdate => ({
      type: GameUpdateType.Emoji,
      emoji: { message: "😀", senderID, recipientID, createdAt: 0 },
    });
    const emojiPart = (row: HTMLElement) =>
      [...row.querySelectorAll("[data-emoji]")].map((el) => el.textContent);
    const strong = (row: HTMLElement) =>
      [...row.querySelectorAll("strong")].map((el) => el.textContent);

    it("shows a received emoji after its sender's name", async () => {
      display.onEmojiMessageEvent(emoji(ENEMY, ME));
      await advanceTo(1);

      const row = rows()[0];
      expect(row.dataset.tier).toBe("important");
      expect(row.textContent?.trim()).toBe("Player2: 😀");
      expect(strong(row)).toEqual(["Player2"]);
      expect(emojiPart(row)).toEqual(["😀"]);
    });

    it("keeps the translation's order for an emoji I sent", async () => {
      display.onEmojiMessageEvent(emoji(ME, ENEMY));
      display.onEmojiMessageEvent(emoji(ME, "AllPlayers"));
      await advanceTo(1);

      const [toOne, toAll] = rows();
      expect(toOne.textContent?.trim()).toBe("😀 sent to Player2");
      expect(strong(toOne)).toEqual(["Player2"]);
      expect(emojiPart(toOne)).toEqual(["😀"]);
      expect(toAll.textContent?.trim()).toBe("Sent everyone: 😀");
      expect(emojiPart(toAll)).toEqual(["😀"]);
    });
  });

  describe("screen readers", () => {
    const log = () => display.querySelector<HTMLElement>('[role="log"]')!;
    const said = () =>
      [...log().querySelectorAll("p")].map((line) => line.textContent);

    // Runs the game to `tick`, the HUD getting these updates on the way.
    async function arrive(tick: number, ...list: DisplayMessageUpdate[]) {
      updates = { [GameUpdateType.DisplayEvent]: list };
      await advanceTo(tick);
    }
    const message = (
      key: string,
      messageType: MessageType,
      params: Record<string, string>,
    ): DisplayMessageUpdate => ({
      type: GameUpdateType.DisplayEvent,
      message: key,
      messageType,
      playerID: ME,
      params,
    });
    const detonated = () =>
      message(
        "events_display.atom_bomb_detonated",
        MessageType.NUKE_DETONATED,
        {
          name: "Player2",
        },
      );
    const destroyed = () =>
      message("events_display.unit_destroyed", MessageType.UNIT_DESTROYED, {
        unit: "Warship",
      });
    const incoming = (unitID: number): UnitIncomingUpdate => ({
      type: GameUpdateType.UnitIncoming,
      unitID,
      message: "events_display.atom_bomb_inbound",
      messageType: MessageType.NUKE_INBOUND,
      playerID: ME,
    });

    it("keeps a labelled log while the feed is empty", async () => {
      await advanceTo(1);

      expect(rows()).toHaveLength(0);
      expect(log().getAttribute("aria-label")).toBe("Game events");
      expect(log().getAttribute("aria-relevant")).toBe("additions");
      expect(said()).toEqual([]);
    });

    it("reads a new important event out once, as its plain sentence", async () => {
      await arrive(1, detonated());

      expect(said()).toEqual(["Player2 - atom bomb detonated"]);
      expect(log().querySelector("strong")).toBeNull();

      // The feed redraws every tick; the log must not change with it.
      const changes: MutationRecord[] = [];
      new MutationObserver((records) => changes.push(...records)).observe(
        log(),
        { childList: true, characterData: true, subtree: true },
      );
      for (let tick = 2; tick < 10; tick++) await advanceTo(tick);

      expect(changes).toEqual([]);
    });

    it("does not read routine events out", async () => {
      await arrive(1, destroyed());

      expect(rowSaying("Warship").dataset.tier).toBe("routine");
      expect(said()).toEqual([]);
    });

    it("does not read a missile line out again when its count changes", async () => {
      updates = { [GameUpdateType.UnitIncoming]: [incoming(10)] };
      await advanceTo(1);
      const line = log().querySelector("p");
      updates = { [GameUpdateType.UnitIncoming]: [incoming(11)] };
      await advanceTo(2);

      expect(rowSaying("inbound").textContent).toContain("2 atom bombs");
      expect(said()).toEqual(["Player2 - atom bomb inbound"]);
      expect(log().querySelector("p")).toBe(line);
    });

    it("drops a line with its event", async () => {
      await arrive(1, detonated());

      await advanceTo(81);

      expect(rows()).toHaveLength(0);
      expect(said()).toEqual([]);
    });

    it("stays silent in a replay and while the game catches up", async () => {
      replay = true;
      await arrive(1, detonated());
      replay = false;
      catchingUp = true;
      await arrive(2, detonated());
      catchingUp = false;
      await advanceTo(3);

      expect(rows()).toHaveLength(2);
      expect(said()).toEqual([]);
    });
  });

  describe("my own alliance request", () => {
    const THIRD = 3;
    const pending = () =>
      rows().filter((row) => row.hasAttribute("data-request-pending"));
    const seconds = (row: HTMLElement) =>
      row.querySelector("[data-row-seconds]")?.textContent?.trim();
    const request = (
      recipientID: number,
      createdAt: number,
      requestorID = ME,
    ): AllianceRequestUpdate => ({
      type: GameUpdateType.AllianceRequest,
      requestorID,
      recipientID,
      createdAt,
    });
    const reply = (
      recipientID: number,
      createdAt: number,
      accepted: boolean,
    ): AllianceRequestReplyUpdate => ({
      type: GameUpdateType.AllianceRequestReply,
      request: request(recipientID, createdAt),
      accepted,
    });
    // Runs the game to `tick`, the HUD getting these updates on the way.
    async function arrive(
      tick: number,
      type: GameUpdateType,
      ...list: unknown[]
    ) {
      updates = { [type]: list };
      await advanceTo(tick);
    }
    function click(recipientID: number) {
      display.eventBus.emit(
        new SendAllianceRequestIntentEvent(
          players.get(ME) as unknown as PlayerView,
          players.get(recipientID) as unknown as PlayerView,
        ),
      );
    }

    beforeEach(() => {
      players.set(THIRD, player(THIRD));
      // The game has my requests until they are answered or lapse.
      players.get(ME)!.isRequestingAllianceWith = () => true;
      display.init();
    });

    it("turns the row that confirmed my click into the pending request", async () => {
      click(ENEMY);
      await advanceTo(1);
      const row = rowSaying("Alliance request sent to Player2.");
      const body = row.querySelector("button")!;
      expect(row.hasAttribute("data-request-pending")).toBe(false);
      expect(seconds(row)).toBeUndefined();

      await arrive(3, GameUpdateType.AllianceRequest, request(ENEMY, 2));

      expect(rows()).toEqual([row]);
      expect(row.querySelector("button")).toBe(body);
      expect(row.hasAttribute("data-request-pending")).toBe(true);
      expect(row.dataset.tier).toBe("routine");
      expect(seconds(row)).toBe("20s");
      body.click();
      expect(goTo.map((e) => e.player)).toEqual([players.get(ENEMY)]);
    });

    it("ignores requests I did not make", async () => {
      await arrive(
        1,
        GameUpdateType.AllianceRequest,
        request(ENEMY, 0, THIRD),
        request(ME, 0, ENEMY),
      );

      expect(rows()).toEqual([]);
    });

    it("shows the request without a click before it, as in a replay", async () => {
      await arrive(1, GameUpdateType.AllianceRequest, request(ENEMY, 0));

      expect(pending()).toHaveLength(1);
      expect(pending()[0].textContent).toContain(
        "Alliance request sent to Player2.",
      );
      expect(seconds(pending()[0])).toBe("20s");
    });

    it("lives as long as the game gives the request", async () => {
      await arrive(1, GameUpdateType.AllianceRequest, request(ENEMY, 0));
      const row = pending()[0];

      // Past the 80 ticks of any other row.
      await advanceTo(91);
      expect(pending()).toEqual([row]);
      expect(seconds(row)).toBe("11s");
      await advanceTo(101);
      expect(seconds(row)).toBe("10s");
      await advanceTo(201);
      expect(pending()).toEqual([row]);
      expect(seconds(row)).toBe("0s");

      await advanceTo(202);
      expect(rows()).toEqual([]);
      expect(leaving()).toEqual([row]);
    });

    for (const accepted of [true, false]) {
      it(`gives way to the answer at once when ${accepted ? "accepted" : "rejected"}`, async () => {
        await arrive(1, GameUpdateType.AllianceRequest, request(ENEMY, 0));
        expect(pending()).toHaveLength(1);

        await arrive(
          30,
          GameUpdateType.AllianceRequestReply,
          reply(ENEMY, 0, accepted),
        );

        expect(leaving()).toEqual([]);
        expect(rows().map((row) => row.textContent?.trim())).toEqual([
          `Player2 ${accepted ? "accepted" : "rejected"} your alliance request`,
        ]);
      });
    }

    it("counts to 0s, then gives way to the game's rejection", async () => {
      await arrive(1, GameUpdateType.AllianceRequest, request(ENEMY, 0));
      await advanceTo(201);
      expect(seconds(pending()[0])).toBe("0s");

      await arrive(
        202,
        GameUpdateType.AllianceRequestReply,
        reply(ENEMY, 0, false),
      );

      expect(leaving()).toEqual([]);
      expect(rows().map((row) => row.textContent?.trim())).toEqual([
        "Player2 rejected your alliance request",
      ]);
    });

    it("keeps a row and its seconds for each player I asked", async () => {
      await arrive(1, GameUpdateType.AllianceRequest, request(ENEMY, 0));
      await arrive(50, GameUpdateType.AllianceRequest, request(THIRD, 50));
      await advanceTo(101);

      const secondsOf = (name: string) =>
        seconds(pending().find((row) => row.textContent?.includes(name))!);
      expect(secondsOf("Player2")).toBe("10s");
      expect(secondsOf("Player3")).toBe("15s");

      await arrive(
        102,
        GameUpdateType.AllianceRequestReply,
        reply(THIRD, 50, true),
      );
      expect(pending()).toHaveLength(1);
      expect(pending()[0].textContent).toContain("Player2");
    });

    it("goes when the player I asked dies", async () => {
      await arrive(1, GameUpdateType.AllianceRequest, request(ENEMY, 0));
      expect(pending()).toHaveLength(1);

      players.get(ENEMY)!.isAlive = () => false;
      await advanceTo(2);

      expect(pending()).toEqual([]);
    });

    it("leaves a click the game never takes up to expire like any row", async () => {
      click(ENEMY);
      await advanceTo(79);
      expect(rowSaying("Alliance request sent to Player2.")).toBeDefined();

      await advanceTo(80);
      expect(rows()).toEqual([]);
    });

    it("waits behind four newer routine rows, and comes back after them", async () => {
      await arrive(1, GameUpdateType.AllianceRequest, request(ENEMY, 0));
      for (let i = 0; i < 4; i++) {
        feed().addEvent({
          description: `routine ${i}`,
          type: MessageType.ALLIANCE_EXPIRED,
          createdAt: 10 + i,
        });
      }
      await advanceTo(14);
      expect(pending()).toEqual([]);

      await advanceTo(93);
      expect(pending()).toHaveLength(1);
      expect(seconds(pending()[0])).toBe("11s");
    });

    it("outlasts the 30 rows the feed keeps, and comes back after them", async () => {
      await arrive(1, GameUpdateType.AllianceRequest, request(ENEMY, 0));
      for (let i = 0; i < 31; i++) {
        feed().addEvent({
          description: `routine ${i}`,
          type: MessageType.ALLIANCE_EXPIRED,
          createdAt: 10,
        });
      }
      await advanceTo(10);
      expect(pending()).toEqual([]);

      await advanceTo(91);
      expect(pending()).toHaveLength(1);
      expect(seconds(pending()[0])).toBe("11s");
    });

    it("goes when the game no longer has it, as after a replay seeks past the answer", async () => {
      await arrive(1, GameUpdateType.AllianceRequest, request(ENEMY, 0));
      expect(pending()).toHaveLength(1);

      players.get(ME)!.isRequestingAllianceWith = () => false;
      await advanceTo(60);

      expect(pending()).toEqual([]);
    });

    it("goes when the replay follows a player who did not send it", async () => {
      await arrive(1, GameUpdateType.AllianceRequest, request(ENEMY, 0));
      expect(pending()).toHaveLength(1);

      players.set(ME, player(THIRD));
      await advanceTo(2);

      expect(pending()).toEqual([]);
    });

    it("goes at once when a replay seeks back before it", async () => {
      await arrive(50, GameUpdateType.AllianceRequest, request(ENEMY, 50));
      expect(pending()).toHaveLength(1);

      await advanceTo(20);

      expect(rows()).toEqual([]);
      expect(leaving()).toEqual([]);
    });

    it("adds no row when my click accepts their request", async () => {
      players.get(ENEMY)!.isRequestingAllianceWith = () => true;

      click(ENEMY);
      await advanceTo(1);

      expect(rows()).toEqual([]);
    });

    it("hides its seconds from screen readers and is not read out", async () => {
      await arrive(1, GameUpdateType.AllianceRequest, request(ENEMY, 0));

      const counter = pending()[0].querySelector("[data-row-seconds]")!;
      expect(counter.getAttribute("aria-hidden")).toBe("true");
      expect(display.querySelectorAll('[role="log"] p')).toHaveLength(0);
    });
  });

  describe("the MIRV warning", () => {
    const alarms = () =>
      rows().filter((row) => row.dataset.alarm !== undefined);
    const said = (selector: string) =>
      [...display.querySelectorAll(`${selector} p`)].map((p) => p.textContent);

    function mirv(id: number, active = () => true) {
      return {
        id: () => id,
        isActive: active,
        owner: () => players.get(ENEMY),
      } as unknown as UnitView;
    }
    function launch(unit: UnitView, type = MessageType.MIRV_INBOUND) {
      const key = {
        [MessageType.MIRV_INBOUND]: "events_display.mirv_inbound_alarm",
        [MessageType.NUKE_INBOUND]: "events_display.atom_bomb_inbound",
        [MessageType.HYDROGEN_BOMB_INBOUND]:
          "events_display.hydrogen_bomb_inbound",
      }[type as number]!;
      feed().addInboundMissile(unit, key, `${key}_count`, type);
    }

    it("is the only row drawn as an alarm", async () => {
      launch(mirv(1));
      launch(bomb(2), MessageType.NUKE_INBOUND);
      launch(bomb(3), MessageType.HYDROGEN_BOMB_INBOUND);
      feed().addEvent({
        description: "Naval invasion incoming",
        type: MessageType.NAVAL_INVASION_INBOUND,
        createdAt: 0,
      });
      await advanceTo(1);

      expect(rows()).toHaveLength(4);
      expect(alarms()).toEqual([rowSaying("MIRV INBOUND")]);
      expect(alarms()[0].querySelector("[data-tint]")).toBeNull();
      expect(alarms()[0].querySelector("[data-alarm-fill]")).not.toBeNull();
    });

    it("says its sentence once, its warning signs hidden", async () => {
      launch(mirv(1));
      await advanceTo(1);
      const row = alarms()[0];

      expect(row.textContent!.trim().replace(/\s+/g, " ")).toBe(
        "Player2 - MIRV INBOUND",
      );
      expect(row.textContent).not.toContain("\u26A0");
      const icons = [...row.querySelectorAll("of-icon")];
      expect(icons.map((icon) => icon.getAttribute("name"))).toEqual([
        "mirv",
        "warning",
        "warning",
        "warning",
        "warning",
      ]);
      for (const icon of icons) {
        expect(icon.firstElementChild!.getAttribute("aria-hidden")).toBe(
          "true",
        );
      }
    });

    it("keeps one row as MIRVs join and land, and pulses again only for one that joins", async () => {
      // The glow and the signs pulse as they are drawn: new elements replay
      // it, kept ones do not.
      const pulsing = (row: HTMLElement) => [
        row.querySelector("[data-alarm-fill]"),
        ...row.querySelectorAll('of-icon[name="warning"]'),
      ];
      let firstActive = true;
      launch(mirv(1, () => firstActive));
      await advanceTo(1);
      const row = alarms()[0];
      const first = pulsing(row);

      launch(mirv(2));
      await advanceTo(2);
      const joined = pulsing(row);

      expect(alarms()).toEqual([row]);
      expect(row.textContent).toContain("Player2 - 2 MIRVS INBOUND");
      expect(joined).toHaveLength(5);
      joined.forEach((element, i) => expect(element).not.toBe(first[i]));

      firstActive = false;
      await advanceTo(3);

      expect(alarms()).toEqual([row]);
      expect(row.textContent).toContain("Player2 - MIRV INBOUND");
      pulsing(row).forEach((element, i) => expect(element).toBe(joined[i]));
    });

    it("is read out at once, apart from the log, and again when a MIRV joins", async () => {
      updates = {
        [GameUpdateType.UnitIncoming]: [
          {
            type: GameUpdateType.UnitIncoming,
            unitID: 1,
            message: "events_display.mirv_inbound_alarm",
            messageType: MessageType.MIRV_INBOUND,
            playerID: ME,
          },
        ],
      };
      await advanceTo(1);
      expect(said('[aria-live="assertive"]')).toEqual([
        "Player2 - MIRV INBOUND",
      ]);

      let secondActive = true;
      launch(mirv(2, () => secondActive));
      await advanceTo(2);
      const joined = display.querySelector('[aria-live="assertive"] p');

      expect(rowSaying("MIRVS").textContent).toContain("2 MIRVS");
      expect(said('[aria-live="assertive"]')).toEqual([
        "Player2 - 2 MIRVS INBOUND",
      ]);
      expect(said('[role="log"]')).toEqual([]);

      // A landing changes the count but is not read out.
      secondActive = false;
      await advanceTo(3);
      expect(display.querySelector('[aria-live="assertive"] p')).toBe(joined);
      expect(said('[aria-live="assertive"]')).toEqual([
        "Player2 - 2 MIRVS INBOUND",
      ]);
    });

    it("leaves out the warning emoji a language still has from the old sentence", async () => {
      // fr, fa, pt-BR, ro, uk and vi translated the old key with six ⚠️;
      // until they translate the new one, the row falls back to English.
      const { translations: english } = langSelector as HTMLElement & {
        translations: Record<string, string>;
      };
      Object.assign(langSelector, {
        currentLang: "fr",
        translations: Object.fromEntries(
          Object.entries(fr.events_display).map(([key, text]) => [
            `events_display.${key}`,
            text,
          ]),
        ),
        defaultTranslations: english,
      });
      updates = {
        [GameUpdateType.UnitIncoming]: [
          {
            type: GameUpdateType.UnitIncoming,
            unitID: 1,
            message: "events_display.mirv_inbound_alarm",
            messageType: MessageType.MIRV_INBOUND,
            playerID: ME,
          },
        ],
      };
      await advanceTo(1);

      expect(alarms()).toHaveLength(1);
      expect(alarms()[0].textContent).not.toContain("\u26A0");
      expect(said('[aria-live="assertive"]')).toEqual([
        "Player2 - MIRV INBOUND",
      ]);
    });
  });
});
