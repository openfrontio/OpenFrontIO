import { EventBus } from "@openfront/shared/EventBus";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../../../../src/client/hud/layers/ChatModal";
import {
  ShowPlayerChatEvent,
  type ChatModal,
} from "../../../../src/client/hud/layers/ChatModal";
import { ShowChatMenuEvent } from "../../../../src/client/InputHandler";
import type { TransformHandler } from "../../../../src/client/TransformHandler";
import type { GameView } from "../../../../src/client/view";

describe("ChatModal quick chat shortcut", () => {
  let modal: ChatModal;
  let eventBus: EventBus;
  let open: ReturnType<typeof vi.fn<ChatModal["open"]>>;
  let close: ReturnType<typeof vi.fn<ChatModal["close"]>>;
  let alive: boolean;
  let tileOwner: object;
  const myPlayer = { isPlayer: () => true, isAlive: () => alive };
  const otherPlayer = { isPlayer: () => true };
  const unowned = { isPlayer: () => false };

  beforeEach(() => {
    alive = true;
    modal = document.createElement("chat-modal") as ChatModal;
    modal.g = {
      myPlayer: () => myPlayer,
      isValidCoord: () => true,
      ref: (x: number, y: number) => x + y,
      owner: () => tileOwner,
    } as unknown as GameView;
    modal.transformHandler = {
      screenToWorldCoordinates: (x: number, y: number) => ({ x, y }),
    } as unknown as TransformHandler;
    open = vi.fn<ChatModal["open"]>();
    modal.open = open;
    close = vi.fn<ChatModal["close"]>();
    modal.close = close;
    eventBus = new EventBus();
    modal.initEventBus(eventBus);
  });

  it("opens for the player under the cursor", () => {
    tileOwner = otherPlayer;
    eventBus.emit(new ShowChatMenuEvent(3, 4));
    expect(open).toHaveBeenCalledWith(myPlayer, otherPlayer);
  });

  it("does nothing over my own or unowned land", () => {
    tileOwner = myPlayer;
    eventBus.emit(new ShowChatMenuEvent(3, 4));
    tileOwner = unowned;
    eventBus.emit(new ShowChatMenuEvent(3, 4));
    expect(open).not.toHaveBeenCalled();
  });

  it("closes instead when the modal is already open", () => {
    modal.isOpen = true;
    tileOwner = otherPlayer;
    eventBus.emit(new ShowChatMenuEvent(3, 4));
    expect(close).toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it("opens for a given player from the player info panel", () => {
    eventBus.emit(new ShowPlayerChatEvent(otherPlayer as never));
    expect(open).toHaveBeenCalledWith(myPlayer, otherPlayer);
  });

  it("does nothing once I'm dead", () => {
    alive = false;
    tileOwner = otherPlayer;
    eventBus.emit(new ShowChatMenuEvent(3, 4));
    expect(open).not.toHaveBeenCalled();
  });
});
