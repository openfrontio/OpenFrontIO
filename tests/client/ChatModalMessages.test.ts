import { beforeEach, describe, expect, it, vi } from "vitest";
import "../../src/client/components/baseComponents/Modal";
import { OModal } from "../../src/client/components/baseComponents/Modal";
import { ChatIntegration } from "../../src/client/hud/layers/ChatIntegration";
import { ChatModal } from "../../src/client/hud/layers/ChatModal";
import { CloseViewEvent } from "../../src/client/InputHandler";
import { SendQuickChatEvent } from "../../src/client/Transport";
import type { GameView, PlayerView } from "../../src/client/view";
import { EventBus } from "../../src/core/EventBus";
import { PlayerType } from "../../src/core/game/Game";
import { UserSettings } from "../../src/core/game/UserSettings";

const language = vi.hoisted(() => ({ rtl: false }));

vi.mock("../../src/client/Utils", () => ({
  textDirection: () => (language.rtl ? "rtl" : "ltr"),
  translateText: (key: string) =>
    key === "chat.attack.attack"
      ? language.rtl
        ? "به [P1] حمله کنید!"
        : "Attack [P1]!"
      : key,
}));

function player(id: string): PlayerView {
  return {
    id: () => id,
    displayName: () => id,
    isAlive: () => true,
    type: () => PlayerType.Human,
    numTilesOwned: () => 10,
    territoryColor: () => ({ toHex: () => "#abcdef" }),
  } as unknown as PlayerView;
}

describe("Quick Chat panel", () => {
  let chat: ChatModal;
  let bus: EventBus;
  let send: ReturnType<typeof vi.fn<(event: SendQuickChatEvent) => void>>;
  let sender: PlayerView;
  let first: PlayerView;
  let second: PlayerView;
  let target: PlayerView;
  let game: GameView;

  beforeEach(async () => {
    language.rtl = false;
    sender = player("sender");
    first = player("first");
    second = player("second");
    target = player("target");
    game = {
      players: () => [sender, first, second, target],
      myPlayer: () => sender,
    } as unknown as GameView;
    bus = new EventBus();
    send = vi.fn();
    bus.on(SendQuickChatEvent, send);
    chat = new ChatModal();
    chat.g = game;
    document.body.append(chat);
    await chat.updateComplete;
    chat.initEventBus(bus);
  });

  const modal = () => chat.querySelector<OModal>("o-modal")!;
  const button = (selector: string) =>
    chat.querySelector<HTMLButtonElement>(selector)!;

  async function open(recipient = first) {
    chat.open(sender, recipient);
    await chat.updateComplete;
    await modal().updateComplete;
  }

  it("repeats the last phrase to the new recipient in one click", async () => {
    await open();
    expect(button(".chat-repeat-button").disabled).toBe(true);
    chat.openWithSelection("greet", "hello", sender, first);
    await chat.updateComplete;
    button(".chat-send-button").click();
    await open(second);
    button(".chat-repeat-button").click();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0]).toEqual(
      new SendQuickChatEvent(second, "greet.hello", undefined),
    );
    expect(modal().isModalOpen).toBe(false);
  });

  it("requires a fresh player selection and never carries a target to a simple phrase", async () => {
    chat.openWithSelection("attack", "attack", sender, first);
    await chat.updateComplete;
    expect(button(".chat-send-button").disabled).toBe(true);
    const targetButton = [
      ...chat.querySelectorAll<HTMLButtonElement>(".player-scroll-area button"),
    ].find((b) => b.textContent?.trim() === "target")!;
    targetButton.click();
    await chat.updateComplete;
    expect(button(".chat-send-button").disabled).toBe(false);
    expect(chat.querySelector(".chat-preview")?.textContent?.trim()).toBe(
      "Attack target!",
    );
    button(".chat-send-button").click();
    await open(second);
    button(".chat-repeat-button").click();
    expect(send.mock.calls[1][0]).toEqual(
      new SendQuickChatEvent(second, "attack.attack", "target"),
    );
    chat.openWithSelection("attack", "attack", sender, second);
    await chat.updateComplete;
    expect(button(".chat-send-button").disabled).toBe(true);
    chat.openWithSelection("greet", "hello", sender, second);
    await chat.updateComplete;
    button(".chat-send-button").click();
    expect(send.mock.calls[2][0]).toEqual(
      new SendQuickChatEvent(second, "greet.hello", undefined),
    );
  });

  it("remembers messages sent from the radial menu", async () => {
    const integration = new ChatIntegration(game);
    const category = integration
      .createQuickChatMenu(first)
      .find((c) => c.id === "chat-category-greet")!;
    const phrase = category.subMenu!({} as never).find(
      (p) => p.id === "phrase-greet-hello",
    )!;
    phrase.action!({} as never);
    await open(second);
    button(".chat-repeat-button").click();
    expect(send.mock.calls[1][0]).toEqual(
      new SendQuickChatEvent(second, "greet.hello", undefined),
    );
  });

  it("disables repeat when the referenced player is no longer alive", async () => {
    chat.sendQuickChat(sender, first, "attack.attack", "target");
    vi.spyOn(target, "isAlive").mockReturnValue(false);
    await open(second);
    expect(button(".chat-repeat-button").disabled).toBe(true);
  });

  it("clears draft state on close and message history for a new game", async () => {
    chat.sendQuickChat(sender, first, "greet.hello");
    chat.openWithSelection("attack", "attack", sender, first);
    await chat.updateComplete;
    modal().close();
    await open(second);
    expect(button(".chat-send-button").disabled).toBe(true);
    expect(button(".chat-repeat-button").disabled).toBe(false);
    bus.emit(new CloseViewEvent());
    expect(modal().isModalOpen).toBe(false);
    chat.initEventBus(new EventBus());
    await open();
    expect(button(".chat-repeat-button").disabled).toBe(true);
  });

  it("refreshes direction and the selected phrase when the language changes", async () => {
    chat.openWithSelection("attack", "attack", sender, first);
    await chat.updateComplete;
    [...chat.querySelectorAll<HTMLButtonElement>(".player-scroll-area button")]
      .find((b) => b.textContent?.trim() === "target")!
      .click();
    language.rtl = true;
    chat.requestUpdate();
    await chat.updateComplete;
    expect(modal().dir).toBe("rtl");
    expect(chat.querySelector(".chat-preview")?.textContent?.trim()).toBe(
      "به target حمله کنید!",
    );
  });

  it("applies stored opacity to the compact modal", async () => {
    const settings = new UserSettings();
    settings.setQuickChatOpacity(0.45);
    await open();
    expect(modal().compact).toBe(true);
    expect(
      modal().style.getPropertyValue("--modal-background-opacity").trim(),
    ).toBe("0.45");
    settings.removeCached("settings.quickChatOpacity", false);
  });
});
