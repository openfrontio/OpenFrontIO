import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock BuildMenu to avoid importing lit and other ESM-heavy deps in this unit test
vi.mock("../../../src/client/hud/layers/BuildMenu", () => ({
  BuildMenu: class {},
  flattenedBuildTable: [],
}));

// Mock Utils to avoid touching DOM (document) during tests
vi.mock("../../../src/client/Utils", () => ({
  translateText: (key: string) => key,
  renderNumber: (num: number) => num.toString(),
  getSvgAspectRatio: () => Promise.resolve(1),
}));

import { RadialMenu } from "../../../src/client/hud/layers/RadialMenu";
import {
  centerButtonElement,
  MenuElementParams,
  rootMenuElement,
} from "../../../src/client/hud/layers/RadialMenuElements";
import { EventBus } from "../../../src/core/EventBus";
import { TileRef } from "../../../src/core/game/GameMap";

describe("RadialMenu center button - spawn phase", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  function setup() {
    const eventBus = new EventBus();
    const menu = new RadialMenu(eventBus, rootMenuElement, centerButtonElement);
    menu.init();

    const tile = 42 as TileRef;
    const handleSpawn = vi.fn();
    const handleAttack = vi.fn();
    const closeMenu = vi.fn();

    const params = {
      tile,
      game: {
        inSpawnPhase: () => true,
        owner: () => ({ isPlayer: () => false, isNation: () => false }),
        hasStructure: () => false,
        findTargetableBuilding: () => null,
        isLand: () => true,
        config: () => ({ isRandomSpawn: () => false }),
      },
      playerActionHandler: { handleSpawn, handleAttack },
      playerActions: {
        interaction: {},
        buildableUnits: [],
      },
      closeMenu,
      selected: null,
    } as unknown as MenuElementParams;

    menu.setParams(params);
    return { menu, handleSpawn, handleAttack, closeMenu };
  }

  it("clicking the center button during the spawn phase spawns on the tile", () => {
    const { menu, handleSpawn, handleAttack } = setup();
    menu.showRadialMenu(100, 100);

    // Advance time past synthetic click guard (250ms)
    vi.advanceTimersByTime(300);

    const btn = document.body.querySelector(".center-button-hitbox");
    expect(btn).not.toBeNull();

    // Simulating center button click
    btn!.dispatchEvent(
      new PointerEvent("click", { pointerType: "mouse", bubbles: true }),
    );

    expect(handleSpawn).toHaveBeenCalledExactlyOnceWith(42);
    expect(handleAttack).not.toHaveBeenCalled();
  });

  it("guards against synthetic clicks immediately after opening", () => {
    const { menu, handleSpawn } = setup();
    menu.showRadialMenu(100, 100);

    const btn = document.body.querySelector(".center-button-hitbox");

    // A synthetic click (like a touch converted to click) right away should be ignored
    btn!.dispatchEvent(new Event("click", { bubbles: true }));
    expect(handleSpawn).not.toHaveBeenCalled();

    // After 300ms, it is allowed
    vi.advanceTimersByTime(300);
    btn!.dispatchEvent(new Event("click", { bubbles: true }));
    expect(handleSpawn).toHaveBeenCalled();
  });
});
