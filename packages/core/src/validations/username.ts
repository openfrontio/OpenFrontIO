import {
  RegExpMatcher,
  englishDataset,
  englishRecommendedTransformers,
} from "obscenity";
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
  return matcher.hasMatch(username);
}

export function validateUsername(username: string): {
  isValid: boolean;
  error?: string;
} {
  if (typeof username !== "string") {
    return { isValid: false, error: "Username must be a string." };
  }

  if (username.length < MIN_USERNAME_LENGTH) {
    return {
      isValid: false,
      error: `Username must be at least ${MIN_USERNAME_LENGTH} characters long.`,
    };
  }

  if (username.length > MAX_USERNAME_LENGTH) {
    return {
      isValid: false,
      error: `Username must not exceed ${MAX_USERNAME_LENGTH} characters.`,
    };
  }

  if (!validPattern.test(username)) {
    return {
      isValid: false,
      error:
        "Username can only contain letters, numbers, spaces, underscores, and [square brackets].",
    };
  }

  // All checks passed
  return { isValid: true };
}

export function sanitizeUsername(str: string): string {
  const sanitized = str
    .replace(/[^a-zA-Z0-9_\[\] 🐈🍀]/gu, "")
    .slice(0, MAX_USERNAME_LENGTH);
  return sanitized.padEnd(MIN_USERNAME_LENGTH, "x");
}
