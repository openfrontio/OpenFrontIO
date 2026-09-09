// What, if anything, interrupts the player on a clean boot — decided in one
// place, as data.
//
// Four things independently wanted the main menu the moment /users/@me landed:
// the TEMPORARY#### rename prompt, the unclaimed-name prompt this module adds,
// the reservation lapse notice, and the unclaimed-rewards popup. Main.ts
// resolved the first two against each other with a bare `return` and the third
// did not participate at all — it fires from inside <username-input>, on its
// own listener, and neither side could see the other. Two overlays on one boot
// was a matter of which states happened not to co-occur.
//
// So: one ordered rule, expressed over plain values. Main.ts asks once and acts
// on the answer, which makes the ordering testable without a DOM and leaves one
// place to add the fifth contender.

import { isTemporaryUsername } from "../core/ApiSchemas";

/** Every boot-time interrupt, in the order they win. */
export type BootInterrupt =
  | "username-temporary"
  | "username-claim"
  | "lapse-notice"
  | "rewards";

export interface BootInterruptInputs {
  /**
   * A clean homepage load — not a join URL, `#modal=…` or a purchase return.
   * Nothing here may interrupt a deep link: the player asked for something
   * specific and an overlay on top of it is a bug, not a nudge.
   */
  cleanHomepage: boolean;
  /** `usernameStatus` from /users/@me. */
  usernameStatus: string | undefined;
  /** The server-resolved DISPLAY name, or null when none is set. */
  username: string | null | undefined;
  /** The bare base behind it. */
  usernameBase: string | null | undefined;
  /** lapseNoticeDue(userMe, storedMarker) — see PlayerName.ts. */
  lapseNoticeDue: boolean;
  /** How many unclaimed rewards the account is holding. */
  rewardCount: number;
  /** claimPromptDue(...) — the decay rule below. */
  claimPromptDue: boolean;
}

// An entitled status: subscribed, or admin-locked to the same perk. Both
// statuses buy the bare-name claim, so both belong in every question about it —
// including the claim prompt below. The ticket words its condition as
// `premium`, but that names the entitlement rather than the enum value, and
// singling out one of the two would leave an admin-comped account entitled to a
// name and never told so.
function entitled(status: string | undefined): boolean {
  return status === "premium" || status === "indefinite";
}

/**
 * The one interrupt this boot gets, or null.
 *
 * Ordered by how much the player stands to lose by not seeing it:
 *
 * 1. `username-temporary` — the server has already renamed them. They are
 *    playing under a name that is not theirs right now, and the rename back is
 *    free only until they spend it. Most urgent, and it was already first.
 * 2. `username-claim` — entitled, no name at all. The perk is running down
 *    unused and nothing else in the client will ever mention it, which is the
 *    whole reason this prompt exists.
 * 3. `lapse-notice` — a name they already hold is running out. Below the two
 *    above only because it repeats: it re-arms on the phase change and speaks
 *    again next launch, whereas the claim prompt decays and stops.
 * 4. `rewards` — money already in the account. Nothing is at risk and it
 *    survives to the next load unchanged, so it always yields.
 *
 * 1 and 2 are mutually exclusive by state (a TEMPORARY#### rename IS a name),
 * as are 2 and 3 (`premium` versus `claimed`). The order is stated anyway
 * rather than resting on that staying true — those exclusions are properties of
 * today's server, not of this rule.
 */
export function nextBootInterrupt(
  inputs: BootInterruptInputs,
): BootInterrupt | null {
  if (!inputs.cleanHomepage) return null;

  if (
    entitled(inputs.usernameStatus) &&
    isTemporaryUsername(inputs.usernameBase)
  )
    return "username-temporary";

  // `username === null` is the whole population: a day-0 buyer is entitled
  // from the moment the grant lands and has never opened the account modal,
  // which is the only place a name can be claimed. Note this is the DISPLAY
  // name — a player who claimed and fell back to `base.####` has one, so they
  // are not prompted; they were told about the fallback when it happened.
  if (
    entitled(inputs.usernameStatus) &&
    !inputs.username &&
    inputs.claimPromptDue
  )
    return "username-claim";

  if (inputs.lapseNoticeDue) return "lapse-notice";

  if (inputs.rewardCount > 0) return "rewards";

  return null;
}

// ---------------------------------------------------------------------------
// Claim-prompt decay
// ---------------------------------------------------------------------------

/** localStorage key holding the ClaimPromptRecord below. */
export const CLAIM_PROMPT_KEY = "usernameClaimPrompt";

/** How many times the claim prompt may ever interrupt one profile. */
export const CLAIM_PROMPT_MAX_SHOWS = 3;

/**
 * The quiet period between showings. A player who launches five times in an
 * evening is not five separate chances to be asked; without this the whole
 * allowance is spent in one sitting and the prompt reads as a bug.
 */
export const CLAIM_PROMPT_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** What we remember about a profile's claim prompts. */
export interface ClaimPromptRecord {
  shows: number;
  lastShownAt: number;
}

/**
 * Read the stored record, or null when there is nothing usable.
 *
 * Anything unparseable reads as "never shown" rather than "already spent":
 * corrupt storage should cost the player at most one extra prompt, not the
 * only notice they will ever get that they are paying for something unused.
 */
export function parseClaimPromptRecord(
  raw: string | null,
): ClaimPromptRecord | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { shows, lastShownAt } = parsed as Record<string, unknown>;
    if (typeof shows !== "number" || !Number.isFinite(shows)) return null;
    if (typeof lastShownAt !== "number" || !Number.isFinite(lastShownAt))
      return null;
    return { shows, lastShownAt };
  } catch {
    return null;
  }
}

/**
 * May the claim prompt fire now?
 *
 * A clock that has run backwards (a system clock correction, a profile copied
 * between machines) makes the elapsed time negative. That is treated as "not
 * yet", not as "long enough ago": the alternative re-opens the whole allowance
 * on a machine whose clock is simply wrong.
 */
export function claimPromptDue(
  record: ClaimPromptRecord | null,
  now: number,
): boolean {
  if (record === null) return true;
  if (record.shows >= CLAIM_PROMPT_MAX_SHOWS) return false;
  const elapsed = now - record.lastShownAt;
  if (elapsed < 0) return false;
  return elapsed >= CLAIM_PROMPT_INTERVAL_MS;
}

/** The record to store once the prompt has been shown. */
export function claimPromptShown(
  record: ClaimPromptRecord | null,
  now: number,
): ClaimPromptRecord {
  return { shows: (record?.shows ?? 0) + 1, lastShownAt: now };
}
