import { ClanTagSchema, UsernameSchema } from "core-public/Schemas";

export const MIN_USERNAME_LENGTH = 3;
export const MAX_USERNAME_LENGTH = 27;
export const MIN_CLAN_TAG_LENGTH = 2;
export const MAX_CLAN_TAG_LENGTH = 5;

// The engine stays presentation-agnostic: `error` is a translation KEY (with
// optional `errorParams`) that the client resolves via translateText at display
// time, rather than the engine depending on the client i18n runtime.
export interface ValidationResult {
  isValid: boolean;
  error?: string;
  errorParams?: Record<string, string | number>;
}

export function validateUsername(username: string): ValidationResult {
  const parsed = UsernameSchema.safeParse(username);

  if (!parsed.success) {
    const errType = parsed.error.issues[0].code;

    if (errType === "invalid_type") {
      return { isValid: false, error: "username.not_string" };
    }

    if (errType === "too_small") {
      return {
        isValid: false,
        error: "username.too_short",
        errorParams: { min: MIN_USERNAME_LENGTH },
      };
    }

    if (errType === "too_big") {
      return {
        isValid: false,
        error: "username.too_long",
        errorParams: { max: MAX_USERNAME_LENGTH },
      };
    }

    // Invalid regex, or any other issue
    else {
      return { isValid: false, error: "username.invalid_chars" };
    }
  }

  // All checks passed
  return { isValid: true };
}

export function validateClanTag(clanTag: string): ValidationResult {
  if (clanTag.length === 0) {
    return { isValid: true };
  }
  if (clanTag.length < MIN_CLAN_TAG_LENGTH) {
    return { isValid: false, error: "username.tag_too_short" };
  }
  if (clanTag.length > MAX_CLAN_TAG_LENGTH) {
    return { isValid: false, error: "username.tag_too_long" };
  }

  const parsed = ClanTagSchema.safeParse(clanTag);
  if (!parsed.success) {
    return {
      isValid: false,
      error: "username.tag_invalid_chars",
    };
  }

  return { isValid: true };
}
