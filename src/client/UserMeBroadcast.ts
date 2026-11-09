import type { UserMeResponse } from "@openfront/shared/ApiSchemas";

// The last `userMeResponse` broadcast, for components that listen for it but
// load after it went out (see LazyModals). Main imports this module, so it's
// listening before the first one.
let last: { response: UserMeResponse | false } | null = null;
// Bumped on every broadcast, so an async flow can tell whether auth was
// re-resolved (a login, an account switch, a logout, or a same-account refresh
// after a purchase) while one of its requests was in flight.
let generation = 0;

document.addEventListener("userMeResponse", (event) => {
  last = { response: (event as CustomEvent<UserMeResponse | false>).detail };
  generation++;
});

/** The last `userMeResponse` broadcast, or null before the first. */
export function lastUserMeResponse(): {
  response: UserMeResponse | false;
} | null {
  return last;
}

/**
 * Counts `userMeResponse` broadcasts. Read it before an authenticated request
 * and compare after the await: a different value means the response was made
 * for an account that may no longer be the signed-in one.
 */
export function userMeGeneration(): number {
  return generation;
}
