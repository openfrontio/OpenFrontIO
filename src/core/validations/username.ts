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

const validPattern = new RegExp(
  '^' +
  '(?!.*[\\p{Cc}\\p{Cf}\\p{Co}\\p{Cn}\\p{Zl}\\p{Zp}])' +
  '(?=.*[\\p{L}\\p{N}_\\p{Emoji}])' +
  '[\\w \\[\\]\\p{Emoji}]+' +
  '$',
  'u'
);

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
  if (typeof username !== 'string') return false;
  const normalizedUsername = username.normalize('NFC');
  return (
    matcher.hasMatch(normalizedUsername) ||
    normalizedUsername.toLowerCase().includes("nig")
  );
}

export function validateUsername(username: string): {
  isValid: boolean;
  error?: string;
} {
  if (typeof username !== "string") {
    return { isValid: false, error: translateText("username.not_string") };
  }

  const normalizedUsername = username.normalize('NFC');

  if (normalizedUsername.length < MIN_USERNAME_LENGTH) {
    return {
      isValid: false,
      error: translateText("username.too_short", {
        min: MIN_USERNAME_LENGTH,
      }),
    };
  }

  if (normalizedUsername.length > MAX_USERNAME_LENGTH) {
    return {
      isValid: false,
      error: translateText("username.too_long", {
        max: MAX_USERNAME_LENGTH,
      }),
    };
  }

  if (!validPattern.test(normalizedUsername)) {
    return {
      isValid: false,
      error: translateText("username.invalid_chars"),
    };
  }
  // All checks passed
  return { isValid: true };
}

export function sanitizeUsername(str: string): string {
  if (typeof str !== 'string') return '';

  const normalizedStr = str.normalize('NFC');

  const sanitized = normalizedStr
    .replace(/[^\w \[\]\p{Emoji}]/gu, "")
    .slice(0, MAX_USERNAME_LENGTH);

  return sanitized.padEnd(MIN_USERNAME_LENGTH, "x");
}
