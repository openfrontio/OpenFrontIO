import { AllPlayers } from "@openfront/engine-api/game/GameTypes";
import { flattenedEmojiTable } from "@openfront/engine-api/Schemas";
import { EventBus } from "@openfront/shared/EventBus";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "../../../../src/client/hud/layers/EmojiTable";
import {
  type EmojiTable,
  ShowPlayerEmojiMenuEvent,
} from "../../../../src/client/hud/layers/EmojiTable";
import {
  CloseViewEvent,
  EmojiKeyEvent,
  EmojiTableVisibleEvent,
  ShowEmojiMenuEvent,
} from "../../../../src/client/InputHandler";
import type { TransformHandler } from "../../../../src/client/TransformHandler";
import { SendEmojiIntentEvent } from "../../../../src/client/Transport";
import { UserSettings } from "../../../../src/client/UserSettings";
import type { GameView, PlayerView } from "../../../../src/client/view";

describe("EmojiTable event bus wiring", () => {
  let table: EmojiTable;
  let eventBus: EventBus;
  let emojiIntents: SendEmojiIntentEvent[];
  const myPlayer = { name: "me" };
  const otherPlayer = { name: "other" };
  let tileOwner: object;

  beforeEach(() => {
    localStorage.clear();
    (
      UserSettings as unknown as { cache: Map<string, string | null> }
    ).cache.clear();
    table = document.createElement("emoji-table") as EmojiTable;
    table.transformHandler = {
      screenToWorldCoordinates: (x: number, y: number) => ({ x, y }),
    } as unknown as TransformHandler;
    table.game = {
      isValidCoord: () => true,
      ref: (x: number, y: number) => x + y,
      hasOwner: () => true,
      owner: () => tileOwner,
      myPlayer: () => myPlayer,
    } as unknown as GameView;
    document.body.appendChild(table);

    eventBus = new EventBus();
    emojiIntents = [];
    eventBus.on(SendEmojiIntentEvent, (e) => emojiIntents.push(e));
    table.initEventBus(eventBus);
  });

  afterEach(() => {
    table.remove();
  });

  // Clicks the button for the emoji at wire index `index`. The table's layout
  // order differs from the wire order.
  async function pickEmoji(index: number) {
    await table.updateComplete;
    const buttons = [
      ...table.querySelectorAll<HTMLButtonElement>(".grid button"),
    ];
    expect(buttons.length).toBe(flattenedEmojiTable.length);
    buttons
      .find((b) => b.textContent!.includes(flattenedEmojiTable[index]))!
      .click();
  }

  it("sends the picked emoji to AllPlayers when the target is myself", async () => {
    tileOwner = myPlayer;
    eventBus.emit(new ShowEmojiMenuEvent(3, 4));
    expect(table.isVisible).toBe(true);

    await pickEmoji(2);

    expect(emojiIntents).toHaveLength(1);
    expect(emojiIntents[0].recipient).toBe(AllPlayers);
    expect(emojiIntents[0].emoji).toBe(2);
    expect(table.isVisible).toBe(false);
  });

  it("sends the picked emoji to the tile owner when targeting someone else", async () => {
    tileOwner = otherPlayer;
    eventBus.emit(new ShowEmojiMenuEvent(3, 4));

    await pickEmoji(0);

    expect(emojiIntents).toHaveLength(1);
    expect(emojiIntents[0].recipient).toBe(otherPlayer);
    expect(emojiIntents[0].emoji).toBe(0);
  });

  it("closes on CloseViewEvent", () => {
    tileOwner = myPlayer;
    eventBus.emit(new ShowEmojiMenuEvent(3, 4));
    expect(table.isVisible).toBe(true);

    eventBus.emit(new CloseViewEvent());

    expect(table.isVisible).toBe(false);
  });
  it("ignores ShowEmojiMenuEvent while already open to preserve original target", async () => {
    tileOwner = otherPlayer;
    eventBus.emit(new ShowEmojiMenuEvent(3, 4));
    expect(table.isVisible).toBe(true);

    // Another event fires for a different owner while already visible
    tileOwner = myPlayer;
    eventBus.emit(new ShowEmojiMenuEvent(10, 20));

    await pickEmoji(1);

    expect(emojiIntents).toHaveLength(1);
    expect(emojiIntents[0].recipient).toBe(otherPlayer);
    expect(emojiIntents[0].emoji).toBe(1);
  });

  it("targets the given player for ShowPlayerEmojiMenuEvent", async () => {
    tileOwner = myPlayer;
    eventBus.emit(
      new ShowPlayerEmojiMenuEvent(otherPlayer as unknown as PlayerView),
    );
    expect(table.isVisible).toBe(true);

    await pickEmoji(3);

    expect(emojiIntents).toHaveLength(1);
    expect(emojiIntents[0].recipient).toBe(otherPlayer);
    expect(emojiIntents[0].emoji).toBe(3);
  });

  it("sends the favorite picked by its slot's key", () => {
    new UserSettings().setFavoriteEmojis([null, flattenedEmojiTable[23]]);
    tileOwner = otherPlayer;
    eventBus.emit(new ShowEmojiMenuEvent(3, 4));

    eventBus.emit(new EmojiKeyEvent(1));

    expect(emojiIntents).toHaveLength(1);
    expect(emojiIntents[0].recipient).toBe(otherPlayer);
    expect(emojiIntents[0].emoji).toBe(23);
    expect(table.isVisible).toBe(false);
  });

  it("does nothing for an empty slot's key", () => {
    tileOwner = otherPlayer;
    eventBus.emit(new ShowEmojiMenuEvent(3, 4));

    eventBus.emit(new EmojiKeyEvent(0));

    expect(emojiIntents).toHaveLength(0);
    expect(table.isVisible).toBe(true);
  });

  describe("favorites drag and drop", () => {
    const drag = (el: Element, type: string) =>
      el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));

    async function open() {
      tileOwner = myPlayer;
      eventBus.emit(new ShowEmojiMenuEvent(3, 4));
      await table.updateComplete;
    }
    // The favorites are the first section.
    const slots = () => [
      ...table.querySelector("section")!.querySelectorAll("button"),
    ];
    const groupButton = (emoji: string) =>
      [...table.querySelectorAll(".grid button")].find(
        (b) => b.textContent!.trim() === emoji,
      )!;

    it("hides the key labels on touch-only devices", async () => {
      const realMatchMedia = window.matchMedia;
      window.matchMedia = (() => ({ matches: true })) as never;
      try {
        await open();
        expect(slots().every((s) => s.textContent!.trim() === "")).toBe(true);
        expect(table.textContent).toContain("emoji_table.favorites_hint_touch");
      } finally {
        window.matchMedia = realMatchMedia;
      }
    });

    it("starts with empty slots", async () => {
      await open();
      expect(slots()).toHaveLength(6);
      expect(slots().every((s) => s.textContent!.trim().length === 1)).toBe(
        true,
      );
    });

    it("saves an emoji dropped on a slot", async () => {
      await open();
      drag(groupButton("💀"), "dragstart");
      drag(slots()[2], "dragover");
      drag(slots()[2], "drop");
      drag(groupButton("💀"), "dragend");

      expect(new UserSettings().favoriteEmojis()[2]).toBe("💀");
      await table.updateComplete;
      expect(slots()[2].textContent).toContain("💀");
    });

    it("removes a favorite dragged off the slots", async () => {
      new UserSettings().setFavoriteEmojis(["👍"]);
      await open();
      drag(slots()[0], "dragstart");
      drag(slots()[0], "dragend");

      expect(new UserSettings().favoriteEmojis()[0]).toBeNull();
    });

    it("ignores a group emoji dropped outside the slots", async () => {
      await open();
      drag(groupButton("💀"), "dragstart");
      drag(groupButton("💀"), "dragend");

      expect(new UserSettings().favoriteEmojis().every((e) => !e)).toBe(true);
    });
  });

  it("ignores shortcut keys while closed", () => {
    eventBus.emit(new EmojiKeyEvent(0));
    expect(emojiIntents).toHaveLength(0);
  });

  it("announces when it opens and closes", () => {
    const visible: boolean[] = [];
    eventBus.on(EmojiTableVisibleEvent, (e) => visible.push(e.visible));
    tileOwner = myPlayer;

    eventBus.emit(new ShowEmojiMenuEvent(3, 4));
    eventBus.emit(new CloseViewEvent());

    expect(visible).toEqual([true, false]);
  });

  it("does not stay visible if coordinate validation fails", () => {
    table.game.isValidCoord = () => false;
    eventBus.emit(new ShowEmojiMenuEvent(999, 999));
    expect(table.isVisible).toBe(false);
  });
});
