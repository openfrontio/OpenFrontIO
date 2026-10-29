import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { EventBus } from "@openfront/shared/EventBus";
import { describe, expect, test, vi } from "vitest";
import "../../src/client/hud/layers/UnitDisplay";
import type { UnitDisplay } from "../../src/client/hud/layers/UnitDisplay";

function makeDisplay(ghostStructure: UnitType | null = null) {
  const player = {
    gold: () => 1000n,
    isAlive: () => true,
    units: () => [],
  };
  const inputHandler = { setGhostStructure: vi.fn() };
  const display = document.createElement("unit-display") as UnitDisplay;
  display.game = {
    myPlayer: () => player,
    inSpawnPhase: () => false,
    config: () => ({ isUnitDisabled: () => false }),
  } as any;
  display.eventBus = new EventBus();
  display.inputHandler = inputHandler as any;
  display.uiState = { ghostStructure, upgradeMultiplier: 1 } as any;
  document.body.appendChild(display);
  display.requestUpdate();
  return { display, inputHandler };
}

describe("mobile UnitDisplay layout", () => {
  test("keeps the quick-build items in one horizontally scrollable row", async () => {
    const { display } = makeDisplay();
    try {
      await display.updateComplete;

      const scroller = display.querySelector(".unit-display-scroll");
      const grid = scroller?.querySelector(".unit-display-grid");
      expect(scroller).not.toBeNull();
      expect(scroller?.classList.contains("touch-pan-x")).toBe(true);
      expect(scroller?.classList.contains("lg:overflow-visible")).toBe(true);
      expect(grid?.classList.contains("max-lg:landscape:grid-flow-col")).toBe(
        true,
      );
      expect(
        grid?.classList.contains("max-lg:landscape:auto-cols-[47px]"),
      ).toBe(true);
      expect(grid?.classList.contains("max-[360px]:grid-flow-col")).toBe(true);
      expect(grid?.classList.contains("max-[360px]:auto-cols-[44px]")).toBe(
        true,
      );
      expect(grid?.children).toHaveLength(10);
    } finally {
      display.remove();
    }
  });

  test("desktop hover tooltips render outside the horizontal scroller", async () => {
    const { display } = makeDisplay();
    try {
      await display.updateComplete;
      const scroller = display.querySelector(".unit-display-scroll");
      const cityItem = display.querySelector(".unit-display-grid")
        ?.firstElementChild as HTMLElement | null;
      cityItem?.dispatchEvent(new MouseEvent("mouseenter"));
      await display.updateComplete;

      const tooltip = display.querySelector(".unit-display-tooltip");
      expect(tooltip).not.toBeNull();
      expect(scroller?.contains(tooltip)).toBe(false);
    } finally {
      display.remove();
    }
  });

  test("tapping the selected item requests cancellation", async () => {
    const { display, inputHandler } = makeDisplay(UnitType.City);
    try {
      await display.updateComplete;
      const cityItem = display.querySelector(".grid")?.children[0] as
        | HTMLElement
        | undefined;
      const cityButton = cityItem?.children[0] as HTMLElement | undefined;

      expect(cityButton).toBeDefined();
      cityButton!.click();

      expect(inputHandler.setGhostStructure).toHaveBeenCalledWith(
        null,
        "GUIclick",
      );
    } finally {
      display.remove();
    }
  });
});
