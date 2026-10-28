import type { UserMeResponse } from "@openfront/shared/ApiSchemas";

// The last `userMeResponse` broadcast, for components that listen for it but
// load after it went out (see LazyModals). Main imports this module, so it's
// listening before the first one.
let last: { response: UserMeResponse | false } | null = null;

document.addEventListener("userMeResponse", (event) => {
  last = { response: (event as CustomEvent<UserMeResponse | false>).detail };
});

/** The last `userMeResponse` broadcast, or null before the first. */
export function lastUserMeResponse(): {
  response: UserMeResponse | false;
} | null {
  return last;
}
