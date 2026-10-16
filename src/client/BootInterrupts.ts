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

import {
  isTemporaryUsername,
  type UserMeResponse,
} from "@openfront/shared/ApiSchemas";
import type { DesktopUpdateState } from "./DesktopShell";
import { lapseNoticeDue } from "./PlayerName";
import {
  steamGrantEndedShown,
  steamGrantWelcomed,
  type SteamGrantRecord,
  type SteamGrantStore,
} from "./SteamGrantNotices";
import {
  STEAM_LICENCE_INTRO_NOTICE,
  steamNoticeCopy,
  steamNoticeShown,
  type SteamNotice,
} from "./SteamNotices";

/** Every boot-time interrupt, in the order they win. */
export type BootInterrupt =
  | "username-temporary"
  | "steam-notice"
  | "grant-welcome"
  | "username-claim"
  | "lapse-notice"
  | "grant-ended"
  | "rewards";

export interface BootInterruptInputs {
  /**
   * A clean homepage load — not a join URL, `#modal=…` or a purchase return,
   * and no lobby already in flight. Nothing here may interrupt a deep link:
   * the player asked for something specific and an overlay on top of it is a
   * bug, not a nudge. Build it with isCleanHomepage.
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
  /** steamGrantWelcomeDue(...) — a running Steam month nobody has explained. */
  grantWelcomeDue: boolean;
  /** steamGrantEndedDue(...) — a Steam month that ran out unannounced. */
  grantEndedDue: boolean;
  /**
   * steamGrantStringsReady(...) — same precondition as claimStringsReady, for
   * the two grant notices. Failing it lets the next interrupt take the boot.
   */
  grantStringsReady: boolean;
  /** steamNoticeDue(...) — the Steam Plus conversion, licence intro or welcome. */
  steamNotice: SteamNotice | null;
  /** steamNoticeStringsReady(...), as grantStringsReady. */
  steamNoticeStringsReady: boolean;
  /**
   * How many of the account's unclaimed rewards can be claimed now
   * (isRewardClaimable): held ones don't count, since on their own they'd
   * open the popup every boot with nothing to do.
   */
  rewardCount: number;
  /** claimPromptDue(...) — the decay rule below. */
  claimPromptDue: boolean;
  /**
   * claimPromptStringsReady(...) — whether the prompt has anything to SAY.
   * A precondition on the claim prompt like any other, and it lives here
   * rather than in runBootInterrupt so that failing it lets the next-ranked
   * interrupt take the boot instead of losing it.
   */
  claimStringsReady: boolean;
}

/**
 * Is this a clean homepage load — the only thing any of the interrupts below
 * may appear over?
 *
 * `pathname === "/"` alone is wrong in the Steam build, and silently so. The
 * desktop shell serves the renderer from its own privileged scheme at
 * `app://openfront/index.html` (openfront-desktop src/main/protocol.ts,
 * GAME_URL), so the pathname there is ALWAYS "/index.html" and a bare "/" test
 * is never true. That is not new — the TEMPORARY#### rename prompt and the
 * unclaimed-rewards popup have both been dead on Steam for the same reason —
 * but the claim prompt is aimed squarely at Steam buyers, so it would have
 * shipped never having fired for the population it exists for.
 *
 * Gated on the shell rather than accepted everywhere: on the web "/index.html"
 * is reachable directly and is not the homepage, and widening the rule there
 * would put an overlay somewhere it has never appeared.
 */
export function isCleanHomepage(
  location: { pathname: string; hash: string },
  desktopShell: boolean,
): boolean {
  if (location.hash !== "") return false;
  if (location.pathname === "/") return true;
  return desktopShell && location.pathname === "/index.html";
}

/**
 * May anything interrupt this boot at all?
 *
 * The whole gate, in one place, because none of its parts is sufficient alone
 * and Main had no way to be tested on the composition:
 *
 * - a clean homepage URL (isCleanHomepage above), and
 * - no join the player has already committed to, and
 * - no lobby handle, and
 * - no desktop update downloading or staged.
 *
 * The middle one is not covered by the last. A public-lobby join awaits
 * userAuth(), whenSeeded(), cosmetics and a Turnstile token before
 * `lobbyHandle` is assigned, and rewrites the URL only once the handshake
 * resolves — so for that whole window the page still looks like a pristine
 * homepage with no lobby, and a /users/@me landing in it would put a confirm
 * over a game that is starting.
 */
export function bootInterruptsAllowed(
  location: { pathname: string; hash: string },
  desktopShell: boolean,
  lobby: { joinInFlight: boolean; lobbyHandle: unknown },
  update: DesktopUpdateState | null,
): boolean {
  return (
    isCleanHomepage(location, desktopShell) &&
    !lobby.joinInFlight &&
    lobby.lobbyHandle === null &&
    !updatePending(update)
  );
}

// The player's next step is the update bar's Reload, which tears down
// whatever opened, so the interrupt waits for the boot after it. `checking`
// is deliberately not held: every cold launch starts there, and interrupts
// are not re-run once it settles.
function updatePending(update: DesktopUpdateState | null): boolean {
  return update?.status === "downloading" || update?.status === "staged";
}

/**
 * Did the lapse notice actually SPEAK on this boot?
 *
 * Owns the whole dispatch-and-compare sequence so Main and its tests cannot
 * drift apart on it. Three things have to be true together and none of them is
 * obvious from the call site:
 *
 * 1. `markerBefore` is a snapshot taken before the getUserMe() await, NOT read
 *    here. <username-input> calls getUserMe() from connectedCallback ahead of
 *    Main’s auth-gated call and both share the one in-flight promise, so its
 *    .then — and the marker write inside announceLapse — can already have run
 *    by the time this is called. Reading it here would always answer "already
 *    shown". That is why it is a parameter and not a `readMarker()` call.
 * 2. The comparison happens AFTER the dispatch, which is what gives
 *    <username-input> the chance to announce.
 * 3. Still due afterwards means nothing was written, so nothing was said.
 *    announceLapse bails without writing on a portal and when the
 *    translation files have not landed, and a notice that never opened must
 *    not make the sequencer stand aside for it.
 */
export function lapseShownAfterDispatch(
  userMe: UserMeResponse | false | null,
  markerBefore: string | null,
  dispatch: () => void,
  readMarker: () => string | null,
): boolean {
  const wasDue = lapseNoticeDue(userMe, markerBefore);
  dispatch();
  return wasDue && !lapseNoticeDue(userMe, readMarker());
}

/**
 * Does this join still own the in-flight flag — i.e. may it clear it?
 *
 * Only the current join does. `handleJoinLobby` awaits userAuth(),
 * whenSeeded(), cosmetics and a Turnstile token before assigning a handle, so
 * a second join can start and set the flag again while the first is still
 * unwinding. Whichever way the older one then ends — rejecting, or reaching
 * the superseded branch — clearing the flag would re-open the boot interrupts
 * over a join the player has committed to and that has no handle yet.
 *
 * Not clearing at all is the opposite failure: the flag sticks true for the
 * rest of the session and silences every interrupt. So the rule is ownership,
 * not "always" or "never", and it is the same timestamp identity
 * `handleJoinLobby` already supersedes stale joins by.
 */
export function joinOwnsInFlightFlag(
  mostRecentJoinEvent: number,
  joinEvent: number,
): boolean {
  return mostRecentJoinEvent === joinEvent;
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
 * 2. `steam-notice` — what owning the game on Steam now includes, a new
 *    owner's Steam Plus month, or that we moved their subscription to Steam
 *    Plus. Ahead of the grant welcome because the licence intro and the
 *    Steam Plus welcome cover the granted month too, and showing either
 *    marks the welcome given.
 * 3. `grant-welcome` — a Steam month is running and nobody has said what it
 *    is. Ahead of the claim prompt because the claim prompt asks the buyer to
 *    use a perk of a thing they have not yet been told they own; a player who
 *    does not know the month is a one-off reads every later prompt as a
 *    subscription they never agreed to. It fires once per grant.
 * 4. `username-claim` — entitled, no name at all. The perk is running down
 *    unused and nothing else in the client will ever mention it, which is the
 *    whole reason this prompt exists.
 * 5. `lapse-notice` — a name they already hold is running out. Below the
 *    above only because it repeats: it re-arms on the phase change and speaks
 *    again next launch, whereas the claim prompt decays and stops. It has
 *    already spoken by the time this is asked (see lapseShownAfterDispatch),
 *    which is why the grant sign-off cannot rank above it and instead the
 *    notice itself carries the after-grant wording for a former grant holder.
 * 6. `grant-ended` — the Steam month ran out and nothing said so. Nothing is
 *    at risk, but every day it goes unsaid is a day the player believes they
 *    are about to be charged. Marks itself shown when the lapse notice covers
 *    it, so a former grant holder with a reserved name hears it once.
 * 7. `rewards` — money already in the account. Nothing is at risk and it
 *    survives to the next load unchanged, so it always yields.
 *
 * 1 and 4 are mutually exclusive by state (a TEMPORARY#### rename IS a name),
 * as are 4 and 5 (`premium` versus `claimed`). The order is stated anyway
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

  if (inputs.steamNotice !== null && inputs.steamNoticeStringsReady)
    return "steam-notice";

  if (inputs.grantWelcomeDue && inputs.grantStringsReady)
    return "grant-welcome";

  // `username === null` is the whole population: a day-0 buyer is entitled
  // from the moment the grant lands and has never opened the account modal,
  // which is the only place a name can be claimed. Note this is the DISPLAY
  // name — a player who claimed and fell back to `base.####` has one, so they
  // are not prompted; they were told about the fallback when it happened.
  if (
    entitled(inputs.usernameStatus) &&
    !inputs.username &&
    inputs.claimPromptDue &&
    inputs.claimStringsReady
  )
    return "username-claim";

  if (inputs.lapseNoticeDue) return "lapse-notice";

  if (inputs.grantEndedDue && inputs.grantStringsReady) return "grant-ended";

  if (inputs.rewardCount > 0) return "rewards";

  return null;
}

// ---------------------------------------------------------------------------
// Claim-prompt decay
// ---------------------------------------------------------------------------

/** localStorage key holding the ClaimPromptStore below. */
export const CLAIM_PROMPT_KEY = "usernameClaimPrompt";

/** How many times the claim prompt may ever interrupt one account. */
export const CLAIM_PROMPT_MAX_SHOWS = 3;

/**
 * The quiet period between showings. A player who launches five times in an
 * evening is not five separate chances to be asked; without this the whole
 * allowance is spent in one sitting and the prompt reads as a bug.
 */
export const CLAIM_PROMPT_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * How many accounts' records to keep. Storage is shared by every account that
 * ever signs in here, so without a bound a shared machine grows this blob
 * without limit. The cap is generous enough that no household reaches it and
 * the least recently prompted account is the one dropped.
 */
export const CLAIM_PROMPT_MAX_ACCOUNTS = 8;

/** What we remember about one account's claim prompts. */
export interface ClaimPromptRecord {
  shows: number;
  lastShownAt: number;
}

/**
 * Records for every account seen on this device, keyed by publicId.
 *
 * A map rather than one record, because storage is per DEVICE and the
 * allowance is per ACCOUNT. A single slot cannot hold both: whichever account
 * signed in last would own it, so two entitled players alternating on one
 * machine would evict each other every boot, `shows` would never pass one, and
 * both would be prompted forever — the opposite of a decay rule. Keying also
 * stops a household's second player inheriting a spent allowance and never
 * being told about a grant that is genuinely theirs.
 */
export type ClaimPromptStore = Record<string, ClaimPromptRecord>;

/**
 * Read the stored map, dropping anything unusable.
 *
 * A malformed entry reads as "never shown" rather than "already spent":
 * corrupt storage should cost the player at most one extra prompt, not the
 * only notice they will ever get that they are paying for something unused.
 * One bad entry never discards the others.
 */
export function parseClaimPromptStore(raw: string | null): ClaimPromptStore {
  if (raw === null) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    return {};
  const store: ClaimPromptStore = {};
  for (const [publicId, value] of Object.entries(
    parsed as Record<string, unknown>,
  )) {
    if (publicId === "") continue;
    if (typeof value !== "object" || value === null) continue;
    const { shows, lastShownAt } = value as Record<string, unknown>;
    if (typeof shows !== "number" || !Number.isFinite(shows)) continue;
    if (typeof lastShownAt !== "number" || !Number.isFinite(lastShownAt))
      continue;
    store[publicId] = { shows, lastShownAt };
  }
  return store;
}

/**
 * May the claim prompt fire now, for this account?
 *
 * A clock that has run backwards (a system clock correction, a profile copied
 * between machines) makes the elapsed time negative. That is treated as "not
 * yet", not as "long enough ago": the alternative re-opens the whole allowance
 * on a machine whose clock is simply wrong.
 */
export function claimPromptDue(
  store: ClaimPromptStore,
  now: number,
  publicId: string,
): boolean {
  const record = store[publicId];
  if (record === undefined) return true;
  if (record.shows >= CLAIM_PROMPT_MAX_SHOWS) return false;
  const elapsed = now - record.lastShownAt;
  if (elapsed < 0) return false;
  return elapsed >= CLAIM_PROMPT_INTERVAL_MS;
}

/**
 * The store to write once the prompt has been shown to this account.
 *
 * Every other account's record is carried through untouched — that is the
 * whole point of the map — and the oldest are pruned only once the cap is
 * exceeded, never the account being recorded.
 */
export function claimPromptShown(
  store: ClaimPromptStore,
  now: number,
  publicId: string,
): ClaimPromptStore {
  const next: ClaimPromptStore = {
    ...store,
    [publicId]: { shows: (store[publicId]?.shows ?? 0) + 1, lastShownAt: now },
  };
  const ids = Object.keys(next);
  if (ids.length <= CLAIM_PROMPT_MAX_ACCOUNTS) return next;
  // The account just recorded is pinned OUT of the sort, not merely expected to
  // win it. Sorting everything by lastShownAt and keeping the top N looks
  // equivalent, but a store holding future timestamps — a clock corrected
  // backwards, a profile copied from a machine set ahead — sorts the current
  // account last and prunes the very record just written, so `shows` could
  // never accumulate and the prompt would repeat forever.
  const keep = ids
    .filter((id) => id !== publicId)
    .sort((a, b) => next[b].lastShownAt - next[a].lastShownAt)
    .slice(0, CLAIM_PROMPT_MAX_ACCOUNTS - 1);
  const pruned: ClaimPromptStore = { [publicId]: next[publicId] };
  for (const id of keep) pruned[id] = next[id];
  return pruned;
}

// ---------------------------------------------------------------------------
// Acting on the answer
// ---------------------------------------------------------------------------

/** Translation keys the interrupts above render through. */
export const BOOT_INTERRUPT_KEYS = {
  temporaryBody: "account_modal.username_temporary_prompt",
  temporaryHeading: "account_modal.username_title",
  temporaryConfirm: "account_modal.username_temporary_prompt_confirm",
  claimBody: "account_modal.username_claim_prompt",
  claimHeading: "account_modal.username_claim_heading",
  claimConfirm: "account_modal.username_claim_prompt_confirm",
  grantWelcomeBody: "steam_grant.welcome_body",
  grantWelcomeHeading: "steam_grant.welcome_heading",
  grantEndedBody: "steam_grant.ended_body",
  grantEndedHeading: "steam_grant.ended_heading",
} as const;

/** Where the username form lives. */
export const USERNAME_FORM_HASH = "modal=change-username";

/**
 * Has the claim prompt got anything to say yet?
 *
 * translateText echoes the key back until <lang-selector> has fetched its
 * files, and auth can resolve first. Showing a player the literal string
 * "account_modal.username_claim_prompt" would be bad enough; doing it AND
 * spending one of three chances to explain the perk would leave a non-English
 * player with two, then none, having never seen a sentence.
 *
 * A precondition on the interrupt, not a bail inside it. Answering "not yet"
 * from inside runBootInterrupt would silently cost the boot: the claim prompt
 * has already won the ranking by then, so nothing else gets a turn and an
 * entitled player holding unclaimed rewards would see neither — where main
 * would simply have opened the rewards popup. Asked here, the claim prompt is
 * never chosen and rewards takes the boot by the ordinary ordering.
 *
 * Only ever false off English, which is a static import.
 */
export function claimPromptStringsReady(
  translate: (key: string) => string,
): boolean {
  return (
    translate(BOOT_INTERRUPT_KEYS.claimBody) !==
      BOOT_INTERRUPT_KEYS.claimBody &&
    translate(BOOT_INTERRUPT_KEYS.claimHeading) !==
      BOOT_INTERRUPT_KEYS.claimHeading &&
    translate(BOOT_INTERRUPT_KEYS.claimConfirm) !==
      BOOT_INTERRUPT_KEYS.claimConfirm
  );
}

/**
 * The same precondition for the two Steam grant notices. Each is one-shot and
 * records itself shown before opening, so a key echoed back would spend the
 * only explanation a buyer ever gets on a string nobody can read.
 */
export function steamGrantStringsReady(
  translate: (key: string, params: Record<string, string>) => string,
): boolean {
  // The bodies take {tier} and {date}; formatting them without those fails
  // and logs an ICU error on every boot. Only key !== result matters here.
  const params = { tier: "", date: "" };
  return (
    [
      BOOT_INTERRUPT_KEYS.grantWelcomeBody,
      BOOT_INTERRUPT_KEYS.grantWelcomeHeading,
      BOOT_INTERRUPT_KEYS.grantEndedBody,
      BOOT_INTERRUPT_KEYS.grantEndedHeading,
    ] as string[]
  ).every((key) => translate(key, params) !== key);
}

/**
 * Everything acting on an interrupt has to reach outside itself for. Passed in
 * rather than imported so the wiring below is exercised by tests instead of
 * being trusted — the ordering was already pure, but which dialog opens, what
 * gets written and where the player lands were not, and a wrong answer there
 * is just as silent.
 */
export interface BootInterruptPorts {
  /** translateText. Echoes the key back until the language files land. */
  translate(key: string, params?: Record<string, string | number>): string;
  /** Opens a confirm dialog; resolves true when the player accepts. */
  confirm(body: string, heading: string, confirmText: string): Promise<boolean>;
  /** Opens a close-only dialog; resolves when dismissed. */
  alert(body: string, heading: string): Promise<void>;
  /** The display name of a subscription tier id (translateCosmetic). */
  tierName(tier: string): string;
  /** Sets window.location.hash. */
  navigate(hash: string): void;
  /** Opens the unclaimed-rewards popup. */
  openRewards(): void;
  /** Persists the whole claim-prompt map. */
  storeClaimPrompt(store: ClaimPromptStore): void;
  /**
   * Applies `update` to the Steam grant notice map as currently stored. Read at
   * write time, not from the context: the write lands after the dialog, and
   * onUserMe and the lapse notice can rewrite the map while it is open.
   */
  updateSteamGrant(update: (store: SteamGrantStore) => SteamGrantStore): void;
  /** POST /users/@me/notices. Fire and forget. */
  markNoticeSeen(notice: string): void;
  now(): number;
}

export interface BootInterruptContext {
  claimStore: ClaimPromptStore;
  grantStore: SteamGrantStore;
  publicId: string;
  steamNotice: SteamNotice | null;
}

// The panel's own date format, so the dialog and the account panel agree on
// what day the month ends.
function formatGrantDate(iso: string | Date): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Do whatever the chosen interrupt requires. One per boot; `null` does nothing.
 *
 * Every record is written only once the player has answered. An update
 * Reload, a crash or a quit can tear the page down under an open dialog, and a
 * record written on opening spends a showing nobody saw: one of three for the
 * claim prompt, the only one for the grant notices.
 *
 * `lapse-notice` is deliberately a no-op: <username-input> owns that alert and
 * has already shown it. It appears in the ordering so that naming it here is
 * what stops anything else opening on the same boot.
 */
export async function runBootInterrupt(
  interrupt: BootInterrupt | null,
  context: BootInterruptContext,
  ports: BootInterruptPorts,
): Promise<void> {
  // onUserMe re-runs within a launch (session recovery, a mid-session
  // sign-in), and with nothing recorded until the open dialog settles, a re-run
  // would pick the same interrupt again and stack a second copy over it. Held
  // only while a dialog is actually open: every case reaches its dialog
  // synchronously, so there is no gap between this check and the flag.
  if (dialogOpen) return;
  await runInterrupt(interrupt, context, {
    ...ports,
    confirm: (...args) => whileDialogOpen(() => ports.confirm(...args)),
    alert: (...args) => whileDialogOpen(() => ports.alert(...args)),
  });
}

let dialogOpen = false;

async function whileDialogOpen<T>(open: () => Promise<T>): Promise<T> {
  dialogOpen = true;
  try {
    return await open();
  } finally {
    dialogOpen = false;
  }
}

// Marks only the grant the dialog spoke about. recordSteamGrant replaces the
// record when the period or tier changes, and a grant that arrived while the
// dialog was open is still owed its own notice.
function forShownGrant(
  shown: SteamGrantRecord,
  publicId: string,
  mark: (store: SteamGrantStore, publicId: string) => SteamGrantStore,
): (store: SteamGrantStore) => SteamGrantStore {
  return (store) => {
    const current = store[publicId];
    return current?.periodEnd === shown.periodEnd && current.tier === shown.tier
      ? mark(store, publicId)
      : store;
  };
}

async function runInterrupt(
  interrupt: BootInterrupt | null,
  context: BootInterruptContext,
  ports: BootInterruptPorts,
): Promise<void> {
  switch (interrupt) {
    case "username-temporary": {
      const accepted = await ports.confirm(
        ports.translate(BOOT_INTERRUPT_KEYS.temporaryBody),
        ports.translate(BOOT_INTERRUPT_KEYS.temporaryHeading),
        ports.translate(BOOT_INTERRUPT_KEYS.temporaryConfirm),
      );
      if (accepted) ports.navigate(USERNAME_FORM_HASH);
      return;
    }
    case "username-claim": {
      // Readiness of these strings is a precondition on the interrupt, checked
      // by claimPromptStringsReady before the ranking picks it — not a bail
      // here. Bailing here would consume the boot and leave an entitled player
      // with unclaimed rewards seeing neither.
      const body = ports.translate(BOOT_INTERRUPT_KEYS.claimBody);
      const heading = ports.translate(BOOT_INTERRUPT_KEYS.claimHeading);
      const confirmText = ports.translate(BOOT_INTERRUPT_KEYS.claimConfirm);
      const accepted = await ports.confirm(body, heading, confirmText);
      // Whichever way they answered: re-asking someone who said no is the
      // nagging the decay rule exists to prevent.
      ports.storeClaimPrompt(
        claimPromptShown(context.claimStore, ports.now(), context.publicId),
      );
      if (accepted) ports.navigate(USERNAME_FORM_HASH);
      return;
    }
    case "grant-welcome": {
      const record = context.grantStore[context.publicId];
      if (record === undefined) return;
      const tier = ports.tierName(record.tier);
      await ports.alert(
        ports.translate(BOOT_INTERRUPT_KEYS.grantWelcomeBody, {
          tier,
          date: formatGrantDate(record.periodEnd),
        }),
        ports.translate(BOOT_INTERRUPT_KEYS.grantWelcomeHeading),
      );
      ports.updateSteamGrant(
        forShownGrant(record, context.publicId, steamGrantWelcomed),
      );
      return;
    }
    case "grant-ended": {
      const record = context.grantStore[context.publicId];
      if (record === undefined) return;
      const tier = ports.tierName(record.tier);
      await ports.alert(
        ports.translate(BOOT_INTERRUPT_KEYS.grantEndedBody, { tier }),
        ports.translate(BOOT_INTERRUPT_KEYS.grantEndedHeading),
      );
      ports.updateSteamGrant(
        forShownGrant(record, context.publicId, steamGrantEndedShown),
      );
      return;
    }
    case "steam-notice": {
      const notice = context.steamNotice;
      if (notice === null) return;
      steamNoticeShown();
      const grant = context.grantStore[context.publicId];
      const copy = steamNoticeCopy(notice, ports.translate, formatGrantDate);
      await ports.alert(copy.paragraphs.join("\n\n"), copy.heading);
      ports.markNoticeSeen(notice.notice);
      // The conversion notice already says lobbies and the name come with
      // the game, so the licence intro would repeat it on the next launch.
      if (notice.kind === "steam-plus-conversion") {
        ports.markNoticeSeen(STEAM_LICENCE_INTRO_NOTICE);
      }
      if (
        notice.kind !== "steam-plus-conversion" &&
        notice.grantEnd !== null &&
        grant !== undefined
      ) {
        ports.updateSteamGrant(
          forShownGrant(grant, context.publicId, steamGrantWelcomed),
        );
      }
      return;
    }
    case "lapse-notice":
      return;
    case "rewards":
      ports.openRewards();
      return;
    case null:
      return;
  }
}
