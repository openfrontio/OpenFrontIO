import { ANON_WORDS, anonWordName } from "../core/AnonNames";
import { isTemporaryUsername, type UserMeResponse } from "../core/ApiSchemas";
import {
  RENDERABLE_NAME_CHAR_RE,
  RENDERABLE_NAME_HAS_ALNUM_RE,
} from "../core/Schemas";
import {
  MAX_USERNAME_LENGTH,
  MIN_USERNAME_LENGTH,
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

// Cut to the free-form cap, not the wire cap: the result becomes the name in
// the field, so anything longer would be seeded and then rejected by the very
// form the player is looking at.
//
// Prefer a word boundary — "Ada Lovelace the Countess" reads as "Ada Lovelace
// the", not "Ada Lovelace the Cou" — but only when enough survives; a single
// long word is cut where it falls.
function truncateToCap(name: string): string {
  if (name.length <= MAX_USERNAME_LENGTH) return name;
  const hard = name.slice(0, MAX_USERNAME_LENGTH).trim();
  const lastSpace = hard.lastIndexOf(" ");
  if (lastSpace < MIN_USERNAME_LENGTH) return hard;
  // Already ended on a boundary — the next character is where the cut fell.
  if (name[MAX_USERNAME_LENGTH] === " ") return hard;
  return hard.slice(0, lastSpace);
}

// A platform persona reduced to something playable, or null when nothing
// usable survives.
//
// Strip and keep, never reject wholesale. The old rule ran the persona through
// validateUsername() and threw the whole thing away if anything failed, so a
// single emoji, hyphen or accented letter — the decoration most Steam personas
// carry — dropped the player to a generated Anon… name. That is the whole
// "Steam buyers appear as random guests" complaint.
//
// Unrenderable codepoints become a space rather than vanishing, so the words
// either side of a decorative separator stay separate words: "Ada🔥Lovelace"
// is "Ada Lovelace", not "AdaLovelace". Brackets fall out here too — they are
// simply not in the allowlist — so no special case is needed for them.
export function sanitizePersona(
  persona: string | null | undefined,
): string | null {
  if (!persona) return null;
  const kept = Array.from(persona, (ch) =>
    RENDERABLE_NAME_CHAR_RE.test(ch) ? ch : " ",
  ).join("");
  const collapsed = kept.replace(/\s+/g, " ").trim();
  const name = truncateToCap(collapsed);
  if (name.length < MIN_USERNAME_LENGTH) return null;
  // Punctuation alone is not a name. Without this a persona of "★★★★" or
  // "..." would seed "..." — worse for the player than an Anon… name, which
  // at least reads as a placeholder.
  if (!RENDERABLE_NAME_HAS_ALNUM_RE.test(name)) return null;
  return name;
}

// Whether a stored name has the exact shape genAnonUsername produces:
// "Anon" + a word from the bank + an optional round digit.
//
// Only used to recognise names generated before the usernameIsGenerated flag
// existed, so that an install already poisoned by the one-shot seed can be
// reseeded once. A player who deliberately typed one of these gets reseeded
// from their own Steam persona, which is the same thing they would have got
// had the seed worked in the first place.
export function looksGenerated(name: string): boolean {
  const match = /^Anon([A-Za-z]+)\d?$/u.exec(name);
  return match !== null && ANON_WORDS.includes(match[1]);
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
