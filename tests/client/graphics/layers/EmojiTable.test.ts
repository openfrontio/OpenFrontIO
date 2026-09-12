import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "../../../../src/client/hud/layers/EmojiTable";
import type { EmojiTable } from "../../../../src/client/hud/layers/EmojiTable";
import {
  CloseViewEvent,
  ShowEmojiMenuEvent,
} from "../../../../src/client/InputHandler";
import type { TransformHandler } from "../../../../src/client/TransformHandler";
import { SendEmojiIntentEvent } from "../../../../src/client/Transport";
import type { GameView } from "../../../../src/client/view";
import { EventBus } from "../../../../src/core/EventBus";
import { AllPlayers } from "../../../../src/core/game/Game";
import { flattenedEmojiTable } from "../../../../src/core/Util";

describe("EmojiTable event bus wiring", () => {
  let table: EmojiTable;
  let eventBus: EventBus;
  let emojiIntents: SendEmojiIntentEvent[];
  const myPlayer = { name: "me" };
  const otherPlayer = { name: "other" };
  let tileOwner: object;

  beforeEach(() => {
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

  async function pickEmoji(index: number) {
    await table.updateComplete;
    const buttons = table.querySelectorAll<HTMLButtonElement>(".grid button");
    expect(buttons.length).toBe(flattenedEmojiTable.length);
    buttons[index].click();
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
});
