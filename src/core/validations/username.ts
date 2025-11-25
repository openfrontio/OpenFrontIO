import {
  RegExpMatcher,
  collapseDuplicatesTransformer,
  englishDataset,
  englishRecommendedTransformers,
  resolveConfusablesTransformer,
  resolveLeetSpeakTransformer,
  skipNonAlphabeticTransformer,
} from "obscenity";
import { translateText } from "../../client/Utils";
import { getClanTag, sanitize, simpleHash } from "../Util";

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

/**
 * Sanitizes and fixes profane usernames while preserving clan tags.
 *
 * @param username - The original username from UserNameInput
 * @returns The username with profanity replaced, but clan tag preserved
 *
 * Examples:
 * - "[CLAN]BadWord" -> "[CLAN] BeNicer"
 * - "BadWord" -> "NeedHugs"
 * - "[CLAN]GoodName" -> "[CLAN]GoodName"
 */
export function sanitizeNameWithClanTag(
  username: string,
  onlySanitize: boolean = false,
): string {
  if (onlySanitize) {
    // No overwriting profanity for the local player's own name
    return sanitize(username);
  }
  // Extract clan tag before potentially overwriting profanity
  const clanTag = getClanTag(username);
  let cleanName = fixProfaneUsername(username);

  // If name was overwritten and had a clan tag, restore it
  // Prevents desync after clan team assignment because local player's own name isn't overwritten
  if (clanTag !== null && username !== cleanName) {
    cleanName = `[${clanTag}] ${cleanName}`;
  }

  return cleanName;
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
  const sanitized = Array.from(str)
    .filter((ch) => validPattern.test(ch))
    .join("")
    .slice(0, MAX_USERNAME_LENGTH);
  return sanitized.padEnd(MIN_USERNAME_LENGTH, "x");
}
