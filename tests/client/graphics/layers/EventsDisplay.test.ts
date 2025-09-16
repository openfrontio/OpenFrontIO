import { EventsDisplay } from "../../../../src/client/graphics/layers/EventsDisplay";
import { Game, UnitType } from "../../../../src/core/game/Game";

describe("EventsDisplay - Boat Countdown", () => {
  let eventsDisplay: EventsDisplay;
  let mockGame: Partial<Game>;

  beforeEach(() => {
    // Mock the game object
    mockGame = {
      ticks: () => 1000,
      ownerID: () => 1,
      playerBySmallID: () => null,
      x: () => 0,
      y: () => 0,
      ref: () => ({ x: 0, y: 0 }),
      isShore: () => false,
      manhattanDist: () => 10,
    };

    // Create EventsDisplay instance
    eventsDisplay = new EventsDisplay();
    // @ts-expect-error - Access private method for testing
    eventsDisplay.game = mockGame;
  });

  describe("formatCountdown", () => {
    it("should return 'Arriving...' for zero or negative ticks", () => {
      // @ts-expect-error - Access private method for testing
      const result1 = eventsDisplay.formatCountdown(0);
      // @ts-expect-error - Access private method for testing
      const result2 = eventsDisplay.formatCountdown(-5);

      expect(result1).toBe("Arriving...");
      expect(result2).toBe("Arriving...");
    });

    it("should format seconds correctly for values under 60", () => {
      // @ts-expect-error - Access private method for testing
      const result1 = eventsDisplay.formatCountdown(30);
      // @ts-expect-error - Access private method for testing
      const result2 = eventsDisplay.formatCountdown(45);

      expect(result1).toBe("30s");
      expect(result2).toBe("45s");
    });

    it("should format minutes and seconds correctly for values over 60", () => {
      // @ts-expect-error - Access private method for testing
      const result1 = eventsDisplay.formatCountdown(90);
      // @ts-expect-error - Access private method for testing
      const result2 = eventsDisplay.formatCountdown(125);

      expect(result1).toBe("1m 30s");
      expect(result2).toBe("2m 5s");
    });

    it("should handle edge cases correctly", () => {
      // @ts-expect-error - Access private method for testing
      const result1 = eventsDisplay.formatCountdown(60);
      // @ts-expect-error - Access private method for testing
      const result2 = eventsDisplay.formatCountdown(1);

      expect(result1).toBe("1m 0s");
      expect(result2).toBe("1s");
    });
  });

  describe("calculateBoatCountdown", () => {
    it("should return 0 for boats that have been traveling too long", () => {
      const mockBoat = {
        createdAt: () => 500, // 500 ticks ago
        isActive: () => true,
        retreating: () => false,
        id: () => 1,
        type: () => UnitType.TransportShip,
        tile: () => ({ x: 0, y: 0 }),
        estimatedArrivalTick: () => undefined,
      };

      // @ts-expect-error - Access private method for testing
      const result = eventsDisplay.calculateBoatCountdown(mockBoat);

      expect(result).toBe(0);
    });

    it("should use server-provided estimatedArrivalTick when available", () => {
      const mockBoat = {
        createdAt: () => 950, // 50 ticks ago
        isActive: () => true,
        retreating: () => false,
        id: () => 1,
        type: () => UnitType.TransportShip,
        tile: () => ({ x: 0, y: 0 }),
        estimatedArrivalTick: () => 1050, // 50 ticks from now
      };

      // @ts-expect-error - Access private method for testing
      const result = eventsDisplay.calculateBoatCountdown(mockBoat);

      expect(result).toBe(50);
    });

    it("should fall back to client-side estimation when server data unavailable", () => {
      const mockBoat = {
        createdAt: () => 950, // 50 ticks ago
        isActive: () => true,
        retreating: () => false,
        id: () => 1,
        type: () => UnitType.TransportShip,
        tile: () => ({ x: 0, y: 0 }),
        estimatedArrivalTick: () => undefined,
      };

      // @ts-expect-error - Access private method for testing
      const result = eventsDisplay.calculateBoatCountdown(mockBoat);

      // Should return a positive number (fallback estimation)
      expect(result).toBeGreaterThan(0);
    });
  });
});
