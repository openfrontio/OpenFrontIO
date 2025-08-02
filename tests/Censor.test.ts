// Mocking the obscenity library to control its behavior in tests.
jest.mock("obscenity", () => {
  return {
    RegExpMatcher: class {
      private dummy: string[] = ["foo", "bar", "leet", "code"];
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
  };
});

import {
  fixProfaneUsername,
  isProfaneUsername,
  MAX_USERNAME_LENGTH,
  MIN_USERNAME_LENGTH,
  sanitizeUsername,
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
