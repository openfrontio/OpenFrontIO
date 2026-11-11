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
  ConfirmGhostStructureEvent,
  FORWARDED_TOUCH_CLICK,
  ToggleStructureEvent,
  TouchGhostPlacementMoveEvent,
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
  await withMediaQueries((query) => query.includes("pointer: coarse"), run);
}

/** A portrait screen narrower than lg, where the bar is a column on the right edge. */
async function withSideBar(run: () => void | Promise<void>) {
  await withMediaQueries(
    (query) =>
      query.includes("orientation: portrait") ||
      query.includes("pointer: coarse"),
    run,
  );
}

async function withMediaQueries(
  matches: (query: string) => boolean,
  run: () => void | Promise<void>,
) {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: matches(query),
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
  test("is a row, and a vertically scrolling column below lg in portrait", async () => {
    const { display } = makeDisplay();
    try {
      await display.updateComplete;

      const scroller = display.querySelector(".unit-display-scroll");
      const grid = scroller?.querySelector<HTMLElement>(".unit-display-grid");
      expect(scroller).not.toBeNull();
      expect(scroller?.classList.contains("overflow-x-auto")).toBe(true);
      // No touch panning: a drag from a button goes to the map, whichever
      // way it heads.
      expect(scroller?.classList.contains("touch-none")).toBe(true);
      expect(scroller?.classList.contains("lg:overflow-visible")).toBe(true);
      expect(scroller?.classList.contains("side-bar:overflow-y-auto")).toBe(
        true,
      );
      expect(grid?.classList.contains("grid-flow-col")).toBe(true);
      expect(grid?.classList.contains("auto-cols-fr")).toBe(true);
      expect(grid?.classList.contains("lg:auto-cols-max")).toBe(true);
      expect(grid?.classList.contains("side-bar:grid-flow-row")).toBe(true);
      expect(grid?.classList.contains("side-bar:grid-cols-1")).toBe(true);
      expect(grid?.children).toHaveLength(10);
    } finally {
      display.remove();
    }
  });

  test("shows only the enabled build buttons", async () => {
    const { display } = makeDisplay(null, [UnitType.City]);
    try {
      await display.updateComplete;

      const grid = display.querySelector<HTMLElement>(".unit-display-grid");
      expect(grid?.children).toHaveLength(BuildMenus.types.length - 1);
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
      const classes = [...(cityButton?.classList ?? [])];

      expect(classes.some((c) => c.startsWith("hover:"))).toBe(false);
      expect(classes.some((c) => c.startsWith("pointer-fine:hover:"))).toBe(
        true,
      );
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

  test("fades the end of the row that still hides actions", async () => {
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

      expect(root.classList.contains("unit-display-more-end")).toBe(true);
      expect(root.classList.contains("unit-display-more-start")).toBe(false);

      Object.defineProperty(scroller, "scrollLeft", {
        value: 300,
        configurable: true,
      });
      scroller.dispatchEvent(new Event("scroll"));
      await display.updateComplete;

      expect(root.classList.contains("unit-display-more-end")).toBe(false);
      expect(root.classList.contains("unit-display-more-start")).toBe(true);
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

      expect(root.classList.contains("unit-display-more-end")).toBe(false);
      expect(root.classList.contains("unit-display-more-start")).toBe(false);
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

describe("dragging a build button onto the map", () => {
  function touch(type: string, x: number, y: number) {
    return new PointerEvent(type, {
      button: 0,
      clientX: x,
      clientY: y,
      pointerId: 7,
      pointerType: "touch",
      bubbles: true,
    });
  }

  async function setup(gold = 1000n) {
    const made = makeDisplay();
    await made.display.updateComplete;
    // jsdom has no layout: the bar is a column on the right edge.
    const root = made.display.querySelector(
      ".unit-display-root",
    ) as HTMLElement;
    root.getBoundingClientRect = () =>
      ({ left: 340, right: 390, top: 200, bottom: 540 }) as DOMRect;
    const cityItem = made.display.querySelector(".unit-display-grid")
      ?.firstElementChild as HTMLElement;
    const moves: TouchGhostPlacementMoveEvent[] = [];
    const confirms: ConfirmGhostStructureEvent[] = [];
    made.eventBus.on(TouchGhostPlacementMoveEvent, (e) => moves.push(e));
    made.eventBus.on(ConfirmGhostStructureEvent, (e) => confirms.push(e));
    if (gold !== 1000n) {
      (made.display.game.myPlayer() as any).gold = () => gold;
      (made.display as any).playerBuildables = [
        { type: UnitType.City, cost: 500n },
      ];
    }
    return { ...made, cityItem, moves, confirms };
  }

  test("picks the unit once the finger leaves the bar, and builds where it lets go", async () => {
    const { display, inputHandler, cityItem, moves, confirms } = await setup();
    try {
      cityItem.dispatchEvent(touch("pointerdown", 365, 220));
      // Still over the bar: nothing is picked yet.
      cityItem.dispatchEvent(touch("pointermove", 350, 222));
      expect(inputHandler.setGhostStructure).not.toHaveBeenCalled();

      cityItem.dispatchEvent(touch("pointermove", 300, 230));
      expect(inputHandler.setGhostStructure).toHaveBeenCalledWith(
        UnitType.City,
        "GUIclick",
      );
      cityItem.dispatchEvent(touch("pointermove", 200, 260));
      cityItem.dispatchEvent(touch("pointerup", 180, 270));

      // The unit rides above the finger, so the finger doesn't hide it.
      expect(moves.map((m) => [m.x, m.y])).toEqual([
        [300, 186],
        [200, 216],
        [180, 226],
      ]);
      expect(confirms).toHaveLength(1);
      // Where it can't be built, the unit is dropped rather than left held.
      expect(confirms[0].endsPlacement).toBe(true);
      // The release's click (if the browser makes one) must not toggle the
      // unit off again.
      cityItem
        .querySelector("div > div")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(inputHandler.setGhostStructure).toHaveBeenCalledTimes(1);
    } finally {
      display.remove();
    }
  });

  test("dragging the unit that's already held keeps it as it was", async () => {
    const { display, inputHandler, cityItem, confirms } = await setup();
    try {
      display.uiState.ghostStructure = UnitType.City;
      cityItem.dispatchEvent(touch("pointerdown", 365, 220));
      cityItem.dispatchEvent(touch("pointermove", 300, 230));
      cityItem.dispatchEvent(touch("pointerup", 200, 260));

      // Picking it again would raise its upgrade multiplier.
      expect(inputHandler.setGhostStructure).not.toHaveBeenCalled();
      expect(display.uiState.ghostStructure).toBe(UnitType.City);
      expect(confirms).toHaveLength(1);
    } finally {
      display.remove();
    }
  });

  test("letting go back over the bar cancels", async () => {
    const { display, inputHandler, cityItem, confirms } = await setup();
    try {
      cityItem.dispatchEvent(touch("pointerdown", 365, 220));
      cityItem.dispatchEvent(touch("pointermove", 300, 230));
      cityItem.dispatchEvent(touch("pointerup", 360, 300));

      expect(confirms).toHaveLength(0);
      expect(inputHandler.setGhostStructure).toHaveBeenLastCalledWith(
        null,
        "GUIclick",
      );
    } finally {
      display.remove();
    }
  });

  test("a cancelled touch drops the unit", async () => {
    const { display, inputHandler, cityItem, confirms } = await setup();
    try {
      cityItem.dispatchEvent(touch("pointerdown", 365, 220));
      cityItem.dispatchEvent(touch("pointermove", 300, 230));
      cityItem.dispatchEvent(touch("pointercancel", 300, 230));

      expect(confirms).toHaveLength(0);
      expect(inputHandler.setGhostStructure).toHaveBeenLastCalledWith(
        null,
        "GUIclick",
      );
    } finally {
      display.remove();
    }
  });

  test("a press that stays on the bar is not a drag", async () => {
    const { display, inputHandler, cityItem, moves, confirms } = await setup();
    try {
      cityItem.dispatchEvent(touch("pointerdown", 365, 220));
      cityItem.dispatchEvent(touch("pointermove", 362, 226));
      cityItem.dispatchEvent(touch("pointerup", 362, 226));

      expect(moves).toHaveLength(0);
      expect(confirms).toHaveLength(0);
      expect(inputHandler.setGhostStructure).not.toHaveBeenCalled();
    } finally {
      display.remove();
    }
  });

  test("a unit the player can't afford is not dragged out", async () => {
    const { display, inputHandler, cityItem, moves, confirms } =
      await setup(100n);
    try {
      cityItem.dispatchEvent(touch("pointerdown", 365, 220));
      cityItem.dispatchEvent(touch("pointermove", 300, 230));
      cityItem.dispatchEvent(touch("pointerup", 200, 260));

      expect(moves).toHaveLength(0);
      expect(confirms).toHaveLength(0);
      expect(inputHandler.setGhostStructure).not.toHaveBeenCalled();
    } finally {
      display.remove();
    }
  });
});

describe("UnitDisplay as a side column below lg in portrait", () => {
  test("places the tooltip left of the item, centred on it", async () => {
    await withSideBar(async () => {
      const { display } = makeDisplay();
      try {
        await display.updateComplete;
        const root = display.querySelector(".unit-display-root") as HTMLElement;
        const cityItem = display.querySelector(".unit-display-grid")
          ?.firstElementChild as HTMLElement;
        root.getBoundingClientRect = () =>
          ({ left: 340, top: 200, width: 50, height: 340 }) as DOMRect;
        cityItem.getBoundingClientRect = () =>
          ({ left: 343, top: 240, width: 44, height: 32 }) as DOMRect;
        cityItem.dispatchEvent(new MouseEvent("mouseenter"));
        await display.updateComplete;

        const tooltip = display.querySelector(
          ".unit-display-tooltip",
        ) as HTMLElement;
        // 6px left of the item and at its middle, in the bar's coordinates;
        // the transform pulls the box fully left and half up from there.
        expect(tooltip.style.left).toBe("-3px");
        expect(tooltip.style.top).toBe("56px");
        expect(tooltip.classList.contains("-translate-x-full")).toBe(true);
        expect(tooltip.classList.contains("-translate-y-1/2")).toBe(true);
      } finally {
        display.remove();
      }
    });
  });

  test("keeps the tooltip on the screen vertically", async () => {
    await withSideBar(async () => {
      const { display } = makeDisplay();
      try {
        await display.updateComplete;
        const root = display.querySelector(".unit-display-root") as HTMLElement;
        const cityItem = display.querySelector(".unit-display-grid")
          ?.firstElementChild as HTMLElement;
        root.getBoundingClientRect = () =>
          ({ left: 340, top: 10, width: 50, height: 340 }) as DOMRect;
        cityItem.getBoundingClientRect = () =>
          ({ left: 343, top: 12, width: 44, height: 32 }) as DOMRect;
        cityItem.dispatchEvent(new MouseEvent("mouseenter"));
        await display.updateComplete;

        const tooltip = display.querySelector(
          ".unit-display-tooltip",
        ) as HTMLElement;
        // Centred on the item (y 28) it would start at y -32, off the top.
        tooltip.getBoundingClientRect = () =>
          ({ left: 200, top: -32, width: 130, height: 120 }) as DOMRect;
        display.requestUpdate();
        await display.updateComplete;

        // Pushed down to the 8px margin: top 8, so its centre is at y 68,
        // which is 58 in the bar's coordinates.
        expect(parseFloat(tooltip.style.top)).toBe(58);
      } finally {
        display.remove();
      }
    });
  });

  test("fades the end of the column that still hides actions", async () => {
    await withSideBar(async () => {
      const { display } = makeDisplay();
      try {
        await display.updateComplete;
        const root = display.querySelector(".unit-display-root") as HTMLElement;
        const scroller = display.querySelector(
          ".unit-display-scroll",
        ) as HTMLElement;
        const set = (name: string, value: number) =>
          Object.defineProperty(scroller, name, { value, configurable: true });
        set("scrollHeight", 340);
        set("clientHeight", 280);
        set("scrollTop", 0);
        // The row's measures must not count in the column.
        set("scrollWidth", 50);
        set("clientWidth", 50);

        scroller.dispatchEvent(new Event("scroll"));
        await display.updateComplete;
        expect(root.classList.contains("unit-display-more-end")).toBe(true);
        expect(root.classList.contains("unit-display-more-start")).toBe(false);

        set("scrollTop", 60);
        scroller.dispatchEvent(new Event("scroll"));
        await display.updateComplete;
        expect(root.classList.contains("unit-display-more-end")).toBe(false);
        expect(root.classList.contains("unit-display-more-start")).toBe(true);
      } finally {
        display.remove();
      }
    });
  });
});

describe("UnitDisplay tiles", () => {
  test("each tile is named after its unit and says whether it is armed", async () => {
    const { display } = makeDisplay(UnitType.Port);
    try {
      await display.updateComplete;

      const tiles = display.querySelectorAll('[role="button"]');
      expect(tiles).toHaveLength(BuildMenus.types.length);
      expect(tiles[0].getAttribute("aria-label")).toBe("unit_type.city");
      const pressed = [...tiles].filter(
        (tile) => tile.getAttribute("aria-pressed") === "true",
      );
      expect(pressed).toHaveLength(1);
      expect(pressed[0].closest("[data-unit]")?.getAttribute("data-unit")).toBe(
        "port",
      );
    } finally {
      display.remove();
    }
  });

  test("a unit that costs more than my gold is marked and a click does not pick it", async () => {
    const { display, inputHandler } = makeDisplay();
    try {
      (display as any).playerBuildables = [
        { type: UnitType.City, cost: 1001n },
      ];
      display.requestUpdate();
      await display.updateComplete;

      const city = display.querySelector<HTMLElement>(
        '[data-unit="city"] > [role="button"]',
      );
      const factory = display.querySelector(
        '[data-unit="factory"] > [role="button"]',
      );
      expect(city?.getAttribute("aria-disabled")).toBe("true");
      expect(factory?.getAttribute("aria-disabled")).toBe("false");

      city?.click();
      expect(inputHandler.setGhostStructure).not.toHaveBeenCalled();
    } finally {
      display.remove();
    }
  });

  test("shows a unit's price once the worker has sent it", async () => {
    const { display } = makeDisplay();
    try {
      await display.updateComplete;
      const price = () =>
        display.querySelector('[data-unit="city"] [data-unit-price]');
      // Unknown until the worker answers, but the line is already there.
      expect(price()).not.toBeNull();
      expect(price()?.textContent).toBe("");

      (display as any).playerBuildables = [
        { type: UnitType.City, cost: 1000n },
      ];
      display.requestUpdate();
      await display.updateComplete;
      expect(price()?.textContent).toBe("1.00K");
    } finally {
      display.remove();
    }
  });

  test("a tile's description reads its price", async () => {
    const { display } = makeDisplay();
    try {
      (display as any).playerBuildables = [
        { type: UnitType.City, cost: 1000n },
      ];
      display.requestUpdate();
      await display.updateComplete;

      const city = display.querySelector(
        '[data-unit="city"] > [role="button"]',
      );
      const description = document.getElementById(
        city?.getAttribute("aria-describedby") ?? "",
      );
      expect(description?.textContent).toBe("1.00K");
    } finally {
      display.remove();
    }
  });

  test("shows a count for buildings and warships, none for bombs", async () => {
    const { display } = makeDisplay();
    try {
      await display.updateComplete;

      expect(
        display.querySelector('[data-unit="city"] [data-unit-count]'),
      ).not.toBeNull();
      expect(
        display.querySelector('[data-unit="warship"] [data-unit-count]'),
      ).not.toBeNull();
      expect(
        display.querySelector('[data-unit="atom_bomb"] [data-unit-count]'),
      ).toBeNull();
    } finally {
      display.remove();
    }
  });

  test("the grid holds only the tiles, and each tile comes first in its item", async () => {
    const { display } = makeDisplay(null, [UnitType.Factory]);
    try {
      await display.updateComplete;

      const items = [
        ...(display.querySelector(".unit-display-grid")?.children ?? []),
      ];
      expect(items).toHaveLength(BuildMenus.types.length - 1);
      for (const item of items) {
        expect(item.firstElementChild?.getAttribute("role")).toBe("button");
      }
    } finally {
      display.remove();
    }
  });
});
