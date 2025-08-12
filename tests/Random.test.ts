import {
  generateCryptoRandomUUID,
  generateRandomBoolean,
  generateRandomFloat,
  generateRandomNumber,
  generateRandomString,
  pickRandomElement,
  RandomStringOptions,
} from "../src/core/Random";

describe("Random utilities", () => {
  describe("generateRandomFloat", () => {
    it("should generate number between min and max", () => {
      const min = 5.5;
      const max = 10.5;
      const result = generateRandomFloat(max, min);

      expect(result).toBeGreaterThanOrEqual(min);
      expect(result).toBeLessThanOrEqual(max);
      expect(typeof result).toBe("number");
    });

    it("should handle zero as minimum value", () => {
      const max = 100;
      const result = generateRandomFloat(max);

      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(max);
    });

    it("should handle negative numbers", () => {
      const min = -10;
      const max = -5;
      const result = generateRandomFloat(max, min);

      expect(result).toBeGreaterThanOrEqual(min);
      expect(result).toBeLessThanOrEqual(max);
    });

    it("should return same value when min equals max", () => {
      const value = 42.5;
      const result = generateRandomFloat(value, value);

      expect(result).toBe(value);
    });
  });

  describe("generateRandomNumber", () => {
    it("should generate integer between min and max inclusive", () => {
      const min = 5;
      const max = 10;

      for (let i = 0; i < 20; i++) {
        const result = generateRandomNumber(max, min);
        expect(Number.isInteger(result)).toBe(true);
        expect(result).toBeGreaterThanOrEqual(min);
        expect(result).toBeLessThanOrEqual(max);
      }
    });

    it("should use default values when no parameters provided", () => {
      const result = generateRandomNumber();

      expect(Number.isInteger(result)).toBe(true);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(8);
    });

    it("should handle single parameter as max", () => {
      const max = 15;
      const result = generateRandomNumber(max);

      expect(Number.isInteger(result)).toBe(true);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(max);
    });

    it("should handle zero range", () => {
      const value = 7;
      const result = generateRandomNumber(value, value);

      expect(result).toBe(value);
    });
  });

  describe("generateRandomBoolean", () => {
    it("should return a boolean value", () => {
      const result = generateRandomBoolean();

      expect(typeof result).toBe("boolean");
      expect([true, false]).toContain(result);
    });

    it("should generate both true and false values over multiple calls", () => {
      const results = new Set();

      for (let i = 0; i < 20; i++) {
        results.add(generateRandomBoolean());
        if (results.size === 2) break;
      }

      expect(results.size).toBe(2);
      expect(results.has(true)).toBe(true);
      expect(results.has(false)).toBe(true);
    });

    it("should have roughly equal distribution over many calls", () => {
      let trueCount = 0;
      let falseCount = 0;
      const iterations = 100;

      for (let i = 0; i < iterations; i++) {
        if (generateRandomBoolean()) {
          trueCount++;
        } else {
          falseCount++;
        }
      }

      const ratio = trueCount / iterations;
      expect(ratio).toBeGreaterThan(0.3);
      expect(ratio).toBeLessThan(0.7);
    });
  });

  describe("generateRandomString", () => {
    it("should generate string with default options", () => {
      const result = generateRandomString(null);

      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result.length).toBeLessThanOrEqual(20);
      expect(/[a-zA-Z0-9]/.test(result)).toBe(true);
    });

    it("should respect minLength and maxLength", () => {
      const options: RandomStringOptions = {
        minLength: 5,
        maxLength: 10,
      };

      for (let i = 0; i < 20; i++) {
        const result = generateRandomString(options);
        expect(result.length).toBeGreaterThanOrEqual(5);
        expect(result.length).toBeLessThanOrEqual(10);
      }
    });

    it("should generate exact length when min equals max", () => {
      const options: RandomStringOptions = {
        minLength: 8,
        maxLength: 8,
      };

      const result = generateRandomString(options);
      expect(result.length).toBe(8);
    });

    it("should include only lowercase when specified", () => {
      const options: RandomStringOptions = {
        includeLowercase: true,
        includeUppercase: false,
        includeNumbers: false,
        includeSpecial: false,
        minLength: 10,
        maxLength: 10,
      };

      const result = generateRandomString(options);
      expect(/^[a-z]+$/.test(result)).toBe(true);
    });

    it("should include only uppercase when specified", () => {
      const options: RandomStringOptions = {
        includeLowercase: false,
        includeUppercase: true,
        includeNumbers: false,
        includeSpecial: false,
        minLength: 10,
        maxLength: 10,
      };

      const result = generateRandomString(options);
      expect(/^[A-Z]+$/.test(result)).toBe(true);
    });

    it("should include only numbers when specified", () => {
      const options: RandomStringOptions = {
        includeLowercase: false,
        includeUppercase: false,
        includeNumbers: true,
        includeSpecial: false,
        minLength: 10,
        maxLength: 10,
      };

      const result = generateRandomString(options);
      expect(/^[0-9]+$/.test(result)).toBe(true);
    });

    it("should include special characters when specified", () => {
      const options: RandomStringOptions = {
        includeLowercase: false,
        includeUppercase: false,
        includeNumbers: false,
        includeSpecial: true,
        minLength: 10,
        maxLength: 10,
      };

      const result = generateRandomString(options);
      expect(/^[!@#$%^&*()_+\-=[\]{}|;:,.<>?]+$/.test(result)).toBe(true);
    });

    it("should use custom characters when provided", () => {
      const options: RandomStringOptions = {
        customCharacters: "ABC123",
        minLength: 20,
        maxLength: 20,
      };

      const result = generateRandomString(options);
      expect(/^[ABC123]+$/.test(result)).toBe(true);
      expect(result.length).toBe(20);
    });

    it("should throw error when no character set selected", () => {
      const options: RandomStringOptions = {
        includeLowercase: false,
        includeUppercase: false,
        includeNumbers: false,
        includeSpecial: false,
      };

      expect(() => generateRandomString(options)).toThrow(
        "No character set selected for random string generation",
      );
    });

    it("should handle mixed character sets", () => {
      const options: RandomStringOptions = {
        includeLowercase: true,
        includeUppercase: true,
        includeNumbers: true,
        includeSpecial: true,
        minLength: 50,
        maxLength: 50,
      };

      const result = generateRandomString(options);
      expect(result.length).toBe(50);
      expect(
        /[a-z]/.test(result) ||
          /[A-Z]/.test(result) ||
          /[0-9]/.test(result) ||
          /[!@#$%^&*()_+\-=[\]{}|;:,.<>?]/.test(result),
      ).toBe(true);
    });
  });

  describe("pickRandomElement", () => {
    it("should pick element from array", () => {
      const array = ["apple", "banana", "cherry"];
      const result = pickRandomElement(array);

      expect(array).toContain(result);
    });

    it("should handle single element array", () => {
      const array = ["onlyElement"];
      const result = pickRandomElement(array);

      expect(result).toBe("onlyElement");
    });

    it("should work with different data types", () => {
      const numberArray = [1, 2, 3, 4, 5];
      const numberResult = pickRandomElement(numberArray);
      expect(numberArray).toContain(numberResult);
      expect(typeof numberResult).toBe("number");

      const booleanArray = [true, false];
      const booleanResult = pickRandomElement(booleanArray);
      expect(booleanArray).toContain(booleanResult);
      expect(typeof booleanResult).toBe("boolean");
    });

    it("should distribute picks across all elements over multiple calls", () => {
      const array = [1, 2, 3, 4, 5];
      const results = new Set();

      for (let i = 0; i < 1000; i++) {
        results.add(pickRandomElement(array));
        if (results.size >= 3) break;
      }

      expect(results.size).toBeGreaterThanOrEqual(3);
    });

    it("should work with object arrays", () => {
      const array = [
        { id: 1, name: "first" },
        { id: 2, name: "second" },
        { id: 3, name: "third" },
      ];

      const result = pickRandomElement(array);
      expect(array).toContain(result);
      expect(result).toHaveProperty("id");
      expect(result).toHaveProperty("name");
    });
  });

  describe("generateCryptoRandomUUID", () => {
    it("should generate valid UUID format", () => {
      const result = generateCryptoRandomUUID();
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

      expect(typeof result).toBe("string");
      expect(uuidRegex.test(result)).toBe(true);
    });

    it("should generate unique UUIDs", () => {
      const uuids = new Set();

      for (let i = 0; i < 20; i++) {
        uuids.add(generateCryptoRandomUUID());
      }

      expect(uuids.size).toBe(20);
    });

    it("should generate UUIDs with correct length", () => {
      const result = generateCryptoRandomUUID();
      expect(result.length).toBe(36);
    });

    it("should have hyphens in correct positions", () => {
      const result = generateCryptoRandomUUID();
      expect(result.charAt(8)).toBe("-");
      expect(result.charAt(13)).toBe("-");
      expect(result.charAt(18)).toBe("-");
      expect(result.charAt(23)).toBe("-");
    });

    it("should contain only valid hexadecimal characters and hyphens", () => {
      const result = generateCryptoRandomUUID();
      const validChars = /^[0-9a-f-]+$/i;
      expect(validChars.test(result)).toBe(true);
    });
  });

  describe("Edge cases and error handling", () => {
    it("should return undefined for empty array in pickRandomElement", () => {
      const array: string[] = [];
      const result = pickRandomElement(array);
      expect(result).toBeUndefined();
    });

    it("should handle very large numbers in generateRandomNumber", () => {
      const result = generateRandomNumber(1000000, 999999);
      expect(result).toBeGreaterThanOrEqual(999999);
      expect(result).toBeLessThanOrEqual(1000000);
    });

    it("should handle very small ranges in generateRandomFloat", () => {
      const min = 1.0000001;
      const max = 1.0000002;
      const result = generateRandomFloat(max, min);
      expect(result).toBeGreaterThanOrEqual(min);
      expect(result).toBeLessThanOrEqual(max);
    });
  });
});
