import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AlternateViewEvent,
  InputHandler,
} from "../../src/client/InputHandler";
import type { GameView } from "../../src/client/view";
import { EventBus } from "../../src/core/EventBus";
import { KEYBINDS_KEY, UserSettings } from "../../src/core/game/UserSettings";

// The settings modal is reachable in-game now, so the keybind editor captures
// key presses over a live game. SettingKeybind calls preventDefault() but not
// stopPropagation(), so without a guard, binding a key would also perform the
// action that key is currently bound to.
describe("keybind capture over a live game", () => {
  let inputHandler: InputHandler;
  let eventBus: EventBus;
  let emitted: unknown[];

  beforeEach(() => {
    new UserSettings().removeCached(KEYBINDS_KEY, false);
    document.body.innerHTML = "";

    const gameView = {
      inSpawnPhase: () => false,
      myPlayer: () => ({ isAlive: () => true }),
    } as unknown as GameView;

    eventBus = new EventBus();
    emitted = [];
    vi.spyOn(eventBus, "emit").mockImplementation((e) => {
      emitted.push(e);
    });

    inputHandler = new InputHandler(
      gameView,
      {
        attackRatio: 20,
        ghostStructure: null,
        rocketDirectionUp: true,
        upgradeMultiplier: 1,
      },
      document.createElement("canvas"),
      eventBus,
    );
    inputHandler.initialize();
  });

  afterEach(() => {
    inputHandler.destroy();
    new UserSettings().removeCached(KEYBINDS_KEY, false);
    vi.restoreAllMocks();
  });

  function press(target: EventTarget, code: string) {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { code, key: code, bubbles: true }),
    );
  }

  function pressToggleView(target: EventTarget) {
    press(target, "Space");
  }

  const alternateViewEvents = () =>
    emitted.filter((e) => e instanceof AlternateViewEvent);

  it("does not act on a key captured by the keybind editor", () => {
    const keybind = document.createElement("setting-keybind");
    const button = document.createElement("div");
    button.setAttribute("role", "button");
    keybind.appendChild(button);
    document.body.appendChild(keybind);

    pressToggleView(button);

    expect(alternateViewEvents()).toEqual([]);
  });

  it("still acts on the same key pressed outside the editor", () => {
    const other = document.createElement("div");
    document.body.appendChild(other);

    pressToggleView(other);

    expect(alternateViewEvents()).toHaveLength(1);
  });

  it("picks up a keybind rebound mid-match", () => {
    // The dispatch table is built once per game, so without a listener a key
    // rebound from the in-game Keybinds tab would not take effect until the
    // next game.
    const other = document.createElement("div");
    document.body.appendChild(other);

    new UserSettings().setKeybinds({ toggleView: { value: "KeyV", key: "V" } });

    press(other, "KeyV");
    expect(alternateViewEvents()).toHaveLength(1);

    // ...and the old binding stops acting.
    pressToggleView(other);
    expect(alternateViewEvents()).toHaveLength(1);
  });

  it("stops following rebinds once the handler is destroyed", () => {
    const other = document.createElement("div");
    document.body.appendChild(other);
    inputHandler.destroy();

    new UserSettings().setKeybinds({ toggleView: { value: "KeyV", key: "V" } });

    press(other, "KeyV");
    expect(alternateViewEvents()).toEqual([]);
  });
});
