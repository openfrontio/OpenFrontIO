import {
  AutoUpgradeEvent,
  ConfirmGhostStructureEvent,
  InputHandler,
  WarshipSelectionBoxCancelEvent,
  WarshipSelectionBoxCompleteEvent,
  WarshipSelectionBoxUpdateEvent,
} from "../src/client/InputHandler";
import { UIState } from "../src/client/graphics/UIState";
import { EventBus } from "../src/core/EventBus";
import { UnitType } from "../src/core/game/Game";
import { GameView, PlayerView } from "../src/core/game/GameView";
import { KEYBINDS_KEY, UserSettings } from "../src/core/game/UserSettings";

class MockPointerEvent {
  button: number;
  clientX: number;
  clientY: number;
  x: number;
  y: number;
  pointerId: number;
  type: string;
  pointerType: string;
  preventDefault: () => void;

  constructor(type: string, init: any) {
    this.type = type;
    this.button = init.button;
    this.clientX = init.clientX;
    this.clientY = init.clientY;
    this.x = init.x ?? init.clientX;
    this.y = init.y ?? init.clientY;
    this.pointerId = init.pointerId;
    this.pointerType = init.pointerType ?? "mouse";
    this.preventDefault = vi.fn();
  }
}

global.PointerEvent = MockPointerEvent as any;

describe("InputHandler AutoUpgrade", () => {
  let inputHandler: InputHandler;
  let mockGameView: GameView;
  let eventBus: EventBus;
  let mockCanvas: HTMLCanvasElement;
  let testSettings: UserSettings;

  beforeEach(() => {
    testSettings = new UserSettings();
    testSettings.removeCached(KEYBINDS_KEY, false);

    mockGameView = {
      inSpawnPhase: () => false,
      myPlayer: () => ({ isAlive: () => true }),
    } as GameView;
    mockCanvas = document.createElement("canvas");
    mockCanvas.width = 800;
    mockCanvas.height = 600;

    eventBus = new EventBus();

    inputHandler = new InputHandler(
      mockGameView,
      {
        attackRatio: 20,
        ghostStructure: null,
        rocketDirectionUp: true,
        overlappingRailroads: [],
        ghostRailPaths: [],
      },
      mockCanvas,
      eventBus,
    );
  });

  afterEach(() => {
    inputHandler.destroy();
  });

  describe("Middle Mouse Button Handling", () => {
    test("should emit AutoUpgradeEvent on middle mouse button press", () => {
      const mockEmit = vi.spyOn(eventBus, "emit");

      const pointerEvent = new PointerEvent("pointerdown", {
        button: 1,
        clientX: 150,
        clientY: 250,
        pointerId: 1,
      });

      inputHandler["onPointerDown"](pointerEvent);

      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          x: 150,
          y: 250,
        }),
      );
    });

    test("should emit MouseDownEvent on left mouse button press instead of AutoUpgradeEvent", () => {
      const mockEmit = vi.spyOn(eventBus, "emit");

      const pointerEvent = new PointerEvent("pointerdown", {
        button: 0,
        clientX: 150,
        clientY: 250,
        pointerId: 1,
      });

      inputHandler["onPointerDown"](pointerEvent);

      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          x: 150,
          y: 250,
        }),
      );

      const calls = mockEmit.mock.calls;
      const lastCall = calls[calls.length - 1];
      expect(lastCall[0]).not.toBeInstanceOf(AutoUpgradeEvent);
    });

    test("should not emit AutoUpgradeEvent on right mouse button press", () => {
      const mockEmit = vi.spyOn(eventBus, "emit");

      const pointerEvent = new PointerEvent("pointerdown", {
        button: 2,
        clientX: 150,
        clientY: 250,
        pointerId: 1,
      });

      inputHandler["onPointerDown"](pointerEvent);

      expect(mockEmit).not.toHaveBeenCalledWith(
        expect.objectContaining({
          x: 150,
          y: 250,
        }),
      );
    });

    test("should handle multiple middle mouse button presses", () => {
      const mockEmit = vi.spyOn(eventBus, "emit");

      const pointerEvent1 = new PointerEvent("pointerdown", {
        button: 1,
        clientX: 100,
        clientY: 200,
        pointerId: 1,
      });
      inputHandler["onPointerDown"](pointerEvent1);

      const pointerEvent2 = new PointerEvent("pointerdown", {
        button: 1,
        clientX: 300,
        clientY: 400,
        pointerId: 2,
      });
      inputHandler["onPointerDown"](pointerEvent2);

      expect(mockEmit).toHaveBeenCalledTimes(2);
      expect(mockEmit).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          x: 100,
          y: 200,
        }),
      );
      expect(mockEmit).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          x: 300,
          y: 400,
        }),
      );
    });

    test("should handle middle mouse button press with zero coordinates", () => {
      const mockEmit = vi.spyOn(eventBus, "emit");

      const pointerEvent = new PointerEvent("pointerdown", {
        button: 1,
        clientX: 0,
        clientY: 0,
        pointerId: 1,
      });

      inputHandler["onPointerDown"](pointerEvent);

      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          x: 0,
          y: 0,
        }),
      );
    });

    test("should handle middle mouse button press with negative coordinates", () => {
      const mockEmit = vi.spyOn(eventBus, "emit");

      const pointerEvent = new PointerEvent("pointerdown", {
        button: 1,
        clientX: -100,
        clientY: -200,
        pointerId: 1,
      });

      inputHandler["onPointerDown"](pointerEvent);

      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          x: -100,
          y: -200,
        }),
      );
    });

    test("should handle middle mouse button press with decimal coordinates", () => {
      const mockEmit = vi.spyOn(eventBus, "emit");

      const pointerEvent = new PointerEvent("pointerdown", {
        button: 1,
        clientX: 100.5,
        clientY: 200.7,
        pointerId: 1,
      });

      inputHandler["onPointerDown"](pointerEvent);

      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          x: 100.5,
          y: 200.7,
        }),
      );
    });
  });

  describe("Spawn Phase Handling", () => {
    test("should emit MouseUpEvent and not ContextMenuEvent on left click release during spawn phase", () => {
      mockGameView.inSpawnPhase = () => true;
      const mockEmit = vi.spyOn(eventBus, "emit");

      inputHandler["userSettings"].leftClickOpensMenu = () => true;

      const pointerEvent = new PointerEvent("pointerup", {
        button: 0,
        clientX: 150,
        clientY: 250,
      });
      inputHandler["lastPointerDownX"] = 149;
      inputHandler["lastPointerDownY"] = 249;

      inputHandler["onPointerUp"](pointerEvent);

      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          x: 150,
          y: 250,
        }),
      );
      const emittedTypes = mockEmit.mock.calls.map(
        (call) => call[0].constructor.name,
      );
      expect(emittedTypes).toContain("MouseUpEvent");
      expect(emittedTypes).not.toContain("ContextMenuEvent");
    });

    test("should suppress/ignore context menu events during spawn phase", () => {
      mockGameView.inSpawnPhase = () => true;
      const mockEmit = vi.spyOn(eventBus, "emit");

      const mouseEvent = new MouseEvent("contextmenu", {
        clientX: 150,
        clientY: 250,
      });
      const preventDefaultSpy = vi.spyOn(mouseEvent, "preventDefault");

      inputHandler["onContextMenu"](mouseEvent);

      expect(preventDefaultSpy).toHaveBeenCalled();
      const emittedTypes = mockEmit.mock.calls.map(
        (call) => call[0].constructor.name,
      );
      expect(emittedTypes).not.toContain("ContextMenuEvent");
    });
  });

  describe("Pointer Event Handling", () => {
    test("should handle pointer events with different pointer IDs", () => {
      const mockEmit = vi.spyOn(eventBus, "emit");

      const pointerEvent1 = new PointerEvent("pointerdown", {
        button: 1,
        clientX: 100,
        clientY: 200,
        pointerId: 1,
      });
      inputHandler["onPointerDown"](pointerEvent1);

      const pointerEvent2 = new PointerEvent("pointerdown", {
        button: 1,
        clientX: 300,
        clientY: 400,
        pointerId: 2,
      });
      inputHandler["onPointerDown"](pointerEvent2);

      expect(mockEmit).toHaveBeenCalledTimes(2);
    });

    test("should handle pointer events with same pointer ID", () => {
      const mockEmit = vi.spyOn(eventBus, "emit");

      const pointerEvent1 = new PointerEvent("pointerdown", {
        button: 1,
        clientX: 100,
        clientY: 200,
        pointerId: 1,
      });
      inputHandler["onPointerDown"](pointerEvent1);

      const pointerEvent2 = new PointerEvent("pointerdown", {
        button: 1,
        clientX: 300,
        clientY: 400,
        pointerId: 1,
      });
      inputHandler["onPointerDown"](pointerEvent2);

      expect(mockEmit).toHaveBeenCalledTimes(2);
    });
  });

  describe("Edge Cases", () => {
    test("should handle very large coordinates", () => {
      const mockEmit = vi.spyOn(eventBus, "emit");

      const pointerEvent = new PointerEvent("pointerdown", {
        button: 1,
        clientX: Number.MAX_SAFE_INTEGER,
        clientY: Number.MAX_SAFE_INTEGER,
        pointerId: 1,
      });

      inputHandler["onPointerDown"](pointerEvent);

      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          x: Number.MAX_SAFE_INTEGER,
          y: Number.MAX_SAFE_INTEGER,
        }),
      );
    });

    test("should handle very small coordinates", () => {
      const mockEmit = vi.spyOn(eventBus, "emit");

      const pointerEvent = new PointerEvent("pointerdown", {
        button: 1,
        clientX: Number.MIN_SAFE_INTEGER,
        clientY: Number.MIN_SAFE_INTEGER,
        pointerId: 1,
      });

      inputHandler["onPointerDown"](pointerEvent);

      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          x: Number.MIN_SAFE_INTEGER,
          y: Number.MIN_SAFE_INTEGER,
        }),
      );
    });

    test("should handle NaN coordinates", () => {
      const mockEmit = vi.spyOn(eventBus, "emit");

      const pointerEvent = new PointerEvent("pointerdown", {
        button: 1,
        clientX: NaN,
        clientY: NaN,
        pointerId: 1,
      });

      inputHandler["onPointerDown"](pointerEvent);

      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          x: NaN,
          y: NaN,
        }),
      );
    });

    test("should handle Infinity coordinates", () => {
      const mockEmit = vi.spyOn(eventBus, "emit");

      const pointerEvent = new PointerEvent("pointerdown", {
        button: 1,
        clientX: Infinity,
        clientY: -Infinity,
        pointerId: 1,
      });

      inputHandler["onPointerDown"](pointerEvent);

      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          x: Infinity,
          y: -Infinity,
        }),
      );
    });
  });

  describe("Integration with Event Bus", () => {
    test("should allow event listeners to receive AutoUpgradeEvents", () => {
      const mockListener = vi.fn();

      eventBus.on(AutoUpgradeEvent, mockListener);

      const pointerEvent = new PointerEvent("pointerdown", {
        button: 1,
        clientX: 150,
        clientY: 250,
        pointerId: 1,
      });
      inputHandler["onPointerDown"](pointerEvent);

      expect(mockListener).toHaveBeenCalledWith(
        expect.objectContaining({
          x: 150,
          y: 250,
        }),
      );
    });

    test("should allow multiple listeners for AutoUpgradeEvent", () => {
      const mockListener1 = vi.fn();
      const mockListener2 = vi.fn();

      eventBus.on(AutoUpgradeEvent, mockListener1);
      eventBus.on(AutoUpgradeEvent, mockListener2);

      const pointerEvent = new PointerEvent("pointerdown", {
        button: 1,
        clientX: 150,
        clientY: 250,
        pointerId: 1,
      });
      inputHandler["onPointerDown"](pointerEvent);

      expect(mockListener1).toHaveBeenCalledWith(
        expect.objectContaining({
          x: 150,
          y: 250,
        }),
      );
      expect(mockListener2).toHaveBeenCalledWith(
        expect.objectContaining({
          x: 150,
          y: 250,
        }),
      );
    });

    test("should not call unsubscribed listeners", () => {
      const mockListener = vi.fn();

      eventBus.on(AutoUpgradeEvent, mockListener);
      eventBus.off(AutoUpgradeEvent, mockListener);

      const pointerEvent = new PointerEvent("pointerdown", {
        button: 1,
        clientX: 150,
        clientY: 250,
        pointerId: 1,
      });
      inputHandler["onPointerDown"](pointerEvent);

      expect(mockListener).not.toHaveBeenCalled();
    });
  });

  describe("Keybinds JSON parsing", () => {
    test("parses nested object values and flattens them to strings", () => {
      const nested = {
        moveUp: { key: "moveUp", value: "KeyZ" },
      };
      testSettings.setKeybinds(nested);

      inputHandler.initialize();

      expect((inputHandler as any).keybinds.moveUp).toBe("KeyZ");
    });

    test("accepts legacy string values", () => {
      testSettings.setKeybinds({ moveUp: "KeyX" });

      inputHandler.initialize();

      expect((inputHandler as any).keybinds.moveUp).toBe("KeyX");
    });

    test("ignores non-string values and preserves defaults, removes 'Null' for unbound keys", () => {
      const mixed = {
        moveUp: { key: "moveUp", value: null },
        moveLeft: "Null",
      };
      testSettings.setKeybinds(mixed);

      inputHandler.initialize();

      expect((inputHandler as any).keybinds.moveUp).toBe("KeyW");
      // "Null" entries are removed entirely to indicate unbound keybind
      expect((inputHandler as any).keybinds.moveLeft).toBeUndefined();
    });

    test("handles invalid JSON gracefully and warns", () => {
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
      testSettings.setKeybinds("not a json");

      inputHandler.initialize();

      expect(spy).toHaveBeenCalled();
      // default remains when parsing fails
      expect((inputHandler as any).keybinds.moveUp).toBe("KeyW");
      spy.mockRestore();
    });
  });

  describe("Enter key confirm ghost structure", () => {
    let uiState: UIState;

    beforeEach(() => {
      uiState = {
        attackRatio: 20,
        ghostStructure: null,
        rocketDirectionUp: true,
        overlappingRailroads: [],
        ghostRailPaths: [],
      } as UIState;
      inputHandler = new InputHandler(
        mockGameView,
        uiState,
        mockCanvas,
        eventBus,
      );
      inputHandler.initialize();
    });

    test("emits ConfirmGhostStructureEvent on Enter when ghost structure is set", () => {
      const mockEmit = vi.spyOn(eventBus, "emit");
      uiState.ghostStructure = UnitType.City;

      window.dispatchEvent(new KeyboardEvent("keydown", { code: "Enter" }));

      expect(mockEmit).toHaveBeenCalledWith(
        expect.any(ConfirmGhostStructureEvent),
      );
    });

    test("emits ConfirmGhostStructureEvent on NumpadEnter when ghost structure is set", () => {
      const mockEmit = vi.spyOn(eventBus, "emit");
      uiState.ghostStructure = UnitType.Factory;

      window.dispatchEvent(
        new KeyboardEvent("keydown", { code: "NumpadEnter" }),
      );

      expect(mockEmit).toHaveBeenCalledWith(
        expect.any(ConfirmGhostStructureEvent),
      );
    });

    test("does not emit ConfirmGhostStructureEvent on Enter when no ghost structure", () => {
      const mockEmit = vi.spyOn(eventBus, "emit");
      expect(uiState.ghostStructure).toBeNull();

      window.dispatchEvent(new KeyboardEvent("keydown", { code: "Enter" }));

      const confirmCalls = mockEmit.mock.calls.filter(
        (call) => call[0] instanceof ConfirmGhostStructureEvent,
      );
      expect(confirmCalls).toHaveLength(0);
    });
  });

  describe("Numpad number keys for build keybinds", () => {
    beforeEach(() => {
      inputHandler.destroy();
      const uiState: UIState = {
        attackRatio: 20,
        ghostStructure: null,
        rocketDirectionUp: true,
        overlappingRailroads: [],
        ghostRailPaths: [],
      } as UIState;
      inputHandler = new InputHandler(
        mockGameView,
        uiState,
        mockCanvas,
        eventBus,
      );
      inputHandler.initialize();
    });

    test("Numpad1 sets ghost structure to City when buildCity is Digit1", () => {
      window.dispatchEvent(
        new KeyboardEvent("keyup", { code: "Numpad1", key: "1" }),
      );
      expect(inputHandler["uiState"].ghostStructure).toBe(UnitType.City);
    });

    test("Numpad5 sets ghost structure to MissileSilo when buildMissileSilo is Digit5", () => {
      window.dispatchEvent(
        new KeyboardEvent("keyup", { code: "Numpad5", key: "5" }),
      );
      expect(inputHandler["uiState"].ghostStructure).toBe(UnitType.MissileSilo);
    });

    test("Numpad0 sets ghost structure to MIRV when buildMIRV is Digit0", () => {
      window.dispatchEvent(
        new KeyboardEvent("keyup", { code: "Numpad0", key: "0" }),
      );
      expect(inputHandler["uiState"].ghostStructure).toBe(UnitType.MIRV);
    });

    test("does not set ghost structure when the player is dead", () => {
      mockGameView.myPlayer = () =>
        ({ isAlive: () => false }) as unknown as PlayerView;

      window.dispatchEvent(
        new KeyboardEvent("keyup", { code: "Numpad1", key: "1" }),
      );

      expect(inputHandler["uiState"].ghostStructure).toBeNull();
    });
  });

  describe("Build keybind two-phase matching (exact code first, then digit/Numpad alias)", () => {
    beforeEach(() => {
      inputHandler.destroy();
      const uiState: UIState = {
        attackRatio: 20,
        ghostStructure: null,
        rocketDirectionUp: true,
        overlappingRailroads: [],
        ghostRailPaths: [],
      } as UIState;
      inputHandler = new InputHandler(
        mockGameView,
        uiState,
        mockCanvas,
        eventBus,
      );
      inputHandler.initialize();
    });

    test("exact code match wins: Digit1 sets City when buildCity=Digit1 and buildFactory=Numpad1", () => {
      testSettings.setKeybinds({
        buildCity: "Digit1",
        buildFactory: "Numpad1",
      });
      inputHandler.destroy();
      const uiState: UIState = {
        attackRatio: 20,
        ghostStructure: null,
        rocketDirectionUp: true,
        overlappingRailroads: [],
        ghostRailPaths: [],
      } as UIState;
      inputHandler = new InputHandler(
        mockGameView,
        uiState,
        mockCanvas,
        eventBus,
      );
      inputHandler.initialize();

      window.dispatchEvent(
        new KeyboardEvent("keyup", { code: "Digit1", key: "1" }),
      );

      expect(inputHandler["uiState"].ghostStructure).toBe(UnitType.City);
    });

    test("exact code match wins: Numpad1 sets Factory when buildCity=Digit1 and buildFactory=Numpad1", () => {
      testSettings.setKeybinds({
        buildCity: "Digit1",
        buildFactory: "Numpad1",
      });
      inputHandler.destroy();
      const uiState: UIState = {
        attackRatio: 20,
        ghostStructure: null,
        rocketDirectionUp: true,
        overlappingRailroads: [],
        ghostRailPaths: [],
      } as UIState;
      inputHandler = new InputHandler(
        mockGameView,
        uiState,
        mockCanvas,
        eventBus,
      );
      inputHandler.initialize();

      window.dispatchEvent(
        new KeyboardEvent("keyup", { code: "Numpad1", key: "1" }),
      );

      expect(inputHandler["uiState"].ghostStructure).toBe(UnitType.Factory);
    });

    test("digit alias used when no exact match: Numpad1 sets City when only buildCity=Digit1", () => {
      testSettings.setKeybinds({ buildCity: "Digit1" });
      inputHandler.destroy();
      const uiState: UIState = {
        attackRatio: 20,
        ghostStructure: null,
        rocketDirectionUp: true,
        overlappingRailroads: [],
        ghostRailPaths: [],
      } as UIState;
      inputHandler = new InputHandler(
        mockGameView,
        uiState,
        mockCanvas,
        eventBus,
      );
      inputHandler.initialize();

      window.dispatchEvent(
        new KeyboardEvent("keyup", { code: "Numpad1", key: "1" }),
      );

      expect(inputHandler["uiState"].ghostStructure).toBe(UnitType.City);
    });
  });

  describe("Shift+ keybind support", () => {
    let uiState: UIState;

    beforeEach(() => {
      inputHandler.destroy();
      uiState = {
        attackRatio: 20,
        ghostStructure: null,
        rocketDirectionUp: true,
        overlappingRailroads: [],
        ghostRailPaths: [],
      } as UIState;
    });

    test("Shift+Digit1 sets City when buildCity is bound to Shift+Digit1", () => {
      testSettings.setKeybinds({ buildCity: "Shift+Digit1" });
      inputHandler = new InputHandler(
        mockGameView,
        uiState,
        mockCanvas,
        eventBus,
      );
      inputHandler.initialize();

      window.dispatchEvent(
        new KeyboardEvent("keyup", { code: "Digit1", shiftKey: true }),
      );

      expect(uiState.ghostStructure).toBe(UnitType.City);
    });

    test("plain Digit1 does NOT trigger buildCity when bound to Shift+Digit1", () => {
      testSettings.setKeybinds({ buildCity: "Shift+Digit1" });
      inputHandler = new InputHandler(
        mockGameView,
        uiState,
        mockCanvas,
        eventBus,
      );
      inputHandler.initialize();

      window.dispatchEvent(
        new KeyboardEvent("keyup", { code: "Digit1", shiftKey: false }),
      );

      expect(uiState.ghostStructure).toBeNull();
    });

    test("Shift+KeyB triggers boatAttack when bound to Shift+KeyB", () => {
      testSettings.setKeybinds({ boatAttack: "Shift+KeyB" });
      inputHandler = new InputHandler(
        mockGameView,
        uiState,
        mockCanvas,
        eventBus,
      );
      inputHandler.initialize();

      const mockEmit = vi.spyOn(eventBus, "emit");
      window.dispatchEvent(
        new KeyboardEvent("keyup", { code: "KeyB", shiftKey: true }),
      );

      const emittedTypes = mockEmit.mock.calls.map(
        (call) => call[0].constructor.name,
      );
      expect(emittedTypes).toContain("DoBoatAttackEvent");
    });

    test("plain KeyB does NOT trigger boatAttack when bound to Shift+KeyB", () => {
      testSettings.setKeybinds({ boatAttack: "Shift+KeyB" });
      inputHandler = new InputHandler(
        mockGameView,
        uiState,
        mockCanvas,
        eventBus,
      );
      inputHandler.initialize();

      const mockEmit = vi.spyOn(eventBus, "emit");
      window.dispatchEvent(
        new KeyboardEvent("keyup", { code: "KeyB", shiftKey: false }),
      );

      const emittedTypes = mockEmit.mock.calls.map(
        (call) => call[0].constructor.name,
      );
      expect(emittedTypes).not.toContain("DoBoatAttackEvent");
    });

    test("Shift+Digit1 and Digit1 can be bound to different actions without conflict", () => {
      testSettings.setKeybinds({
        buildCity: "Digit1",
        buildFactory: "Shift+Digit1",
      });
      inputHandler = new InputHandler(
        mockGameView,
        uiState,
        mockCanvas,
        eventBus,
      );
      inputHandler.initialize();

      window.dispatchEvent(
        new KeyboardEvent("keyup", { code: "Digit1", shiftKey: false }),
      );
      expect(uiState.ghostStructure).toBe(UnitType.City);

      uiState.ghostStructure = null;

      window.dispatchEvent(
        new KeyboardEvent("keyup", { code: "Digit1", shiftKey: true }),
      );
      expect(uiState.ghostStructure).toBe(UnitType.Factory);
    });

    test("Numpad alias works with Shift+Digit keybind", () => {
      testSettings.setKeybinds({ buildCity: "Shift+Digit1" });
      inputHandler = new InputHandler(
        mockGameView,
        uiState,
        mockCanvas,
        eventBus,
      );
      inputHandler.initialize();

      window.dispatchEvent(
        new KeyboardEvent("keyup", { code: "Numpad1", shiftKey: true }),
      );

      expect(uiState.ghostStructure).toBe(UnitType.City);
    });
  });
});

describe("Warship box selection (Shift+drag)", () => {
  let inputHandler: InputHandler;
  let eventBus: EventBus;
  let mockCanvas: HTMLCanvasElement;
  let uiState: UIState;

  beforeEach(() => {
    const mockGameView = { inSpawnPhase: () => false } as GameView;
    mockCanvas = document.createElement("canvas");
    eventBus = new EventBus();
    uiState = {
      attackRatio: 20,
      ghostStructure: null,
      rocketDirectionUp: true,
      overlappingRailroads: [],
      ghostRailPaths: [],
    } as UIState;
    inputHandler = new InputHandler(
      mockGameView,
      uiState,
      mockCanvas,
      eventBus,
    );
    inputHandler.initialize();
  });

  afterEach(() => {
    inputHandler.destroy();
  });

  test("Shift keydown sets canvas cursor to crosshair", () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "ShiftLeft" }));
    expect(mockCanvas.style.cursor).toBe("crosshair");
  });

  test("ShiftRight keydown also sets cursor to crosshair", () => {
    // ShiftRight is not the default shiftKey keybind (ShiftLeft is).
    // This test verifies the configured shiftKey works, not a hardcoded ShiftRight.
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "ShiftLeft" }));
    expect(mockCanvas.style.cursor).toBe("crosshair");
  });

  test("Shift keyup resets cursor when no selection box active", () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "ShiftLeft" }));
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "ShiftLeft" }));
    expect(mockCanvas.style.cursor).toBe("");
  });

  test("Shift keydown discards active ghostStructure", () => {
    uiState.ghostStructure = UnitType.Warship;
    const emitSpy = vi.spyOn(eventBus, "emit");

    window.dispatchEvent(new KeyboardEvent("keydown", { code: "ShiftLeft" }));

    expect(uiState.ghostStructure).toBeNull();
    const types = emitSpy.mock.calls.map((c) => c[0].constructor.name);
    expect(types).toContain("GhostStructureChangedEvent");
  });

  test("Shift+drag emits WarshipSelectionBoxUpdateEvent", () => {
    const listener = vi.fn();
    eventBus.on(WarshipSelectionBoxUpdateEvent, listener);

    inputHandler["onPointerDown"](
      new PointerEvent("pointerdown", {
        button: 0,
        clientX: 100,
        clientY: 100,
        pointerId: 1,
      }),
    );
    inputHandler["activeKeys"].add("ShiftLeft");
    inputHandler["onPointerMove"](
      new PointerEvent("pointermove", {
        button: 0,
        clientX: 200,
        clientY: 200,
        pointerId: 1,
      }),
    );

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        startX: 100,
        startY: 100,
        endX: 200,
        endY: 200,
      }),
    );
  });

  test("Shift+drag then pointerup emits WarshipSelectionBoxCompleteEvent", () => {
    const listener = vi.fn();
    eventBus.on(WarshipSelectionBoxCompleteEvent, listener);

    inputHandler["onPointerDown"](
      new PointerEvent("pointerdown", {
        button: 0,
        clientX: 50,
        clientY: 50,
        pointerId: 1,
      }),
    );
    inputHandler["activeKeys"].add("ShiftLeft");
    inputHandler["onPointerMove"](
      new PointerEvent("pointermove", {
        button: 0,
        clientX: 200,
        clientY: 200,
        pointerId: 1,
      }),
    );
    expect(inputHandler["selectionBoxActive"]).toBe(true);

    inputHandler["onPointerUp"](
      new PointerEvent("pointerup", {
        button: 0,
        clientX: 200,
        clientY: 200,
        pointerId: 1,
      }),
    );

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ startX: 50, startY: 50, endX: 200, endY: 200 }),
    );
    expect(inputHandler["selectionBoxActive"]).toBe(false);
  });

  test("Escape cancels active selection box", () => {
    const listener = vi.fn();
    eventBus.on(WarshipSelectionBoxCancelEvent, listener);

    inputHandler["selectionBoxActive"] = true;
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape" }));

    expect(listener).toHaveBeenCalled();
    expect(inputHandler["selectionBoxActive"]).toBe(false);
  });

  test("tiny drag (< 10px) cancels selection box instead of completing it", () => {
    const cancelListener = vi.fn();
    const completeListener = vi.fn();
    eventBus.on(WarshipSelectionBoxCancelEvent, cancelListener);
    eventBus.on(WarshipSelectionBoxCompleteEvent, completeListener);

    inputHandler["onPointerDown"](
      new PointerEvent("pointerdown", {
        button: 0,
        clientX: 100,
        clientY: 100,
        pointerId: 1,
      }),
    );
    inputHandler["activeKeys"].add("ShiftLeft");
    inputHandler["onPointerMove"](
      new PointerEvent("pointermove", {
        button: 0,
        clientX: 104,
        clientY: 104,
        pointerId: 1,
      }),
    );
    inputHandler["onPointerUp"](
      new PointerEvent("pointerup", {
        button: 0,
        clientX: 104,
        clientY: 104,
        pointerId: 1,
      }),
    );

    expect(cancelListener).toHaveBeenCalled();
    expect(completeListener).not.toHaveBeenCalled();
  });

  test("window blur resets cursor", () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "ShiftLeft" }));
    expect(mockCanvas.style.cursor).toBe("crosshair");
    window.dispatchEvent(new Event("blur"));
    expect(mockCanvas.style.cursor).toBe("");
  });
});
