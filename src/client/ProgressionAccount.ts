import type { UserMeResponse } from "../core/ApiSchemas";
import { hasLinkedIdentity } from "./AccountIdentity";
import { getUserMe } from "./Api";
import { isLoggedIn } from "./Auth";
import { crazyGamesSDK } from "./CrazyGamesSDK";

// Who is asking about XP. Shared by every XP surface (the end-of-game panel,
// the past-game stats modal) so they agree on what "signed in" means.
export type XpAccount =
  // A real account: a linked identity, or a CrazyGames profile whose token
  // exchange produced a session. Same rule as the account modal.
  | { kind: "signed_in"; me: UserMeResponse }
  // No session, or only a guest one (POST /auth/refresh with no cookie mints
  // a guest account, so a session alone is not a sign-in).
  | { kind: "signed_out" }
  // There is a session but /users/@me failed (5xx, timeout, unreadable): this
  // says nothing about the account, so it is neither of the above.
  | { kind: "unknown" };

export async function resolveXpAccount(): Promise<XpAccount> {
  // Auth state first, so that `false` from getUserMe below can only mean a
  // transient failure — Api.ts returns the same `false` for both.
  if (!(await isLoggedIn())) return { kind: "signed_out" };
  const me = await getUserMe();
  if (me === false) return { kind: "unknown" };
  if (hasLinkedIdentity(me.user)) return { kind: "signed_in", me };
  if (
    crazyGamesSDK.isOnCrazyGames?.() &&
    (await crazyGamesSDK.getUserProfile()) !== null
  ) {
    return { kind: "signed_in", me };
  }
  return { kind: "signed_out" };
}
