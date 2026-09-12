import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// GameRenderer only uses GameStartingModal as a type, so importing it there
// never registers the custom element; register it here.
import "../../../src/client/GameStartingModal";
import {
  createRenderer,
  GameRenderer,
} from "../../../src/client/hud/GameRenderer";
import type { EmojiTable } from "../../../src/client/hud/layers/EmojiTable";
import type { WinModal } from "../../../src/client/hud/layers/WinModal";
import { ShowEmojiMenuEvent } from "../../../src/client/InputHandler";
import type { MapRenderer } from "../../../src/client/render/gl";
import type { GameView } from "../../../src/client/view";
import { EventBus } from "../../../src/core/EventBus";

// Every custom element createRenderer looks up with document.querySelector.
const HUD_TAGS = [
  "game-starting-modal",
  "emoji-table",
  "build-menu",
  "game-left-sidebar",
  "control-panel",
  "events-display",
  "actionable-events",
  "attacks-display",
  "chat-display",
  "player-info-overlay",
  "win-modal",
  "new-lobby-prompt",
  "replay-panel",
  "game-right-sidebar",
  "settings-modal",
  "graphics-settings-modal",
  "unit-display",
  "player-panel",
  "chat-modal",
  "multi-tab-modal",
  "heads-up-message",
  "performance-overlay",
  "alert-frame",
  "spawn-timer",
  "immunity-timer",
  "in-game-promo",
  "tutorial-panel",
] as const;

describe("createRenderer", () => {
  // Serve detached elements from the spy so createRenderer finds each HUD
  // component without connecting (and rendering) 27 components in jsdom.
  const elements = new Map<string, HTMLElement>();

  beforeEach(() => {
    elements.clear();
    for (const tag of HUD_TAGS) {
      elements.set(tag, document.createElement(tag));
    }
    const original = document.querySelector.bind(document);
    vi.spyOn(document, "querySelector").mockImplementation(
      (selector: string) => elements.get(selector) ?? original(selector),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("wires the HUD components and returns a renderer", () => {
    const eventBus = new EventBus();
    const game = {
      layers: () => [],
      width: () => 100,
      height: () => 100,
      isValidCoord: () => false,
      config: () => ({
        gameConfig: () => ({}),
        isReplay: () => false,
      }),
    } as unknown as GameView;
    const view = {} as MapRenderer;
    const inputEl = document.createElement("div");

    const renderer = createRenderer(inputEl, game, eventBus, null, view);

    expect(renderer).toBeInstanceOf(GameRenderer);
    expect(renderer.transformHandler).toBeDefined();

    // Win modal wiring (fed by the shared bus and game view).
    const winModal = elements.get("win-modal") as WinModal;
    expect(winModal.eventBus).toBe(eventBus);
    expect(winModal.game).toBe(game);

    // Emoji table got its own initEventBus: opening the menu reaches it.
    const emojiTable = elements.get("emoji-table") as EmojiTable;
    expect(emojiTable.game).toBe(game);
    eventBus.emit(new ShowEmojiMenuEvent(1, 1));
    expect(emojiTable.isVisible).toBe(true);
  });
});
