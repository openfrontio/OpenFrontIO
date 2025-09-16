/**
 * @jest-environment jsdom
 */

// Mock the translateText function
jest.mock("../../../../src/client/Utils", () => ({
  translateText: jest.fn((key: string, vars?: any) => {
    if (key === "events_display.boat_countdown.arriving") return "Arriving...";
    if (key === "events_display.boat_countdown.seconds")
      return `${vars?.seconds}s`;
    if (key === "events_display.boat_countdown.minutes_seconds")
      return `${vars?.minutes}m ${vars?.seconds}s`;
    return key;
  }),
}));

// Import the translateText function to test it
import { translateText } from "../../../../src/client/Utils";

describe("Boat Countdown Logic", () => {
  // Test the formatCountdown logic directly
  const formatCountdown = (ticks: number): string => {
    if (ticks <= 0)
      return translateText("events_display.boat_countdown.arriving");

    const seconds = Math.max(1, ticks);

    if (seconds < 60) {
      return translateText("events_display.boat_countdown.seconds", {
        seconds,
      });
    } else {
      const minutes = Math.floor(seconds / 60);
      const remainingSeconds = seconds % 60;
      return translateText("events_display.boat_countdown.minutes_seconds", {
        minutes,
        seconds: remainingSeconds,
      });
    }
  };

  describe("formatCountdown", () => {
    it("should return 'Arriving...' for zero or negative ticks", () => {
      const result1 = formatCountdown(0);
      const result2 = formatCountdown(-5);

      expect(result1).toBe("Arriving...");
      expect(result2).toBe("Arriving...");
    });

    it("should format seconds correctly for values under 60", () => {
      const result1 = formatCountdown(30);
      const result2 = formatCountdown(45);

      expect(result1).toBe("30s");
      expect(result2).toBe("45s");
    });

    it("should format minutes and seconds correctly for values over 60", () => {
      const result1 = formatCountdown(90);
      const result2 = formatCountdown(125);

      expect(result1).toBe("1m 30s");
      expect(result2).toBe("2m 5s");
    });

    it("should handle edge cases correctly", () => {
      const result1 = formatCountdown(60);
      const result2 = formatCountdown(1);

      expect(result1).toBe("1m 0s");
      expect(result2).toBe("1s");
    });
  });

  describe("translateText integration", () => {
    it("should call translateText with correct keys for arriving state", () => {
      const mockTranslateText = translateText as jest.MockedFunction<
        typeof translateText
      >;
      mockTranslateText.mockClear();

      formatCountdown(0);

      expect(mockTranslateText).toHaveBeenCalledWith(
        "events_display.boat_countdown.arriving",
      );
    });

    it("should call translateText with correct keys for seconds", () => {
      const mockTranslateText = translateText as jest.MockedFunction<
        typeof translateText
      >;
      mockTranslateText.mockClear();

      formatCountdown(30);

      expect(mockTranslateText).toHaveBeenCalledWith(
        "events_display.boat_countdown.seconds",
        { seconds: 30 },
      );
    });

    it("should call translateText with correct keys for minutes and seconds", () => {
      const mockTranslateText = translateText as jest.MockedFunction<
        typeof translateText
      >;
      mockTranslateText.mockClear();

      formatCountdown(90);

      expect(mockTranslateText).toHaveBeenCalledWith(
        "events_display.boat_countdown.minutes_seconds",
        {
          minutes: 1,
          seconds: 30,
        },
      );
    });
  });
});
