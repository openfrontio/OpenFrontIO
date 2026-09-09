import { ANON_WORDS, anonWordName } from "../core/AnonNames";
import { isTemporaryUsername, type UserMeResponse } from "../core/ApiSchemas";
import {
  RENDERABLE_NAME_CHAR_RE,
  RENDERABLE_NAME_HAS_ALNUM_RE,
} from "../core/Schemas";
import {
  ACCOUNT_NAME_CHAR_RE,
  MAX_ACCOUNT_USERNAME_LENGTH,
  MAX_USERNAME_LENGTH,
  MIN_ACCOUNT_USERNAME_LENGTH,
  MIN_USERNAME_LENGTH,
  validateAccountUsername,
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
  // Already a clean cut — don't go looking for an earlier boundary and throw
  // away a whole word that fitted. Two ways that happens: the character after
  // the cut is a space, or `trim()` just removed one from the end of the slice
  // (which is the only thing it can remove, since `collapsed` arrives with no
  // leading, trailing or repeated whitespace).
  if (hard.length < MAX_USERNAME_LENGTH) return hard;
  if (name[MAX_USERNAME_LENGTH] === " ") return hard;
  const lastSpace = hard.lastIndexOf(" ");
  // No boundary worth cutting back to — a single long word is cut where it
  // falls rather than reduced to a stub.
  if (lastSpace < MIN_USERNAME_LENGTH) return hard;
  return hard.slice(0, lastSpace);
}

// Does the stored per-device preference mean "play under the verified name"?
//
// Tri-state, not a boolean: `"true"` is an explicit opt-in, `"false"` an
// explicit opt-out, and *absent* is neither. The old `=== "true"` test
// collapsed absent into opt-out, so a fresh profile — every Steam install, and
// every new browser — silently declined the perk the subscription was sold on:
// the player launched, got their persona, and never played under the name they
// paid for.
//
// But absent does NOT mean "new". Before the default existed the toggle
// rendered off and the only writer of this key was a click, so an existing
// eligible subscriber who looked at the toggle and left it alone also has no
// key. Defaulting *them* on would change the name they play under, in public,
// with no action on their part — the opposite of what a privacy default is
// for. `defaultAllowed` is what separates the two; see
// resolveVerifiedDefaultCohort, which decides it once per profile.
//
// An explicit answer always wins, in both directions. Anything unrecognised is
// not an answer the player gave, so it falls through to the cohort rather than
// silently declining.
//
// Eligibility is the caller's business — this answers only what the player
// asked for, not whether they may have it.
export function verifiedNameOptIn(
  stored: string | null,
  defaultAllowed: boolean,
): boolean {
  if (stored === "true") return true;
  if (stored === "false") return false;
  return defaultAllowed;
}

/** A bare name a lapsed holder can still get back, and when it stops being theirs. */
export interface ClaimGrace {
  name: string;
  expiresAt: Date;
  /**
   * The deadline has passed: the name is takeable by any other subscriber now,
   * but nobody has taken it yet, so resubscribing still recovers it. This is
   * the window of highest risk, not the end of one.
   */
  atRisk: boolean;
}

// What the player is about to lose, or null when nothing is at stake.
//
// `claimed` is the lapsed state: the subscription is gone, so the player no
// longer plays under the name, but the server keeps the bare claim reserved
// until `usernameClaimExpiresAt`. Resubscribing inside that window is safe —
// tryClaimBareUsername sees the holder is still them and clears the deadline.
//
// After it expires anyone may take the name, and if they do, a later
// resubscribe puts the original holder through ensureBareClaim's TEMPORARY####
// rename. That is the outcome this whole notice exists to prevent, and there
// is no out-of-game channel to warn a Steam-only account through.
//
// A passed deadline does NOT end this. usernameClaimExpiresAt's own schema
// comment is explicit: "A past date means 'at risk', not 'lost' — it stays set
// until the name is actually taken." Going quiet there would switch the warning
// off at the exact moment the name is most likely to be lost and still cheapest
// to save. `atRisk` marks that window; the `claimed` guard above is what ends
// it, because a name actually taken moves the player out of that status.
export function verifiedClaimGrace(
  userMe: UserMeResponse | false | null,
  now: Date = new Date(),
): ClaimGrace | null {
  if (userMe === null || userMe === false) return null;
  const player = userMe.player;
  if (player.usernameStatus !== "claimed") return null;
  const name = player.usernameBase;
  const at = player.usernameClaimExpiresAt;
  if (!name || !at || isTemporaryUsername(name)) return null;
  const expiresAt = new Date(at);
  return { name, expiresAt, atRisk: expiresAt.getTime() <= now.getTime() };
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

// The same persona reduced to something the ACCOUNT username form will accept,
// or null when nothing usable survives.
//
// Not the same rule as sanitizePersona, and the difference is load-bearing.
// The in-game name may be anything the renderer can draw — accents, dots — but
// an account username is ASCII word characters with single interior spaces
// (AccountUsernameSchema), because the dot separates a base from its
// discriminator and two bases must never render alike. So "Zoë" and
// "Ada.Lovelace" are perfectly good in-game names and are not account names;
// prefilling the claim form with either would seed a draft that the very form
// showing it rejects on save.
//
// Accents are FOLDED, not dropped. "Müller" is a Latin name written in a
// charset this form does not take, and spacing the diacritic out gives
// "M ller" — a mangling of the player's own name, offered back to them as a
// suggestion. NFKD splits each accented letter into its base plus a combining
// mark and the marks are stripped, so "Müller" gives "Muller" and "Zoë" gives
// "Zoe". A stroked or ligature letter has no decomposition to strip — NFKD
// leaves "Ł", "Ø", "æ" and "ß" exactly as they were — so those are folded
// from the table below instead, which is why "Łukasz" gives "Lukasz" rather
// than "ukasz".
//
// What remains disallowed after that becomes a space, same as sanitizePersona
// and for the same reason: throwing a decorated persona away wholesale is what
// sent Steam buyers to Anon… names in the first place, and a decorative
// separator divides words rather than joining them ("Ada.Lovelace" and
// "Ada🔥Lovelace" both give "Ada Lovelace").
//
// Returns only names that validateAccountUsername accepts, so a caller may
// place the result straight into the field. Anything else is null — an empty
// field the player fills in themselves beats a prefilled error.
// Latin letters NFKD cannot decompose, because the mark is part of the glyph
// rather than a combining character: strokes, bars and ligatures. Confined to
// Latin-1 Supplement and Latin Extended-A, which is what the in-game name
// atlas covers (see OPE-221) and therefore the whole range a persona can
// reach this function in.
const FOLD_UNDECOMPOSABLE: Record<string, string> = {
  Ł: "L",
  ł: "l",
  Ø: "O",
  ø: "o",
  Æ: "AE",
  æ: "ae",
  Œ: "OE",
  œ: "oe",
  Ð: "D",
  ð: "d",
  Þ: "TH",
  þ: "th",
  ß: "ss",
  Đ: "D",
  đ: "d",
  Ħ: "H",
  ħ: "h",
  Ŋ: "N",
  ŋ: "n",
  Ŧ: "T",
  ŧ: "t",
  // Dotless i and kra: letters in their own right, not an "i"/"k" with
  // something added, so NFKD has nothing to take off. Without these a Turkish
  // name loses a letter per syllable — "Yıldırım" spaces out to "Y ld r m".
  ı: "i",
  ĸ: "k",
  // NFKD turns these into "L" plus a middle dot, which then becomes a space.
  Ŀ: "L",
  ŀ: "l",
};

export function sanitizeAccountPersona(
  persona: string | null | undefined,
): string | null {
  if (!persona) return null;
  // Decompose, then drop the combining marks NFKD just separated out. Done
  // before the charset filter so a folded letter is judged on its base form.
  const folded = Array.from(persona.normalize("NFKD").replace(/\p{M}+/gu, ""))
    .map((ch) => FOLD_UNDECOMPOSABLE[ch] ?? ch)
    .join("");
  const kept = Array.from(folded, (ch) =>
    ACCOUNT_NAME_CHAR_RE.test(ch) ? ch : " ",
  ).join("");
  const collapsed = kept.replace(/\s+/g, " ").trim();
  // Cut at the account cap rather than the free-form one. They are equal today
  // and are separate constants precisely because they need not stay equal.
  const name =
    collapsed.length > MAX_ACCOUNT_USERNAME_LENGTH
      ? trimAtBoundary(collapsed, MAX_ACCOUNT_USERNAME_LENGTH)
      : collapsed;
  // Punctuation alone is not a name, exactly as in sanitizePersona: a persona
  // of "-----" passes the account charset and would seed a row of dashes,
  // which is worse for the player than the empty field they would otherwise
  // type into.
  if (!/[a-zA-Z0-9]/.test(name)) return null;
  // The single authority on whether this is usable — length, charset and the
  // no-double-space rule all come back from the form's own validator rather
  // than being re-derived here, so the two cannot drift.
  return validateAccountUsername(name).isValid ? name : null;
}

// Cut to `cap`, preferring a word boundary, exactly as truncateToCap does for
// the free-form name — a truncated name should read as a shorter name, not as
// a word chopped in half. Falls back to a hard cut when no boundary leaves
// enough behind.
function trimAtBoundary(name: string, cap: number): string {
  const hard = name.slice(0, cap).trim();
  if (hard.length < cap) return hard;
  if (name[cap] === " ") return hard;
  const lastSpace = hard.lastIndexOf(" ");
  if (lastSpace < MIN_ACCOUNT_USERNAME_LENGTH) return hard;
  return hard.slice(0, lastSpace);
}

// The one-per-lapse marker for a reservation notice: the name AND the phase.
//
// Crossing the deadline changes what the player must do — "resubscribe before
// then" becomes "now, before someone takes it" — so it earns one more
// interruption, and a marker keyed on the name alone would swallow it. Keyed on
// the name rather than a bare "already announced" flag so a
// resubscribe-then-lapse cycle announces the second lapse too.
//
// Exported so the notice's owner (UsernameInput.announceLapse) and boot
// sequencing (lapseNoticeDue) build the string in one place. They ran on
// separate copies of this rule before, which is how a notice could be counted
// as pending by one and already-shown by the other.
/**
 * localStorage key holding the marker above. Lives here beside the two
 * functions that give it meaning, because boot sequencing has to read it
 * before <username-input> writes it.
 */
export const LAPSE_NOTICE_KEY = "verifiedLapseNotice";

export function lapseNoticeMarker(grace: ClaimGrace): string {
  return `${grace.name}:${grace.atRisk ? "atrisk" : "reserved"}`;
}

// Does this profile still owe the player a lapse notice?
//
// The predicate behind UsernameInput.announceLapse, extracted so boot
// sequencing can ask the same question without firing the notice. It has to be
// asked BEFORE the userMeResponse dispatch: announceLapse writes the marker
// before opening its dialog (an unawaited alert would otherwise let a second
// announcement through), so by the time the dispatch returns the notice looks
// already-shown and nothing downstream could tell it was about to interrupt.
//
// Eligibility first, because being eligible again clears the marker outright:
// there is nothing at stake, so nothing to announce.
export function lapseNoticeDue(
  userMe: UserMeResponse | false | null,
  storedMarker: string | null,
  now: Date = new Date(),
): boolean {
  if (accountVerifiedName(userMe) !== null) return false;
  const grace = verifiedClaimGrace(userMe, now);
  if (grace === null) return false;
  return storedMarker !== lapseNoticeMarker(grace);
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
