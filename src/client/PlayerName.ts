import { ANON_WORDS, anonWordName } from "../core/AnonNames";
import { isTemporaryUsername, type UserMeResponse } from "../core/ApiSchemas";
import {
  MAX_USERNAME_LENGTH,
  validateUsername,
} from "../core/validations/username";

// What name a player plays under, resolved in one place.
//
// This used to live inside <username-input>, which meant the join path had to
// reach back into the DOM to ask (`document.querySelector("username-input")`)
// and the verified branch could skip validation with nothing downstream
// re-checking it. Both are the same missing seam. Everything here is pure:
// callers pass values in, so the whole precedence is unit-testable without a
// component, and every caller gets the same answer.

/** Which branch of the precedence produced the name. */
export type PlayerNameSource = "verified" | "stored" | "persona" | "generated";

export interface PlayerNameInputs {
  /**
   * The account's bare name when the player is eligible to play verified, else
   * null. See accountVerifiedName.
   */
  verifiedName: string | null;
  /** Whether the player has opted in to playing under that name. */
  verifiedOptIn: boolean;
  /**
   * The free-form name the player typed or has stored. Reported as-is (trimmed
   * and clamped) even when it fails validation — it is the player's own text,
   * so the caller shows an error rather than resolution silently swapping in
   * another name.
   */
  storedName: string | null;
  /** The raw platform persona (Steam), before sanitising. */
  persona: string | null;
  /** The generated Anon… name to fall back to. Minted once per session. */
  generatedName: string;
}

export interface ResolvedPlayerName {
  name: string;
  source: PlayerNameSource;
  /** Playing under the verified account name — drives the blue check. */
  verified: boolean;
}

// Trim rather than reject: a name stored before the cap would otherwise fail
// validation and block play.
export function clampUsername(name: string): string {
  return name.length > MAX_USERNAME_LENGTH
    ? name.slice(0, MAX_USERNAME_LENGTH).trim()
    : name;
}

// The server-resolved bare name this player may play verified under, or null
// when ineligible. Sub-only by design: `claimed` (lapsed) holders and
// TEMPORARY####-renamed players don't qualify.
export function accountVerifiedName(
  userMe: UserMeResponse | false | null,
): string | null {
  if (userMe === null || userMe === false) return null;
  const player = userMe.player;
  const status = player.usernameStatus;
  if (status !== "premium" && status !== "indefinite") return null;
  if (!player.username || isTemporaryUsername(player.usernameBase)) return null;
  return player.username;
}

// A platform persona reduced to something playable, or null when nothing
// usable survives.
//
// Steam personas can contain characters our usernames disallow (e.g. brackets)
// or exceed the length limit; strip brackets, trim, and only accept the persona
// if it validates. Not clamped, unlike stored names: a wildly long persona is
// rejected rather than truncated to a stub.
//
// OPE-221 replaces this reject-wholesale rule with strip-and-keep, which is
// what actually fixes Steam buyers landing on a generated guest name — any
// emoji, hyphen, accent or non-Latin script currently falls through here.
export function sanitizePersona(
  persona: string | null | undefined,
): string | null {
  const candidate = persona?.replace(/[[\]]/g, "").trim();
  if (!candidate) return null;
  return validateUsername(candidate).isValid ? candidate : null;
}

/**
 * The one ordered rule for what name a player plays under:
 *
 * 1. eligible for the verified name **and** opted in → the account bare name
 * 2. else the free-form name the player typed or stored
 * 3. else the sanitised platform persona
 * 4. else a generated Anon… name
 *
 * Branches 1, 3 and 4 are guaranteed representable on the wire
 * (`UsernameSchema`), which is what keeps the verified path — the one that
 * skips free-form validation — from closing the join socket. Branch 2 is the
 * player's own live text and is validated by the caller instead.
 */
export function resolvePlayerName(
  inputs: PlayerNameInputs,
): ResolvedPlayerName {
  const { verifiedName, verifiedOptIn, storedName, persona, generatedName } =
    inputs;

  if (verifiedOptIn && verifiedName !== null) {
    return { name: verifiedName, source: "verified", verified: true };
  }

  // An empty field is the player having cleared it, not a name — fall through
  // rather than handing the join an empty string.
  const stored = storedName?.trim();
  if (stored) {
    return { name: clampUsername(stored), source: "stored", verified: false };
  }

  const sanitized = sanitizePersona(persona);
  if (sanitized !== null) {
    return { name: sanitized, source: "persona", verified: false };
  }

  return { name: generatedName, source: "generated", verified: false };
}

/**
 * Resolution with nothing to go on — for join paths that can't reach the
 * identity bar at all. Nothing is stored or claimed from here, so this is
 * always branch 4.
 */
export function fallbackPlayerName(): ResolvedPlayerName {
  return { name: genAnonUsername(), source: "generated", verified: false };
}

// A memorable anonymous username: "Anon" + animal (+ digit). Draws from the same
// word bank as the server-side anonymisation overlay, but keeps the "Anon" prefix
// that the overlay drops — here it tells the player their name is a placeholder.
// Client-side fallback for players who never set a name — no roster here, so it
// draws a random slot (best-effort-unique); the overlay is what guarantees
// uniqueness in-game.
//
// Rejection-sample a uniform slot in [0, bound) from the CSPRNG: drawing a raw
// uint32 and taking `% bound` would be very slightly biased (the top partial
// bucket), so we discard the unrepresentable tail first. The bias is cosmetically
// irrelevant here, but this keeps the draw provably uniform.
export function genAnonUsername(): string {
  const bound = ANON_WORDS.length * 10;
  const limit = Math.floor(0x1_0000_0000 / bound) * bound;
  const buf = new Uint32Array(1);
  let rand: number;
  do {
    crypto.getRandomValues(buf);
    rand = buf[0] ?? 0;
  } while (rand >= limit);
  // The "Anon" prefix lives HERE, not in anonWordName: a signed-out player's
  // handle should say it is a placeholder, whereas the in-game anonymisation
  // setting makes everyone anonymous and gains nothing from repeating the word.
  return `Anon${anonWordName(rand % bound)}`;
}
