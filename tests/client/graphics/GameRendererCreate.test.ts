import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// GameRenderer only uses GameStartingModal as a type, so importing it there
// never registers the custom element; register it here.
import { EventBus } from "@openfront/shared/EventBus";
import type { Controller } from "../../../src/client/Controller";
import "../../../src/client/GameStartingModal";
import {
  createRenderer,
  GameRenderer,
} from "../../../src/client/hud/GameRenderer";
import type { AttacksDisplay } from "../../../src/client/hud/layers/AttacksDisplay";
import type { EmojiTable } from "../../../src/client/hud/layers/EmojiTable";
import type { EventsDisplay } from "../../../src/client/hud/layers/EventsDisplay";
import type { PlayerInfoOverlay } from "../../../src/client/hud/layers/PlayerInfoOverlay";
import { SpawnBarVisibleEvent } from "../../../src/client/hud/layers/SpawnTimer";
import type { WinModal } from "../../../src/client/hud/layers/WinModal";
import { ShowEmojiMenuEvent } from "../../../src/client/InputHandler";
import type { MapRenderer } from "../../../src/client/render/gl";
import type { GameView } from "../../../src/client/view";

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
  "onboarding-overlay",
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
      mapNationCount: () => 0,
      width: () => 100,
      height: () => 100,
      isValidCoord: () => true,
      ref: () => 1,
      hasOwner: () => true,
      owner: () => ({}),
      myPlayer: () => ({}),
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

  it("cleans up window resize listener on dispose", () => {
    const renderer = new GameRenderer(
      { updateCanvasBoundingRect: vi.fn(), centerAll: vi.fn() } as any,
      {} as any,
      [],
      {} as any,
    );
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");
    renderer.initialize();
    const resizeListener = addSpy.mock.calls.find(
      ([type]) => type === "resize",
    )?.[1];
    expect(resizeListener).toEqual(expect.any(Function));
    renderer.dispose();
    expect(removeSpy).toHaveBeenCalledWith("resize", resizeListener);
  });

  it("calls dispose() on all layers that implement it when renderer is disposed", () => {
    const layerWithDispose1: Controller = { dispose: vi.fn() };
    const layerWithDispose2: Controller = {
      init: vi.fn(),
      tick: vi.fn(),
      dispose: vi.fn(),
    };
    const layerWithoutDispose: Controller = { tick: vi.fn() };

    const renderer = new GameRenderer(
      {
        updateCanvasBoundingRect: vi.fn(),
        centerAll: vi.fn(),
        observeCanvasSize: () => ({ disconnect: vi.fn() }),
      } as never,
      {} as never,
      [layerWithDispose1, layerWithDispose2, layerWithoutDispose],
      {} as never,
    );

    renderer.dispose();

    expect(layerWithDispose1.dispose).toHaveBeenCalledTimes(1);
    expect(layerWithDispose2.dispose).toHaveBeenCalledTimes(1);
  });

  it("continues disposing remaining layers if one layer's dispose() throws", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const throwingLayer: Controller = {
      dispose: vi.fn(() => {
        throw new Error("boom");
      }),
    };
    const healthyLayer: Controller = { dispose: vi.fn() };

    const renderer = new GameRenderer(
      {
        updateCanvasBoundingRect: vi.fn(),
        centerAll: vi.fn(),
        observeCanvasSize: () => ({ disconnect: vi.fn() }),
      } as never,
      {} as never,
      [throwingLayer, healthyLayer],
      {} as never,
    );

    expect(() => renderer.dispose()).not.toThrow();
    expect(throwingLayer.dispose).toHaveBeenCalledTimes(1);
    expect(healthyLayer.dispose).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it("skips disposing uninitialized singleton layers created by createRenderer", () => {
    const eventBus = new EventBus();
    const game = {
      layers: () => [],
      mapNationCount: () => 0,
      width: () => 100,
      height: () => 100,
      isValidCoord: () => true,
      ref: () => 1,
      hasOwner: () => true,
      owner: () => ({}),
      myPlayer: () => ({}),
      config: () => ({
        gameConfig: () => ({}),
        isReplay: () => false,
      }),
    } as unknown as GameView;
    const playerInfo = elements.get("player-info-overlay") as PlayerInfoOverlay;
    const disposeSpy = vi.spyOn(playerInfo, "dispose");

    const renderer = createRenderer(
      document.createElement("div"),
      game,
      eventBus,
      null,
      {} as MapRenderer,
    );
    renderer.dispose();

    expect(disposeSpy).not.toHaveBeenCalled();
  });

  it("keeps shared singleton PlayerInfoOverlay active for Runner B when Runner A disposes", () => {
    const overlay = document.createElement(
      "player-info-overlay",
    ) as PlayerInfoOverlay;
    overlay.game = {
      config: () => ({ gameConfig: () => ({}), isReplay: () => false }),
    } as never;
    const busA = new EventBus();
    const busB = new EventBus();
    const onBSpy = vi.spyOn(busB, "on");
    const offBSpy = vi.spyOn(busB, "off");

    const makeTransform = () =>
      ({
        updateCanvasBoundingRect: vi.fn(),
        centerAll: vi.fn(),
        observeCanvasSize: () => ({ disconnect: vi.fn() }),
      }) as never;

    const singletons = new Set<Controller>([overlay]);
    const rendererA = new GameRenderer(
      makeTransform(),
      {} as never,
      [overlay],
      {} as never,
      singletons,
    );
    const rendererB = new GameRenderer(
      makeTransform(),
      {} as never,
      [overlay],
      {} as never,
      singletons,
    );
    const uninitRendererA = new GameRenderer(
      makeTransform(),
      {} as never,
      [overlay],
      {} as never,
      singletons,
    );

    overlay.eventBus = busA;
    rendererA.initialize();

    overlay.eventBus = busB;
    rendererB.initialize();

    // Disposing both an initialized-earlier Renderer A and an uninitialized Renderer A
    // must leave Runner B's active overlay and busB subscriptions intact.
    rendererA.dispose();
    uninitRendererA.dispose();

    expect(overlay["_isActive"]).toBe(true);
    expect(offBSpy).not.toHaveBeenCalled();
    busB.emit(new SpawnBarVisibleEvent(true));
    expect(overlay["spawnBarVisible"]).toBe(true);

    rendererB.dispose();
    expect(onBSpy.mock.calls.length).toBeGreaterThan(0);
    expect(offBSpy).toHaveBeenCalledTimes(onBSpy.mock.calls.length);
    expect(overlay["_isActive"]).toBe(false);
  });

  it("disposes singleton EventsDisplay and AttacksDisplay after initialize while protecting Runner B", () => {
    const eventsDisplay = document.createElement(
      "events-display",
    ) as EventsDisplay;
    const attacksDisplay = document.createElement(
      "attacks-display",
    ) as AttacksDisplay;
    const busA = new EventBus();
    const busB = new EventBus();
    const offASpy = vi.spyOn(busA, "off");
    const offBSpy = vi.spyOn(busB, "off");
    const eventsDisposeSpy = vi.spyOn(eventsDisplay, "dispose");
    const attacksDisposeSpy = vi.spyOn(attacksDisplay, "dispose");

    const makeTransform = () =>
      ({
        updateCanvasBoundingRect: vi.fn(),
        centerAll: vi.fn(),
        observeCanvasSize: () => ({ disconnect: vi.fn() }),
      }) as never;

    const layers: Controller[] = [eventsDisplay, attacksDisplay];
    const singletons = new Set<Controller>(layers);
    const rendererA = new GameRenderer(
      makeTransform(),
      {} as never,
      layers,
      {} as never,
      singletons,
    );
    const rendererB = new GameRenderer(
      makeTransform(),
      {} as never,
      layers,
      {} as never,
      singletons,
    );

    eventsDisplay.eventBus = busA;
    rendererA.initialize();

    // Runner B takes ownership of the reused singleton elements
    eventsDisplay.eventBus = busB;
    rendererB.initialize();
    expect(offASpy).toHaveBeenCalledTimes(1);

    // Stale Runner A disposal must not dispose Runner B's layers
    rendererA.dispose();
    expect(eventsDisposeSpy).not.toHaveBeenCalled();
    expect(attacksDisposeSpy).not.toHaveBeenCalled();
    expect(offBSpy).not.toHaveBeenCalled();

    // Active Runner B disposal must dispose both singletons and unsubscribe busB
    rendererB.dispose();
    expect(eventsDisposeSpy).toHaveBeenCalledTimes(1);
    expect(attacksDisposeSpy).toHaveBeenCalledTimes(1);
    expect(offBSpy).toHaveBeenCalledTimes(1);
  });
});
