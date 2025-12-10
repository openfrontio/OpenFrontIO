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
import { getClanTagOriginalCase, sanitize, simpleHash } from "../Util";

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
 * Sanitizes and censors profane usernames and clan tags.
 * Profane username is overwritten, profane clan tag is removed.
 *
 * Preserves non-profane clan tag:
 * prevents desync after clan team assignment because local player's own clan tag and name aren't overwritten
 *
 * Removing bad clan tags won't hurt existing clans nor cause desyncs:
 * - full name including clan tag was overwritten in the past, if any part of name was bad
 * - only each separate local player name with a profane clan tag will remain, no clan team assignment
 *
 * Examples:
 * - "GoodName" -> "GoodName"
 * - "Good$Name" -> "GoodName"
 * - "BadName" -> "Censored"
 * - "[CLAN]GoodName" -> "[CLAN]GoodName"
 * - "[CLaN]BadName" -> "[CLaN] Censored"
 * - "[BAD]GoodName" -> "GoodName"
 * - "[BAD]BadName" -> "Censored"
 */
export function censorNameWithClanTag(username: string): string {
  const sanitizedUsername = sanitize(username);

  // Don't use getClanTag because that returns upperCase and if original isn't, str replace `[{$clanTag}]` won't match
  const clanTag = getClanTagOriginalCase(sanitizedUsername);

  const nameWithoutClan = clanTag
    ? sanitizedUsername.replace(`[${clanTag}]`, "").trim()
    : sanitizedUsername;

  const clanTagIsProfane = clanTag ? isProfaneUsername(clanTag) : false;
  const usernameIsProfane = isProfaneUsername(nameWithoutClan);

  const censoredNameWithoutClan = usernameIsProfane
    ? fixProfaneUsername(nameWithoutClan)
    : nameWithoutClan;

  // Restore clan tag if it existed and is not profane
  if (clanTag && !clanTagIsProfane) {
    if (usernameIsProfane) {
      return `[${clanTag}] ${censoredNameWithoutClan}`;
    }
    return sanitizedUsername;
  }

  // Don't restore profane or nonexistent clan tag
  return censoredNameWithoutClan;
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
