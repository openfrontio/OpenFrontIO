import { z } from "zod";
import { translateText } from "../../client/Utils";
import { ClanTagSchema, UsernameSchema } from "../Schemas";

export const MIN_USERNAME_LENGTH = 3;
// Matches MAX_ACCOUNT_USERNAME_LENGTH so a free-form name can't outgrow the
// verified name it sits beside. Enforced here rather than in UsernameSchema,
// which has to stay wide enough to read the names already written into
// archived game records. A stored name from before the cap is trimmed to fit
// rather than rejected (see clampUsername in UsernameInput).
export const MAX_USERNAME_LENGTH = 20;
export const MIN_CLAN_TAG_LENGTH = 2;
export const MAX_CLAN_TAG_LENGTH = 5;

export const MIN_ACCOUNT_USERNAME_LENGTH = 3;
export const MAX_ACCOUNT_USERNAME_LENGTH = 20;

// Mirrors the API's account-username rules (infra src/api/lib/Usernames.ts)
// for instant form feedback; profanity and uniqueness stay server-side. No
// dots (the dot separates base from suffix) and no unicode. Single spaces
// may separate words; edges are trimmed and consecutive spaces rejected so
// no two distinct bases render alike.
export const AccountUsernameSchema = z
  .string()
  .trim()
  .min(MIN_ACCOUNT_USERNAME_LENGTH)
  .max(MAX_ACCOUNT_USERNAME_LENGTH)
  .regex(/^[a-zA-Z0-9_-]+( [a-zA-Z0-9_-]+)*$/);

export function validateUsername(username: string): {
  isValid: boolean;
  error?: string;
} {
  // Checked ahead of the schema, which stays wide enough for archived records.
  if (typeof username === "string" && username.length > MAX_USERNAME_LENGTH) {
    return {
      isValid: false,
      error: translateText("username.too_long", { max: MAX_USERNAME_LENGTH }),
    };
  }

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

export function validateAccountUsername(username: string): {
  isValid: boolean;
  error?: string;
} {
  const parsed = AccountUsernameSchema.safeParse(username);

  if (!parsed.success) {
    const errType = parsed.error.issues[0].code;

    if (errType === "too_small") {
      return {
        isValid: false,
        error: translateText("username.too_short", {
          min: MIN_ACCOUNT_USERNAME_LENGTH,
        }),
      };
    }

    if (errType === "too_big") {
      return {
        isValid: false,
        error: translateText("username.too_long", {
          max: MAX_ACCOUNT_USERNAME_LENGTH,
        }),
      };
    }

    return {
      isValid: false,
      error: translateText("username.account_invalid_chars"),
    };
  }

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
