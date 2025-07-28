/**
 * @jest-environment jsdom
 */
import { AutoUpgradeEvent, InputHandler } from "../src/client/InputHandler";
import { EventBus } from "../src/core/EventBus";

class MockPointerEvent {
  button: number;
  clientX: number;
  clientY: number;
  pointerId: number;
  type: string;
  preventDefault: () => void;

  constructor(type: string, init: any) {
    this.type = type;
    this.button = init.button;
    this.clientX = init.clientX;
    this.clientY = init.clientY;
    this.pointerId = init.pointerId;
    this.preventDefault = jest.fn();
  }
}

global.PointerEvent = MockPointerEvent as any;

describe("InputHandler AutoUpgrade", () => {
  let inputHandler: InputHandler;
  let eventBus: EventBus;
  let mockCanvas: HTMLCanvasElement;

  beforeEach(() => {
    mockCanvas = document.createElement("canvas");
    mockCanvas.width = 800;
    mockCanvas.height = 600;

    eventBus = new EventBus();

    inputHandler = new InputHandler(mockCanvas, eventBus);
  });

  describe("Middle Mouse Button Handling", () => {
    test("should emit AutoUpgradeEvent on middle mouse button press", () => {
      const mockEmit = jest.spyOn(eventBus, "emit");

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
      const mockEmit = jest.spyOn(eventBus, "emit");

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
      const mockEmit = jest.spyOn(eventBus, "emit");

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
      const mockEmit = jest.spyOn(eventBus, "emit");

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
      const mockEmit = jest.spyOn(eventBus, "emit");

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
      const mockEmit = jest.spyOn(eventBus, "emit");

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
      const mockEmit = jest.spyOn(eventBus, "emit");

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

  describe("Pointer Event Handling", () => {
    test("should handle pointer events with different pointer IDs", () => {
      const mockEmit = jest.spyOn(eventBus, "emit");

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
      const mockEmit = jest.spyOn(eventBus, "emit");

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
      const mockEmit = jest.spyOn(eventBus, "emit");

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
      const mockEmit = jest.spyOn(eventBus, "emit");

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
      const mockEmit = jest.spyOn(eventBus, "emit");

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
      const mockEmit = jest.spyOn(eventBus, "emit");

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
      const mockListener = jest.fn();

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
      const mockListener1 = jest.fn();
      const mockListener2 = jest.fn();

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
      const mockListener = jest.fn();

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
});
