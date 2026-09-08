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

// Does this user have any linked identity at all? (Callers that also accept a
// CrazyGames session must OR that in themselves — it lives on component state,
// not on the API response.)
//
// Deliberately explicit presence checks rather than a `??` chain: `email` is a
// bare string and can be present-but-empty, and `??` only falls through on
// null/undefined. A chain's correctness would therefore depend on `email`
// staying last — an invariant nothing enforces once a fifth identity is added.
// This form is order-independent. An empty-string email counts as no identity,
// matching isSteamPrimaryUser above.
export function hasLinkedIdentity(
  user: UserMeResponse["user"] | undefined,
): boolean {
  if (user === undefined) return false;
  return (
    user.discord !== undefined ||
    user.google !== undefined ||
    user.steam !== undefined ||
    (user.email ?? "") !== ""
  );
}

// The same question asked of a raw /users/@me result, where `false` means "no
// session". Every identity gate in the client goes through this one function.
//
// It exists because the unwrapping used to be open-coded at each call site,
// which let a second, Steam-blind copy of the predicate (the former
// `hasLinkedAccount` in Api.ts) survive next to this one and lock Steam-only
// players out of ranked matchmaking — OPE-199 / OPE-260. One door, one lock.
export function responseHasLinkedIdentity(
  userMeResponse: UserMeResponse | false,
): boolean {
  return userMeResponse !== false && hasLinkedIdentity(userMeResponse.user);
}
