// Mocking the obscenity library to control its behavior in tests.
jest.mock("obscenity", () => {
  return {
    collapseDuplicatesTransformer: () => ({}),
    englishDataset: { build: () => ({}) },
    englishRecommendedTransformers: {},
    RegExpMatcher: class {
      private readonly dummy: string[] = ["foo", "bar", "leet", "code"];
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
    resolveConfusablesTransformer: () => ({}),
    resolveLeetSpeakTransformer: () => ({}),
    skipNonAlphabeticTransformer: () => ({}),
  };
});

// Mocks the output of translation functions to return predictable values.
jest.mock("../src/client/Utils", () => ({
  translateText: (key: string, vars?: any) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}));

import {
  fixProfaneUsername,
  isProfaneUsername,
  MAX_USERNAME_LENGTH,
  MIN_USERNAME_LENGTH,
  sanitizeUsername,
  validateUsername,
} from "../src/core/validations/username";

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
      { profane: true, username: "l33t" }, // decodes to "leet"
      { profane: true, username: "L33T" },
      { profane: true, username: "l33tc0de" }, // decodes to "leetcode", contains "leet" and "code"
      { profane: true, username: "L33TC0DE" },
      { profane: true, username: "foo123" }, // contains "foo"
      { profane: true, username: "b4r" }, // decodes to "bar"
      { profane: false, username: "safeName" },
      { profane: false, username: "s4f3" }, // decodes to "safe" but "safe" not in dummy list
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
      { expected: "GoodName", input: "GoodName" },
      { expected: "axx", input: "a!" },
      { expected: "abx", input: "a$%b" },
      {
        expected: "abc"
          .repeat(Math.floor(MAX_USERNAME_LENGTH / 3))
          .slice(0, MAX_USERNAME_LENGTH),
        input: "abc".repeat(10),
      },
      { expected: "xxx", input: "" },
      { expected: "Ünicode🐈Test", input: "Ünicode🐈Test!" },
    ])('sanitizeUsername("%s") → "%s"', ({ input, expected }) => {
      const out = sanitizeUsername(input);
      expect(out).toBe(expected);
      expect(out.length).toBeGreaterThanOrEqual(MIN_USERNAME_LENGTH);
      expect(out.length).toBeLessThanOrEqual(MAX_USERNAME_LENGTH);
    });
  });
});
