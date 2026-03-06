// Mocks the output of translation functions to return predictable values.
vi.mock("../src/client/Utils", () => ({
  translateText: (key: string, vars?: any) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}));

import {
  MAX_USERNAME_LENGTH,
  validateUsername,
} from "../src/core/validations/username";

describe("username.ts functions", () => {
  describe("validateUsername", () => {
    test("rejects non-string", () => {
      // @ts-expect-error: Testing non-string input to validateUsername on purpose
      const res = validateUsername(123);
      expect(res.isValid).toBe(false);
      expect(res.error).toBeDefined();
    });
    test("rejects too short", () => {
      const res = validateUsername("ab");
      expect(res.isValid).toBe(false);
    });
    test("rejects too long", () => {
      const long = "a".repeat(MAX_USERNAME_LENGTH + 1);
      const res = validateUsername(long);
      expect(res.isValid).toBe(false);
    });
    test("rejects invalid chars", () => {
      const res = validateUsername("Invalid!Name");
      expect(res.isValid).toBe(false);
    });
    test("accepts valid ASCII names", () => {
      const res = validateUsername("Good_Name123");
      expect(res.isValid).toBe(true);
    });
    test("accepts allowed Unicode like ü", () => {
      const res = validateUsername("Üser");
      expect(res.isValid).toBe(true);
    });
  });
});
