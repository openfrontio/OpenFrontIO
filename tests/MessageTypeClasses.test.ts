import { jest } from "@jest/globals";

import { getMessageTypeClasses, severityColors } from "../src/client/Utils";
import { MessageType } from "../src/core/game/Game";

describe("getMessageTypeClasses", () => {
  // Spy on console.warn to track when the default case is hit
  let consoleSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("should return a valid CSS class for every MessageType", () => {
    const messageTypes = Object.values(MessageType).filter(
      (value): value is MessageType => typeof value === "number",
    );

    messageTypes.forEach((messageType) => {
      const result = getMessageTypeClasses(messageType);

      expect(Object.values(severityColors)).toContain(result);

      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
    });
  });

  it("should not trigger console.warn for any MessageType", () => {
    const messageTypes = Object.values(MessageType).filter(
      (value): value is MessageType => typeof value === "number",
    );

    messageTypes.forEach((messageType) => {
      getMessageTypeClasses(messageType);
    });

    // No message type should fall through to the default case
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("should return white color and warn for unknown message types", () => {
    // Cast to MessageType to test the default case
    const unknownType = 999 as MessageType;

    const result = getMessageTypeClasses(unknownType);

    expect(result).toBe(severityColors["white"]);
    expect(consoleSpy).toHaveBeenCalledWith(
      "Message type 999 has no explicit color",
    );
  });
});
