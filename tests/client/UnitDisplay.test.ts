import {
  BuildMenus,
  PlayerBuildableUnitType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { EventBus } from "@openfront/shared/EventBus";
import { describe, expect, test, vi } from "vitest";
import type { UnitDisplay } from "../../src/client/hud/layers/UnitDisplay";
import "../../src/client/hud/layers/UnitDisplay";
import {
  FORWARDED_TOUCH_CLICK,
  ToggleStructureEvent,
  TouchGhostPlacementSelectEvent,
} from "../../src/client/InputHandler";

function makeDisplay(
  ghostStructure: UnitType | null = null,
  disabledUnits: UnitType[] = [],
  tutorial = false,
  hasMissileSilo = false,
) {
  const player = {
    gold: () => 1000n,
    isAlive: () => true,
    units: (unitType: UnitType) =>
      hasMissileSilo && unitType === UnitType.MissileSilo ? [{}] : [],
  };
  const eventBus = new EventBus();
  const display = document.createElement("unit-display") as UnitDisplay;
  const inputHandler = {
    setGhostStructure: vi.fn((unitType: PlayerBuildableUnitType | null) => {
      if (display.uiState.ghostStructure !== null && unitType === null) {
        eventBus.emit(new ToggleStructureEvent(null));
      }
      display.uiState.ghostStructure = unitType;
    }),
  };
  display.game = {
    myPlayer: () => player,
    inSpawnPhase: () => false,
    config: () => ({
      isUnitDisabled: (unitType: UnitType) => disabledUnits.includes(unitType),
      gameConfig: () => ({ tutorial }),
    }),
  } as any;
  display.eventBus = eventBus;
  display.inputHandler = inputHandler as any;
  display.uiState = { ghostStructure, upgradeMultiplier: 1 } as any;
  if (tutorial) display.classList.add("hidden");
  display.init();
  document.body.appendChild(display);
  display.requestUpdate();
  return { display, inputHandler, eventBus };
}

/**
 * Platform.hasKeyboard reports no keyboard on a touch device that has not
 * typed yet. jsdom answers every media query with "no match", so the coarse
 * pointer has to be faked for the touch case.
 */
async function withCoarsePointer(run: () => void | Promise<void>) {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: query.includes("pointer: coarse"),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  try {
    await run();
  } finally {
    window.matchMedia = original;
  }
}

function dispatchTouch(target: EventTarget, type: string, identifier: number) {
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, "changedTouches", {
    value: [{ identifier, clientX: 10, clientY: 10 }],
  });
  target.dispatchEvent(event);
}

describe("mobile UnitDisplay layout", () => {
  test("keeps the quick-build items in one horizontally scrollable row", async () => {
    const { display } = makeDisplay();
    try {
      await display.updateComplete;

      const scroller = display.querySelector(".unit-display-scroll");
      const grid = scroller?.querySelector<HTMLElement>(".unit-display-grid");
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
      expect(grid?.style.getPropertyValue("--unit-display-columns")).toBe("10");
    } finally {
      display.remove();
    }
  });

  test("portrait grid uses only the visible build buttons", async () => {
    const { display } = makeDisplay(null, [UnitType.City]);
    try {
      await display.updateComplete;

      const grid = display.querySelector<HTMLElement>(".unit-display-grid");
      expect(grid?.children).toHaveLength(BuildMenus.types.length - 1);
      expect(grid?.style.getPropertyValue("--unit-display-columns")).toBe(
        String(BuildMenus.types.length - 1),
      );
      expect(grid?.classList.contains("lg:grid-cols-none")).toBe(true);
      expect(grid?.classList.contains("lg:auto-cols-max")).toBe(true);
    } finally {
      display.remove();
    }
  });

  test("tutorial shows only enabled atom button after silo is captured", async () => {
    const { display } = makeDisplay(null, [], true, true);
    try {
      await display.updateComplete;

      const grid = display.querySelector<HTMLElement>(".unit-display-grid");
      expect(display.classList.contains("hidden")).toBe(false);
      expect(grid?.children).toHaveLength(1);
      expect(grid?.style.getPropertyValue("--unit-display-columns")).toBe("1");
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

  test("button hover backgrounds are limited to fine pointers", async () => {
    const { display } = makeDisplay();
    try {
      await display.updateComplete;
      const cityButton = display.querySelector(".unit-display-grid > * > div");

      expect(cityButton?.classList.contains("hover:bg-gray-800")).toBe(false);
      expect(
        cityButton?.classList.contains("pointer-fine:hover:bg-gray-800"),
      ).toBe(true);
    } finally {
      display.remove();
    }
  });

  test("shows the hotkeys when a keyboard is present", async () => {
    const { display } = makeDisplay();
    try {
      await display.updateComplete;

      const hotkeys = display.querySelectorAll(".unit-display-hotkey");
      expect(hotkeys.length).toBeGreaterThan(0);
    } finally {
      display.remove();
    }
  });

  test("does not show hotkeys when there is no keyboard", async () => {
    await withCoarsePointer(async () => {
      const { display } = makeDisplay();
      try {
        await display.updateComplete;

        expect(display.querySelectorAll(".unit-display-hotkey")).toHaveLength(
          0,
        );
      } finally {
        display.remove();
      }
    });
  });

  test("holding a build button shows its details without selecting it", async () => {
    vi.useFakeTimers();
    try {
      const { display, inputHandler } = makeDisplay();
      try {
        await display.updateComplete;
        const cityItem = display.querySelector(".unit-display-grid")
          ?.firstElementChild as HTMLElement;
        cityItem.dispatchEvent(
          new PointerEvent("pointerdown", {
            button: 0,
            clientX: 10,
            clientY: 10,
            pointerId: 1,
            pointerType: "touch",
            bubbles: true,
          }),
        );
        dispatchTouch(cityItem, "touchstart", 42);

        vi.advanceTimersByTime(500);
        await display.updateComplete;

        // The details are visible, even though the device has no mouse.
        const tooltip = display.querySelector(".unit-display-tooltip");
        expect(tooltip).not.toBeNull();
        expect(tooltip?.classList.contains("block")).toBe(true);
        expect(tooltip?.classList.contains("pointer-fine:block")).toBe(false);

        // Releasing the hold must not build anything.
        cityItem.dispatchEvent(
          new PointerEvent("pointerup", {
            button: 0,
            clientX: 10,
            clientY: 10,
            pointerId: 1,
            pointerType: "touch",
            bubbles: true,
          }),
        );
        dispatchTouch(cityItem, "touchend", 42);
        cityItem
          .querySelector("div > div")
          ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(inputHandler.setGhostStructure).not.toHaveBeenCalled();
      } finally {
        display.remove();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  test("a short tap on a build button still selects it", async () => {
    vi.useFakeTimers();
    try {
      const { display, inputHandler } = makeDisplay();
      try {
        await display.updateComplete;
        const cityItem = display.querySelector(".unit-display-grid")
          ?.firstElementChild as HTMLElement;
        cityItem.dispatchEvent(
          new PointerEvent("pointerdown", {
            button: 0,
            clientX: 10,
            clientY: 10,
            pointerId: 1,
            pointerType: "touch",
            bubbles: true,
          }),
        );
        vi.advanceTimersByTime(100);
        cityItem.dispatchEvent(
          new PointerEvent("pointerup", {
            button: 0,
            clientX: 10,
            clientY: 10,
            pointerId: 1,
            pointerType: "touch",
            bubbles: true,
          }),
        );
        cityItem
          .querySelector("div > div")
          ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(inputHandler.setGhostStructure).toHaveBeenCalledWith(
          UnitType.City,
          "GUIclick",
        );
        expect(display.querySelector(".unit-display-tooltip")).toBeNull();
      } finally {
        display.remove();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  test("a touch build selection enables touch placement mode", async () => {
    vi.useFakeTimers();
    try {
      const { display, eventBus } = makeDisplay();
      try {
        const selected: TouchGhostPlacementSelectEvent[] = [];
        eventBus.on(TouchGhostPlacementSelectEvent, (event) =>
          selected.push(event),
        );
        await display.updateComplete;
        const cityItem = display.querySelector(".unit-display-grid")
          ?.firstElementChild as HTMLElement;
        const button = cityItem.querySelector("div > div") as HTMLElement;
        cityItem.dispatchEvent(
          new PointerEvent("pointerdown", {
            button: 0,
            pointerId: 1,
            pointerType: "touch",
            bubbles: true,
          }),
        );
        dispatchTouch(cityItem, "touchstart", 42);
        cityItem.dispatchEvent(
          new PointerEvent("pointerup", {
            button: 0,
            pointerId: 1,
            pointerType: "touch",
            bubbles: true,
          }),
        );
        dispatchTouch(cityItem, "touchend", 42);
        button.dispatchEvent(
          new PointerEvent("click", {
            pointerId: 1,
            pointerType: "touch",
            bubbles: true,
          }),
        );

        expect(selected).toHaveLength(1);
      } finally {
        display.remove();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  test("repeated touch taps reapply build highlights after toggling off", async () => {
    const { display, eventBus } = makeDisplay();
    try {
      const highlights: ToggleStructureEvent[] = [];
      eventBus.on(ToggleStructureEvent, (event) => highlights.push(event));
      await display.updateComplete;
      const item = display.querySelectorAll(".unit-display-grid > *")[5];
      const button = item.querySelector("div > div") as HTMLElement;

      const tap = () =>
        button.dispatchEvent(
          new PointerEvent("click", {
            bubbles: true,
            pointerId: 1,
            pointerType: "touch",
          }),
        );

      tap();
      expect(highlights[highlights.length - 1]?.structureTypes).toEqual([
        UnitType.SAMLauncher,
      ]);
      await display.updateComplete;

      tap();
      expect(highlights[highlights.length - 1]?.structureTypes).toBeNull();
      await display.updateComplete;

      tap();
      expect(highlights[highlights.length - 1]?.structureTypes).toEqual([
        UnitType.SAMLauncher,
      ]);
    } finally {
      display.remove();
    }
  });

  test("touch pointer leave does not clear a selected build highlight", async () => {
    const { display, eventBus } = makeDisplay();
    try {
      const highlights: ToggleStructureEvent[] = [];
      eventBus.on(ToggleStructureEvent, (event) => highlights.push(event));
      await display.updateComplete;
      const button = display.querySelectorAll(
        ".unit-display-grid > * > div > div",
      )[0] as HTMLElement;

      button.dispatchEvent(
        new PointerEvent("click", {
          bubbles: true,
          pointerId: 1,
          pointerType: "touch",
        }),
      );
      button.dispatchEvent(
        new PointerEvent("pointerleave", {
          bubbles: true,
          pointerId: 1,
          pointerType: "touch",
        }),
      );
      button.dispatchEvent(new MouseEvent("mouseleave"));

      expect(highlights[highlights.length - 1]?.structureTypes).toEqual([
        UnitType.City,
      ]);

      button.dispatchEvent(
        new PointerEvent("pointerleave", {
          bubbles: true,
          pointerId: 2,
          pointerType: "mouse",
        }),
      );
      expect(highlights[highlights.length - 1]?.structureTypes).toEqual([
        UnitType.City,
      ]);
    } finally {
      display.remove();
    }
  });

  test("a touch tap forwarded as a MouseEvent enables touch placement mode", async () => {
    const { display, eventBus } = makeDisplay();
    try {
      const selected: TouchGhostPlacementSelectEvent[] = [];
      eventBus.on(TouchGhostPlacementSelectEvent, (event) =>
        selected.push(event),
      );
      await display.updateComplete;
      const button = display.querySelector(
        ".unit-display-grid > * > div > div",
      ) as HTMLElement;
      const click = new MouseEvent("click", { bubbles: true });
      Object.defineProperty(click, FORWARDED_TOUCH_CLICK, { value: true });
      button.dispatchEvent(click);

      expect(selected).toHaveLength(1);
    } finally {
      display.remove();
    }
  });

  test("an iOS-style MouseEvent click after touchend enters touch placement mode", async () => {
    const { display, eventBus } = makeDisplay();
    try {
      const selected: TouchGhostPlacementSelectEvent[] = [];
      const highlights: ToggleStructureEvent[] = [];
      eventBus.on(TouchGhostPlacementSelectEvent, (event) =>
        selected.push(event),
      );
      eventBus.on(ToggleStructureEvent, (event) => highlights.push(event));
      await display.updateComplete;
      const item = display.querySelector(".unit-display-grid > *")
        ?.firstElementChild as HTMLElement;

      item.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          pointerId: 7,
          pointerType: "touch",
        }),
      );
      dispatchTouch(item, "touchstart", 43);
      item.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          pointerId: 7,
          pointerType: "touch",
        }),
      );
      dispatchTouch(item, "touchend", 43);
      item.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));

      expect(selected).toHaveLength(1);
      expect(highlights[highlights.length - 1]?.structureTypes).toEqual([
        UnitType.City,
      ]);
    } finally {
      display.remove();
    }
  });

  test("a second touchstart invalidates a pending iOS-style click", async () => {
    const { display, eventBus } = makeDisplay();
    try {
      const selected: TouchGhostPlacementSelectEvent[] = [];
      eventBus.on(TouchGhostPlacementSelectEvent, (event) =>
        selected.push(event),
      );
      await display.updateComplete;
      const item = display.querySelector(".unit-display-grid > *")
        ?.firstElementChild as HTMLElement;

      dispatchTouch(item, "touchstart", 43);
      dispatchTouch(item, "touchend", 43);
      dispatchTouch(item, "touchstart", 44);
      item.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));

      expect(selected).toHaveLength(0);
    } finally {
      display.remove();
    }
  });

  test("a hold without a generated click does not suppress the next mouse click", async () => {
    vi.useFakeTimers();
    try {
      const { display, inputHandler } = makeDisplay();
      try {
        await display.updateComplete;
        const cityItem = display.querySelector(".unit-display-grid")
          ?.firstElementChild as HTMLElement;
        cityItem.dispatchEvent(
          new PointerEvent("pointerdown", {
            button: 0,
            pointerId: 1,
            pointerType: "touch",
            bubbles: true,
          }),
        );
        dispatchTouch(cityItem, "touchstart", 42);
        vi.advanceTimersByTime(500);
        cityItem.dispatchEvent(
          new PointerEvent("pointerup", {
            button: 0,
            pointerId: 1,
            pointerType: "touch",
            bubbles: true,
          }),
        );
        dispatchTouch(cityItem, "touchend", 42);

        cityItem.dispatchEvent(
          new PointerEvent("pointerdown", {
            button: 0,
            pointerId: 2,
            pointerType: "mouse",
            bubbles: true,
          }),
        );
        cityItem
          .querySelector("div > div")
          ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(inputHandler.setGhostStructure).toHaveBeenCalledWith(
          UnitType.City,
          "GUIclick",
        );
      } finally {
        display.remove();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  test("the peek ends when the button is released", async () => {
    vi.useFakeTimers();
    try {
      const { display } = makeDisplay();
      try {
        await display.updateComplete;
        const cityItem = display.querySelector(".unit-display-grid")
          ?.firstElementChild as HTMLElement;
        cityItem.dispatchEvent(
          new PointerEvent("pointerdown", {
            button: 0,
            clientX: 10,
            clientY: 10,
            pointerId: 1,
            pointerType: "touch",
            bubbles: true,
          }),
        );
        vi.advanceTimersByTime(500);
        await display.updateComplete;
        expect(display.querySelector(".unit-display-tooltip")).not.toBeNull();

        cityItem.dispatchEvent(
          new PointerEvent("pointerup", {
            button: 0,
            clientX: 10,
            clientY: 10,
            pointerId: 1,
            pointerType: "touch",
            bubbles: true,
          }),
        );
        await display.updateComplete;

        expect(display.querySelector(".unit-display-tooltip")).toBeNull();
      } finally {
        display.remove();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  test("pointer cancellation does not hide the peek before touch release", async () => {
    vi.useFakeTimers();
    try {
      const { display } = makeDisplay();
      try {
        await display.updateComplete;
        const cityItem = display.querySelector(".unit-display-grid")
          ?.firstElementChild as HTMLElement;

        cityItem.dispatchEvent(
          new PointerEvent("pointerdown", {
            button: 0,
            pointerId: 1,
            pointerType: "touch",
            bubbles: true,
          }),
        );
        dispatchTouch(cityItem, "touchstart", 42);
        vi.advanceTimersByTime(500);
        await display.updateComplete;
        expect(display.querySelector(".unit-display-tooltip")).not.toBeNull();

        cityItem.dispatchEvent(
          new PointerEvent("pointercancel", {
            button: 0,
            pointerId: 1,
            pointerType: "touch",
            bubbles: true,
          }),
        );
        vi.advanceTimersByTime(1300);
        await display.updateComplete;
        expect(display.querySelector(".unit-display-tooltip")).not.toBeNull();

        dispatchTouch(cityItem, "touchend", 42);
        await display.updateComplete;
        expect(display.querySelector(".unit-display-tooltip")).toBeNull();
      } finally {
        display.remove();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  test("touch cancellation hides the peek after its grace period", async () => {
    vi.useFakeTimers();
    try {
      const { display } = makeDisplay();
      try {
        await display.updateComplete;
        const cityItem = display.querySelector(".unit-display-grid")
          ?.firstElementChild as HTMLElement;
        cityItem.dispatchEvent(
          new PointerEvent("pointerdown", {
            button: 0,
            pointerId: 1,
            pointerType: "touch",
            bubbles: true,
          }),
        );
        dispatchTouch(cityItem, "touchstart", 42);
        vi.advanceTimersByTime(500);
        await display.updateComplete;
        expect(display.querySelector(".unit-display-tooltip")).not.toBeNull();

        cityItem.dispatchEvent(
          new PointerEvent("pointercancel", {
            button: 0,
            pointerId: 1,
            pointerType: "touch",
            bubbles: true,
          }),
        );
        dispatchTouch(cityItem, "touchcancel", 42);
        vi.advanceTimersByTime(1300);
        await display.updateComplete;

        expect(display.querySelector(".unit-display-tooltip")).toBeNull();
      } finally {
        display.remove();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  test("unrelated pointer cancellation does not stop or dismiss the peek", async () => {
    vi.useFakeTimers();
    try {
      const { display } = makeDisplay();
      try {
        await display.updateComplete;
        const cityItem = display.querySelector(".unit-display-grid")
          ?.firstElementChild as HTMLElement;
        cityItem.dispatchEvent(
          new PointerEvent("pointerdown", {
            button: 0,
            pointerId: 1,
            pointerType: "touch",
            bubbles: true,
          }),
        );
        dispatchTouch(cityItem, "touchstart", 42);
        vi.advanceTimersByTime(500);
        await display.updateComplete;

        document.body.dispatchEvent(
          new PointerEvent("pointercancel", {
            pointerId: 2,
            pointerType: "touch",
            bubbles: true,
          }),
        );
        document.body.dispatchEvent(
          new PointerEvent("pointerup", {
            pointerId: 2,
            pointerType: "touch",
            bubbles: true,
          }),
        );
        vi.advanceTimersByTime(1300);
        await display.updateComplete;

        expect(display.querySelector(".unit-display-tooltip")).not.toBeNull();
        dispatchTouch(cityItem, "touchend", 42);
        await display.updateComplete;
        expect(display.querySelector(".unit-display-tooltip")).toBeNull();
      } finally {
        display.remove();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  test("a canceled build touch gets a grace period while another touch remains down", async () => {
    vi.useFakeTimers();
    try {
      const { display } = makeDisplay();
      try {
        await display.updateComplete;
        const cityItem = display.querySelector(".unit-display-grid")
          ?.firstElementChild as HTMLElement;

        dispatchTouch(document.body, "touchstart", 7);
        cityItem.dispatchEvent(
          new PointerEvent("pointerdown", {
            button: 0,
            pointerId: 1,
            pointerType: "touch",
            bubbles: true,
          }),
        );
        dispatchTouch(cityItem, "touchstart", 42);
        vi.advanceTimersByTime(500);
        await display.updateComplete;
        expect(display.querySelector(".unit-display-tooltip")).not.toBeNull();

        cityItem.dispatchEvent(
          new PointerEvent("pointercancel", {
            button: 0,
            pointerId: 1,
            pointerType: "touch",
            bubbles: true,
          }),
        );
        vi.advanceTimersByTime(1300);
        await display.updateComplete;

        expect(display.querySelector(".unit-display-tooltip")).toBeNull();
        dispatchTouch(document.body, "touchend", 7);
      } finally {
        display.remove();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  test("a canceled touch does not leave the next click suppressed", async () => {
    vi.useFakeTimers();
    try {
      const { display, inputHandler } = makeDisplay();
      try {
        await display.updateComplete;
        const cityItem = display.querySelector(".unit-display-grid")
          ?.firstElementChild as HTMLElement;
        const button = cityItem.querySelector("div > div") as HTMLElement;
        cityItem.dispatchEvent(
          new PointerEvent("pointerdown", {
            button: 0,
            pointerId: 1,
            pointerType: "touch",
            bubbles: true,
          }),
        );
        dispatchTouch(cityItem, "touchstart", 42);
        vi.advanceTimersByTime(500);
        await display.updateComplete;

        cityItem.dispatchEvent(
          new PointerEvent("pointercancel", {
            button: 0,
            pointerId: 1,
            pointerType: "touch",
            bubbles: true,
          }),
        );
        dispatchTouch(cityItem, "touchcancel", 42);
        button.dispatchEvent(
          new PointerEvent("click", {
            pointerId: 1,
            pointerType: "touch",
            bubbles: true,
          }),
        );

        expect(inputHandler.setGhostStructure).toHaveBeenCalledWith(
          UnitType.City,
          "GUIclick",
        );
      } finally {
        display.remove();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  test("touch tap on an unbuildable button preserves the selected ghost highlight", async () => {
    const { display, inputHandler, eventBus } = makeDisplay(
      UnitType.SAMLauncher,
    );
    try {
      const emitted: ToggleStructureEvent[] = [];
      eventBus.on(ToggleStructureEvent, (event) => emitted.push(event));
      (display as any).playerBuildables = [
        { type: UnitType.City, cost: 1001n },
      ];
      await display.updateComplete;
      const cityItem = display.querySelector(".unit-display-grid")
        ?.firstElementChild as HTMLElement;
      const button = cityItem.querySelector("div > div") as HTMLElement;
      button.dispatchEvent(
        new PointerEvent("pointerenter", {
          pointerId: 1,
          pointerType: "mouse",
        }),
      );
      cityItem.dispatchEvent(
        new PointerEvent("pointerdown", {
          button: 0,
          pointerId: 1,
          pointerType: "touch",
          bubbles: true,
        }),
      );
      dispatchTouch(cityItem, "touchstart", 42);
      cityItem.dispatchEvent(
        new PointerEvent("pointerup", {
          button: 0,
          pointerId: 1,
          pointerType: "touch",
          bubbles: true,
        }),
      );
      dispatchTouch(cityItem, "touchend", 42);
      button.dispatchEvent(
        new PointerEvent("click", {
          pointerId: 1,
          pointerType: "touch",
          bubbles: true,
        }),
      );

      expect(inputHandler.setGhostStructure).not.toHaveBeenCalled();
      expect(emitted[0]?.structureTypes).toEqual([UnitType.City]);
      expect(emitted[emitted.length - 1]?.structureTypes).toEqual([
        UnitType.SAMLauncher,
      ]);
    } finally {
      display.remove();
    }
  });

  test("the warship shift hint needs a keyboard", async () => {
    const { display } = makeDisplay();
    try {
      await display.updateComplete;
      const warshipItem = display.querySelectorAll(".unit-display-grid > *")[6];
      warshipItem.dispatchEvent(new MouseEvent("mouseenter"));
      await display.updateComplete;

      const tooltip = display.querySelector(".unit-display-tooltip");
      expect(tooltip?.textContent).toContain("warship_shift_hint");
    } finally {
      display.remove();
    }
  });

  test("the warship shift hint is left out without a keyboard", async () => {
    await withCoarsePointer(async () => {
      const { display } = makeDisplay();
      try {
        await display.updateComplete;
        const warshipItem = display.querySelectorAll(
          ".unit-display-grid > *",
        )[6];
        warshipItem.dispatchEvent(new MouseEvent("mouseenter"));
        await display.updateComplete;

        const tooltip = display.querySelector(".unit-display-tooltip");
        expect(tooltip).not.toBeNull();
        expect(tooltip?.textContent).not.toContain("warship_shift_hint");
      } finally {
        display.remove();
      }
    });
  });

  test("the tooltip is kept inside the bar", async () => {
    const { display } = makeDisplay();
    try {
      await display.updateComplete;
      const root = display.querySelector(".unit-display-root") as HTMLElement;
      const cityItem = display.querySelector(".unit-display-grid")
        ?.firstElementChild as HTMLElement;
      root.getBoundingClientRect = () =>
        ({ left: 0, right: 300, top: 0, width: 300 }) as DOMRect;
      cityItem.getBoundingClientRect = () =>
        ({ left: 10, top: 140, width: 20 }) as DOMRect;
      cityItem.dispatchEvent(new MouseEvent("mouseenter"));
      await display.updateComplete;

      const tooltip = display.querySelector(
        ".unit-display-tooltip",
      ) as HTMLElement;
      // The tooltip hangs off the left edge, so it is pushed back inside. The
      // style carries the half width that the transform pulls back.
      tooltip.getBoundingClientRect = () =>
        ({ left: -80, right: 120, top: 0, width: 200 }) as DOMRect;
      display.requestUpdate();
      await display.updateComplete;

      expect(parseFloat(tooltip.style.left)).toBe(108);
      expect(
        tooltip.classList.contains("max-w-[min(100%_-_1rem,100vw_-_1rem)]"),
      ).toBe(true);
    } finally {
      display.remove();
    }
  });

  test("the tooltip is kept on the screen when the bar is wider than it", async () => {
    const { display } = makeDisplay();
    try {
      await display.updateComplete;
      const root = display.querySelector(".unit-display-root") as HTMLElement;
      const cityItem = display.querySelector(".unit-display-grid")
        ?.firstElementChild as HTMLElement;
      // A bar that does not fit the screen, eg. the minimum width of its
      // buttons, makes the bar wider than the viewport.
      root.getBoundingClientRect = () =>
        ({ left: 0, right: 600, top: 0, width: 600 }) as DOMRect;
      cityItem.getBoundingClientRect = () =>
        ({ left: 10, top: 140, width: 20 }) as DOMRect;
      cityItem.dispatchEvent(new MouseEvent("mouseenter"));
      await display.updateComplete;

      const tooltip = display.querySelector(
        ".unit-display-tooltip",
      ) as HTMLElement;
      tooltip.getBoundingClientRect = () =>
        ({ left: -90, right: 310, top: 0, width: 400 }) as DOMRect;
      display.requestUpdate();
      await display.updateComplete;

      // The tooltip starts at the item, but it is pushed back on the screen.
      expect(parseFloat(tooltip.style.left)).toBe(208);
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
