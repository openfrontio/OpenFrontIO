/**
 * @jest-environment jsdom
 */
import { jest } from "@jest/globals";

// Mocking the obscenity library to control its behavior in tests.
jest.unstable_mockModule("obscenity", () => ({
  RegExpMatcher: class {
    dummy = ["foo", "bar", "leet", "code"];
    constructor(_opts: any) {}
    hasMatch(input: string): boolean {
      const lower = input.toLowerCase();
      const decoded = lower
        .replace(/4/g, "a")
        .replace(/3/g, "e")
        .replace(/1/g, "i")
        .replace(/0/g, "o")
        .replace(/5/g, "s")
        .replace(/7/g, "t");
      return this.dummy.some((token) => decoded.includes(token));
    }
  },
  collapseDuplicatesTransformer: () => ({}),
  englishRecommendedTransformers: {},
  englishDataset: { build: () => ({}) },
  resolveConfusablesTransformer: () => ({}),
  resolveLeetSpeakTransformer: () => ({}),
  skipNonAlphabeticTransformer: () => ({}),
}));

// Must use dynamic import AFTER mock
const {
  fixProfaneUsername,
  isProfaneUsername,
  MAX_USERNAME_LENGTH,
  MIN_USERNAME_LENGTH,
  sanitizeUsername,
  validateUsername,
} = await import("../src/core/validations/username");

// Mocks the output of translation functions to return predictable values.
jest.mock("../src/client/Utils", () => ({
  translateText: (key: string, vars?: any) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}));

/*import {
  fixProfaneUsername,
  isProfaneUsername,
  MAX_USERNAME_LENGTH,
  MIN_USERNAME_LENGTH,
  sanitizeUsername,
  validateUsername,
} from "../src/core/validations/username";*/

describe("username.ts functions", () => {
  const shadowNames = [
    "NicePeopleOnly",
    "BeKindPlz",
    "LearningManners",
    "StayClassy",
    "BeNicer",
    "NeedHugs",
    "MakeFriends",
  ];

  describe("isProfaneUsername & fixProfaneUsername with leet decoding (mocked)", () => {
    test.each([
      { username: "l33t", profane: true }, // decodes to "leet"
      { username: "L33T", profane: true },
      { username: "l33tc0de", profane: true }, // decodes to "leetcode", contains "leet" and "code"
      { username: "L33TC0DE", profane: true },
      { username: "foo123", profane: true }, // contains "foo"
      { username: "b4r", profane: true }, // decodes to "bar"
      { username: "safeName", profane: false },
      { username: "s4f3", profane: false }, // decodes to "safe" but "safe" not in dummy list
    ])('isProfaneUsername("%s") → %s', ({ username, profane }) => {
      expect(isProfaneUsername(username)).toBe(profane);
    });

    test.each([
      { username: "safeName" },
      { username: "l33t" },
      { username: "b4rUser" },
    ])('fixProfaneUsername("%s") behavior', ({ username }) => {
      const profane = isProfaneUsername(username);
      const fixed = fixProfaneUsername(username);
      if (!profane) {
        expect(fixed).toBe(username);
      } else {
        // When profane: result should be one of shadowNames
        expect(shadowNames).toContain(fixed);
      }
    });
  });

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
    test("accepts allowed Unicode like 🐈 or ü", () => {
      const res = validateUsername("Cat🐈Üser");
      expect(res.isValid).toBe(true);
    });
  });

  describe("sanitizeUsername", () => {
    test.each([
      { input: "GoodName", expected: "GoodName" },
      { input: "a!", expected: "axx" },
      { input: "a$%b", expected: "abx" },
      {
        input: "abc".repeat(10),
        expected: "abc"
          .repeat(Math.floor(MAX_USERNAME_LENGTH / 3))
          .slice(0, MAX_USERNAME_LENGTH),
      },
      { input: "", expected: "xxx" },
      { input: "Ünicode🐈Test!", expected: "Ünicode🐈Test" },
    ])('sanitizeUsername("%s") → "%s"', ({ input, expected }) => {
      const out = sanitizeUsername(input);
      expect(out).toBe(expected);
      expect(out.length).toBeGreaterThanOrEqual(MIN_USERNAME_LENGTH);
      expect(out.length).toBeLessThanOrEqual(MAX_USERNAME_LENGTH);
    });
  });
});
