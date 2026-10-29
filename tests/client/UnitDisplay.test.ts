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

  test("the build bar opts into radial-menu click-through", async () => {
    const { display } = makeDisplay();
    try {
      await display.updateComplete;

      const root = display.querySelector(".unit-display-root");
      expect(root?.hasAttribute("data-radial-click-through")).toBe(true);
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
      // A mouse shows the tooltip at any width; a touch device does not.
      expect(tooltip?.classList.contains("pointer-fine:block")).toBe(true);
      expect(tooltip?.classList.contains("lg:block")).toBe(false);
    } finally {
      display.remove();
    }
  });

  test("the tooltip is placed from the item's rectangle", async () => {
    const { display } = makeDisplay();
    try {
      await display.updateComplete;
      const root = display.querySelector(".unit-display-root") as HTMLElement;
      const cityItem = display.querySelector(".unit-display-grid")
        ?.firstElementChild as HTMLElement | null;
      root.getBoundingClientRect = () => ({ left: 10, top: 100 }) as DOMRect;
      cityItem!.getBoundingClientRect = () =>
        ({ left: 60, top: 140, width: 40 }) as DOMRect;
      cityItem!.dispatchEvent(new MouseEvent("mouseenter"));
      await display.updateComplete;

      const tooltip = display.querySelector(
        ".unit-display-tooltip",
      ) as HTMLElement;
      // Centred on the item, a little above it, relative to the bar.
      expect(tooltip.style.left).toBe("70px");
      expect(tooltip.style.top).toBe("36px");
    } finally {
      display.remove();
    }
  });

  test("fades the edge that still hides actions", async () => {
    const { display } = makeDisplay();
    try {
      await display.updateComplete;
      const root = display.querySelector(".unit-display-root") as HTMLElement;
      const scroller = display.querySelector(
        ".unit-display-scroll",
      ) as HTMLElement;
      Object.defineProperty(scroller, "scrollWidth", {
        value: 500,
        configurable: true,
      });
      Object.defineProperty(scroller, "clientWidth", {
        value: 200,
        configurable: true,
      });
      Object.defineProperty(scroller, "scrollLeft", {
        value: 0,
        configurable: true,
      });

      scroller.dispatchEvent(new Event("scroll"));
      await display.updateComplete;

      expect(root.classList.contains("unit-display-more-right")).toBe(true);
      expect(root.classList.contains("unit-display-more-left")).toBe(false);

      Object.defineProperty(scroller, "scrollLeft", {
        value: 300,
        configurable: true,
      });
      scroller.dispatchEvent(new Event("scroll"));
      await display.updateComplete;

      expect(root.classList.contains("unit-display-more-right")).toBe(false);
      expect(root.classList.contains("unit-display-more-left")).toBe(true);
    } finally {
      display.remove();
    }
  });

  test("does not fade an edge when every action fits", async () => {
    const { display } = makeDisplay();
    try {
      await display.updateComplete;
      const root = display.querySelector(".unit-display-root") as HTMLElement;
      const scroller = display.querySelector(
        ".unit-display-scroll",
      ) as HTMLElement;
      Object.defineProperty(scroller, "scrollWidth", {
        value: 200,
        configurable: true,
      });
      Object.defineProperty(scroller, "clientWidth", {
        value: 200,
        configurable: true,
      });

      scroller.dispatchEvent(new Event("scroll"));
      await display.updateComplete;

      expect(root.classList.contains("unit-display-more-right")).toBe(false);
      expect(root.classList.contains("unit-display-more-left")).toBe(false);
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
