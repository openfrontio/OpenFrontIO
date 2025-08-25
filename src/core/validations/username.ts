import {
  collapseDuplicatesTransformer,
  englishDataset,
  englishRecommendedTransformers,
  RegExpMatcher,
  resolveConfusablesTransformer,
  resolveLeetSpeakTransformer,
  skipNonAlphabeticTransformer,
} from "obscenity";
import { translateText } from "../../client/Utils";
import { simpleHash } from "../Util";

const matcher = new RegExpMatcher({
  ...englishDataset.build(),
  ...englishRecommendedTransformers,
  ...resolveConfusablesTransformer(),
  ...skipNonAlphabeticTransformer(),
  ...collapseDuplicatesTransformer(),
  ...resolveLeetSpeakTransformer(),
});

export const MIN_USERNAME_LENGTH = 3;
export const MAX_USERNAME_LENGTH = 27;

const validPattern = /^[a-zA-Z0-9_[\] 🐈🍀üÜ]+$/u;

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
    return { error: translateText("username.not_string"), isValid: false };
  }

  if (username.length < MIN_USERNAME_LENGTH) {
    return {
      error: translateText("username.too_short", {
        min: MIN_USERNAME_LENGTH,
      }),
      isValid: false,
    };
  }

  if (username.length > MAX_USERNAME_LENGTH) {
    return {
      error: translateText("username.too_long", {
        max: MAX_USERNAME_LENGTH,
      }),
      isValid: false,
    };
  }

  if (!validPattern.test(username)) {
    return {
      error: translateText("username.invalid_chars", {
        max: MAX_USERNAME_LENGTH,
      }),
      isValid: false,
    };
  }

  // All checks passed
  return { isValid: true };
}

export function sanitizeUsername(str: string): string {
  const sanitized = Array.from(str)
    .filter((ch) => validPattern.test(ch))
    .join("")
    .slice(0, MAX_USERNAME_LENGTH);
  return sanitized.padEnd(MIN_USERNAME_LENGTH, "x");
}
