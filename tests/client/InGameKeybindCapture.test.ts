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
    vi.restoreAllMocks();
  });

  function pressToggleView(target: EventTarget) {
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        code: "Space",
        key: " ",
        bubbles: true,
      }),
    );
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
});
