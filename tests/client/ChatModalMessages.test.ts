import { beforeEach, describe, expect, it, vi } from "vitest";
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

  const panel = () => chat.querySelector<HTMLElement>(".chat-panel")!;
  const button = (selector: string) =>
    chat.querySelector<HTMLButtonElement>(selector)!;

  async function open(recipient = first) {
    chat.open(sender, recipient);
    await chat.updateComplete;
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
    expect(chat.isModalOpen).toBe(false);
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
    button(".chat-close-button").click();
    await open(second);
    expect(button(".chat-send-button").disabled).toBe(true);
    expect(button(".chat-repeat-button").disabled).toBe(false);
    bus.emit(new CloseViewEvent());
    expect(chat.isModalOpen).toBe(false);
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
    expect(panel().dir).toBe("rtl");
    expect(chat.querySelector(".chat-preview")?.textContent?.trim()).toBe(
      "به target حمله کنید!",
    );
  });

  it("renders only while open, focuses the panel, and closes with Escape", async () => {
    expect(panel()).toBeNull();
    await open();
    expect(document.activeElement).toBe(panel());
    expect(panel().getAttribute("role")).toBe("dialog");
    panel().dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await chat.updateComplete;
    expect(chat.isModalOpen).toBe(false);
    expect(panel()).toBeNull();
  });

  function focusOpener() {
    const opener = document.createElement("button");
    opener.textContent = "Open chat";
    vi.spyOn(opener, "getClientRects").mockReturnValue([
      new DOMRect(0, 0, 40, 40),
    ] as unknown as DOMRectList);
    document.body.append(opener);
    opener.focus();
    return opener;
  }

  function mapFocusTarget() {
    const map = document.createElement("div");
    map.id = "game-input-overlay";
    map.tabIndex = -1;
    document.body.append(map);
    return map;
  }

  it.each(["close button", "Escape", "send", "repeat", "CloseViewEvent"])(
    "restores opener focus after %s",
    async (path) => {
      const opener = focusOpener();
      chat.sendQuickChat(sender, first, "greet.hello");
      chat.openWithSelection("greet", "hello", sender, first);
      await chat.updateComplete;
      expect(document.activeElement).toBe(panel());
      if (path === "Escape") {
        panel().dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
      } else if (path === "CloseViewEvent") {
        bus.emit(new CloseViewEvent());
      } else {
        const selector =
          path === "send"
            ? ".chat-send-button"
            : path === "repeat"
              ? ".chat-repeat-button"
              : ".chat-close-button";
        button(selector).focus();
        button(selector).click();
      }
      await chat.updateComplete;
      expect(chat.isModalOpen).toBe(false);
      expect(document.activeElement).toBe(opener);
    },
  );

  it.each(["removed", "hidden", "disabled", "body"])(
    "returns focus to the map when the opener is %s",
    async (state) => {
      const map = mapFocusTarget();
      const opener = state === "body" ? null : focusOpener();
      await open();
      if (state === "removed") opener!.remove();
      if (state === "hidden") opener!.hidden = true;
      if (state === "disabled") opener!.disabled = true;
      chat.close();
      await chat.updateComplete;
      expect(document.activeElement).toBe(map);
    },
  );

  it("does not steal focus from another HUD control on external close", async () => {
    focusOpener();
    await open();
    const other = document.createElement("button");
    document.body.append(other);
    other.focus();
    bus.emit(new CloseViewEvent());
    await chat.updateComplete;
    expect(document.activeElement).toBe(other);
  });

  it("applies stored opacity to the independent panel", async () => {
    const settings = new UserSettings();
    settings.setQuickChatOpacity(0.45);
    await open();
    expect(chat.querySelector("o-modal")).toBeNull();
    expect(
      panel().style.getPropertyValue("--chat-background-opacity").trim(),
    ).toBe("0.45");
    settings.removeCached("settings.quickChatOpacity", false);
  });
});
