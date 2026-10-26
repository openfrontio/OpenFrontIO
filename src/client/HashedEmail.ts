import type { UserMeResponse } from "@openfront/shared/ApiSchemas";

// Playwire's hashed-email (HEM) signal: the SHA-256 of the signed-in player's
// email, never the email itself. index.html reads this key into window.ramp.up
// before ramp.js loads, so a returning player is identified at RAMP's init;
// syncHashedEmail keeps it current and hands a new one to the running RAMP.
export const HEM_STORAGE_KEY = "ramp_hem_sha256";

// Bumped by every sync, so a hash that finishes after a later sync (a logout
// while it was being computed) doesn't write the old account back.
let generation = 0;

export async function hashEmail(raw: string): Promise<string> {
  const data = new TextEncoder().encode(raw.trim().toLowerCase());
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

function accountEmail(response: UserMeResponse | false): string | null {
  if (response === false) return null;
  // An empty-string email is no email, as in AccountIdentity.
  const { email, google } = response.user;
  if (email !== undefined && email !== "") return email;
  if (google !== undefined && google.email !== "") return google.email;
  return null;
}

/**
 * Store the player's hashed email for RAMP, or drop it when there is no
 * signed-in email or the player isn't shown ads (ad-free, portals, desktop).
 */
export async function syncHashedEmail(
  response: UserMeResponse | false,
  adsEnabled: boolean,
): Promise<void> {
  const current = ++generation;
  const email = adsEnabled ? accountEmail(response) : null;
  // crypto.subtle only exists in a secure context (not a dev server on a LAN IP).
  if (email === null || !crypto.subtle) {
    localStorage.removeItem(HEM_STORAGE_KEY);
    return;
  }
  const sha256 = await hashEmail(email);
  if (current !== generation) return;
  if (localStorage.getItem(HEM_STORAGE_KEY) === sha256) return;
  localStorage.setItem(HEM_STORAGE_KEY, sha256);
  // ramp.js read window.ramp.up at init, so a first sign-in or a changed
  // email this session goes through setUserProfile. Without ramp.js (an ad
  // blocker) the queue never drains, which is harmless. It can drain after a
  // logout or an account switch, so only a hash that's still stored is sent.
  window.ramp?.que.push(() => {
    if (localStorage.getItem(HEM_STORAGE_KEY) !== sha256) return;
    window.ramp.setUserProfile({ format: "UUP1", heid: { sha256 } });
  });
}
