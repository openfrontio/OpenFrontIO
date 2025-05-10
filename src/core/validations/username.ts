import {
  RegExpMatcher,
  englishDataset,
  englishRecommendedTransformers,
} from "obscenity";
import { translateText } from "../../client/Utils";
import { simpleHash } from "../Util";

const matcher = new RegExpMatcher({
  ...englishDataset.build(),
  ...englishRecommendedTransformers,
});

export const MIN_USERNAME_LENGTH = 3;
export const MAX_USERNAME_LENGTH = 27;

const validPattern = /^[a-zA-Z0-9_\[\] 🐈🍀üÜ]+$/u;

const shadowNames = [
  "NicePeopleOnly",
  "BeKindPlz",
  "LearningManners",
  "StayClassy",
  "BeNicer",
  "NeedHugs",
  "MakeFriends",
];

export function fixProfaneUsername(username: string): string {
  if (isProfaneUsername(username)) {
    return shadowNames[simpleHash(username) % shadowNames.length];
  }
  return username;
}

export function isProfaneUsername(username: string): boolean {
  return matcher.hasMatch(username) || username.toLowerCase().includes("nig");
}

export function validateUsername(username: string): {
  isValid: boolean;
  error?: string;
} {
  if (typeof username !== "string") {
    return { isValid: false, error: translateText("username.not_string") };
  }

  if (username.length < MIN_USERNAME_LENGTH) {
    return {
      isValid: false,
      error: translateText("username.too_short", {
        min: MIN_USERNAME_LENGTH,
      }),
    };
  }

  if (username.length > MAX_USERNAME_LENGTH) {
    return {
      isValid: false,
      error: translateText("username.too_long", {
        max: MAX_USERNAME_LENGTH,
      }),
    };
  }

  if (!validPattern.test(username)) {
    return {
      isValid: false,
      error: translateText("username.invalid_chars", {
        max: MAX_USERNAME_LENGTH,
      }),
    };
  }

  // All checks passed
  return { isValid: true };
}

export function sanitizeUsername(str: string): string {
  let sanitized = str.replace(/[^a-zA-Z0-9_\[\] 🐈🍀]/gu, "");
  if (sanitized.length < MIN_USERNAME_LENGTH) {
    sanitized += Math.random().toString(36).substring(2, 2 + MIN_USERNAME_LENGTH - sanitized.length);
  }
  return sanitized.slice(0, MAX_USERNAME_LENGTH);
}
