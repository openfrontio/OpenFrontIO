import type { UserMeResponse } from "../core/ApiSchemas";

// Steam is the primary (and, in v1, only) identity: true only when a steam
// identity is present AND no other identity is linked. Guards the account-
// linking UI so a future OPE-16 Discord/email-primary user who links Steam
// isn't misclassified.
export function isSteamPrimaryUser(
  user: UserMeResponse["user"] | undefined,
): boolean {
  return !!user?.steam && !user.discord && !user.google && !user.email;
}
