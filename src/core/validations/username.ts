import { translateText } from "../../client/Utils";
import { ClanTagSchema, UsernameSchema } from "../Schemas";

export const MIN_USERNAME_LENGTH = 3;
export const MAX_USERNAME_LENGTH = 27;
export const MIN_CLAN_TAG_LENGTH = 2;
export const MAX_CLAN_TAG_LENGTH = 5;

// Characters that are silently removed from usernames rather than rejected.
// Square brackets are reserved for the clan-tag display format ("[TAG] Name",
// see formatPlayerDisplayName in core/Util.ts); allowing them inside a username
// would let a player spoof a clan tag.
const RESERVED_USERNAME_CHARS = /[[\]]/g;

/**
 * Strip the reserved characters (square brackets) that are removed from a
 * username instead of failing validation. Centralized so the manual username
 * input and the optional "?username=" URL prefill sanitize identically.
 */
export function stripInvalidUsernameChars(username: string): string {
  return username.replace(RESERVED_USERNAME_CHARS, "");
}

export function validateUsername(username: string): {
  isValid: boolean;
  error?: string;
} {
  const parsed = UsernameSchema.safeParse(username);

  if (!parsed.success) {
    const errType = parsed.error.issues[0].code;

    if (errType === "invalid_type") {
      return { isValid: false, error: translateText("username.not_string") };
    }

    if (errType === "too_small") {
      return {
        isValid: false,
        error: translateText("username.too_short", {
          min: MIN_USERNAME_LENGTH,
        }),
      };
    }

    if (errType === "too_big") {
      return {
        isValid: false,
        error: translateText("username.too_long", {
          max: MAX_USERNAME_LENGTH,
        }),
      };
    }

    // Invalid regex, or any other issue
    else {
      return { isValid: false, error: translateText("username.invalid_chars") };
    }
  }

  // All checks passed
  return { isValid: true };
}

export function validateClanTag(clanTag: string): {
  isValid: boolean;
  error?: string;
} {
  if (clanTag.length === 0) {
    return { isValid: true };
  }
  if (clanTag.length < MIN_CLAN_TAG_LENGTH) {
    return { isValid: false, error: translateText("username.tag_too_short") };
  }
  if (clanTag.length > MAX_CLAN_TAG_LENGTH) {
    return { isValid: false, error: translateText("username.tag_too_long") };
  }

  const parsed = ClanTagSchema.safeParse(clanTag);
  if (!parsed.success) {
    return {
      isValid: false,
      error: translateText("username.tag_invalid_chars"),
    };
  }

  return { isValid: true };
}
