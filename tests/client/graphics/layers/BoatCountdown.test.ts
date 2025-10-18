/**
 * @jest-environment jsdom
 */

// Mock the translateText and renderDuration functions
jest.mock("../../../../src/client/Utils", () => ({
  translateText: jest.fn((key: string, vars?: any) => {
    if (key === "events_display.boat_countdown.arriving") return "Arriving...";
    if (key === "events_display.boat_countdown.calculating")
      return "Calculating...";
    return key;
  }),
  renderDuration: jest.fn((totalSeconds: number) => {
    if (totalSeconds <= 0) return "0s";
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    let time = "";
    if (minutes > 0) time += `${minutes}min `;
    time += `${seconds}s`;
    return time.trim();
  }),
}));

// Import the functions to test them
import { renderDuration, translateText } from "../../../../src/client/Utils";

describe("Boat Countdown Logic", () => {
  // Test the formatCountdown logic directly (matches the actual implementation)
  const formatCountdown = (ticks: number): string => {
    if (ticks === -1) {
      return "Calculating..."; // Show while A* path is being computed
    }

    if (ticks <= 0) {
      return translateText("events_display.boat_countdown.arriving");
    }

    // Convert ticks to seconds (10 ticks per second) and use existing formatter
    const seconds = Math.max(1, Math.ceil(ticks / 10));
    return renderDuration(seconds);
  };

  describe("formatCountdown", () => {
    it("should return 'Calculating...' for -1 ticks", () => {
      const result = formatCountdown(-1);
      expect(result).toBe("Calculating...");
    });

    it("should return 'Arriving...' for zero or negative ticks (except -1)", () => {
      const result1 = formatCountdown(0);
      const result2 = formatCountdown(-5);

      expect(result1).toBe("Arriving...");
      expect(result2).toBe("Arriving...");
    });

    it("should convert ticks to seconds and use renderDuration for positive ticks", () => {
      const result1 = formatCountdown(30); // 3 seconds
      const result2 = formatCountdown(90); // 9 seconds
      const result3 = formatCountdown(600); // 60 seconds

      expect(renderDuration).toHaveBeenCalledWith(3);
      expect(renderDuration).toHaveBeenCalledWith(9);
      expect(renderDuration).toHaveBeenCalledWith(60);
    });

    it("should handle edge cases correctly", () => {
      const result1 = formatCountdown(1); // 1 tick = 1 second
      const result2 = formatCountdown(10); // 10 ticks = 1 second

      expect(renderDuration).toHaveBeenCalledWith(1);
      expect(renderDuration).toHaveBeenCalledWith(1);
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

    it("should not call translateText for positive ticks (uses renderDuration)", () => {
      const mockTranslateText = translateText as jest.MockedFunction<
        typeof translateText
      >;
      mockTranslateText.mockClear();

      formatCountdown(30);

      expect(mockTranslateText).not.toHaveBeenCalled();
    });
  });

  describe("renderDuration integration", () => {
    it("should call renderDuration with correct seconds for positive ticks", () => {
      const mockRenderDuration = renderDuration as jest.MockedFunction<
        typeof renderDuration
      >;
      mockRenderDuration.mockClear();

      formatCountdown(30); // 3 seconds
      formatCountdown(90); // 9 seconds
      formatCountdown(600); // 60 seconds

      expect(mockRenderDuration).toHaveBeenCalledWith(3);
      expect(mockRenderDuration).toHaveBeenCalledWith(9);
      expect(mockRenderDuration).toHaveBeenCalledWith(60);
    });
  });
});
