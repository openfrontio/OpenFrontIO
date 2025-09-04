/**
 * @jest-environment jsdom
 */
import { AutoUpgradeEvent } from "../src/client/InputHandler";
import { EventBus } from "../src/core/EventBus";

describe("AutoUpgrade Feature", () => {
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus();
  });

  describe("AutoUpgradeEvent", () => {
    test("should create AutoUpgradeEvent with correct coordinates", () => {
      const event = new AutoUpgradeEvent(100, 200);
      expect(event.x).toBe(100);
      expect(event.y).toBe(200);
    });

    test("should emit AutoUpgradeEvent when created", () => {
      const mockEmit = jest.spyOn(eventBus, "emit");

      const event = new AutoUpgradeEvent(150, 250);
      eventBus.emit(event);

      expect(mockEmit).toHaveBeenCalledWith(event);
      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          x: 150,
          y: 250,
        }),
      );
    });
  });

  describe("AutoUpgradeEvent Integration", () => {
    test("should handle multiple AutoUpgradeEvents", () => {
      const mockEmit = jest.spyOn(eventBus, "emit");

      const event1 = new AutoUpgradeEvent(100, 200);
      const event2 = new AutoUpgradeEvent(300, 400);

      eventBus.emit(event1);
      eventBus.emit(event2);

      expect(mockEmit).toHaveBeenCalledTimes(2);
      expect(mockEmit).toHaveBeenNthCalledWith(1, event1);
      expect(mockEmit).toHaveBeenNthCalledWith(2, event2);
    });

    test("should handle AutoUpgradeEvent with zero coordinates", () => {
      const event = new AutoUpgradeEvent(0, 0);
      expect(event.x).toBe(0);
      expect(event.y).toBe(0);
    });

    test("should handle AutoUpgradeEvent with negative coordinates", () => {
      const event = new AutoUpgradeEvent(-100, -200);
      expect(event.x).toBe(-100);
      expect(event.y).toBe(-200);
    });

    test("should handle AutoUpgradeEvent with decimal coordinates", () => {
      const event = new AutoUpgradeEvent(100.5, 200.7);
      expect(event.x).toBe(100.5);
      expect(event.y).toBe(200.7);
    });
  });

  describe("AutoUpgradeEvent Event Bus Integration", () => {
    test("should allow event listeners to subscribe to AutoUpgradeEvent", () => {
      const mockListener = jest.fn();
      const event = new AutoUpgradeEvent(100, 200);

      eventBus.on(AutoUpgradeEvent, mockListener);
      eventBus.emit(event);

      expect(mockListener).toHaveBeenCalledWith(event);
    });

    test("should allow multiple listeners for AutoUpgradeEvent", () => {
      const mockListener1 = jest.fn();
      const mockListener2 = jest.fn();
      const event = new AutoUpgradeEvent(100, 200);

      eventBus.on(AutoUpgradeEvent, mockListener1);
      eventBus.on(AutoUpgradeEvent, mockListener2);
      eventBus.emit(event);

      expect(mockListener1).toHaveBeenCalledWith(event);
      expect(mockListener2).toHaveBeenCalledWith(event);
    });

    test("should not call unsubscribed listeners", () => {
      const mockListener = jest.fn();
      const event = new AutoUpgradeEvent(100, 200);

      eventBus.on(AutoUpgradeEvent, mockListener);
      eventBus.off(AutoUpgradeEvent, mockListener);
      eventBus.emit(event);

      expect(mockListener).not.toHaveBeenCalled();
    });
  });

  describe("AutoUpgradeEvent Edge Cases", () => {
    test("should handle very large coordinates", () => {
      const event = new AutoUpgradeEvent(
        Number.MAX_SAFE_INTEGER,
        Number.MAX_SAFE_INTEGER,
      );
      expect(event.x).toBe(Number.MAX_SAFE_INTEGER);
      expect(event.y).toBe(Number.MAX_SAFE_INTEGER);
    });

    test("should handle very small coordinates", () => {
      const event = new AutoUpgradeEvent(
        Number.MIN_SAFE_INTEGER,
        Number.MIN_SAFE_INTEGER,
      );
      expect(event.x).toBe(Number.MIN_SAFE_INTEGER);
      expect(event.y).toBe(Number.MIN_SAFE_INTEGER);
    });

    test("should handle NaN coordinates", () => {
      const event = new AutoUpgradeEvent(NaN, NaN);
      expect(isNaN(event.x)).toBe(true);
      expect(isNaN(event.y)).toBe(true);
    });

    test("should handle Infinity coordinates", () => {
      const event = new AutoUpgradeEvent(Infinity, -Infinity);
      expect(event.x).toBe(Infinity);
      expect(event.y).toBe(-Infinity);
    });
  });

  describe("AutoUpgradeEvent Serialization", () => {
    test("should maintain coordinate precision", () => {
      const event = new AutoUpgradeEvent(100.123456789, 200.987654321);
      expect(event.x).toBe(100.123456789);
      expect(event.y).toBe(200.987654321);
    });

    test("should handle string conversion", () => {
      const event = new AutoUpgradeEvent(100, 200);
      const eventString = JSON.stringify(event);
      const parsedEvent = JSON.parse(eventString);

      expect(parsedEvent.x).toBe(100);
      expect(parsedEvent.y).toBe(200);
    });
  });
});
