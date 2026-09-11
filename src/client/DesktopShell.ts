// The Electron desktop (Steam) shell exposes this global via a contextBridge
// preload script — see openfront-desktop's src/preload/preload.ts. Its mere
// presence is a reliable signal we're running inside that shell, since only
// the desktop build's preload script ever sets it.
declare global {
  interface Window {
    openfrontDesktop?: unknown;
  }
}

export function isDesktopShell(): boolean {
  return typeof window !== "undefined" && window.openfrontDesktop !== undefined;
}

// The shell's own version, distinct from the game version this client was
// built from. Narrowed locally rather than re-declaring the global -- see
// SteamSDK.ts for why (TS2717).
type VersionBridge = { version?: () => Promise<string> };

// The version label is purely cosmetic and must never block client
// initialisation. The bridge below is implemented in a different (private)
// repository, so this public repo cannot enforce that its version() call
// ever settles -- race it against a short timeout and fall back to null if
// the timeout wins. 500ms is ample for an IPC round trip.
const DESKTOP_VERSION_TIMEOUT_MS = 500;

export async function desktopVersion(): Promise<string | null> {
  const desktop = window.openfrontDesktop as VersionBridge | undefined;
  if (!desktop?.version) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), DESKTOP_VERSION_TIMEOUT_MS);
  });
  try {
    return await Promise.race([desktop.version(), timeout]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Composes the version label shown in the nav bar. On Steam the game version
 * stays primary so a player's version reads the same across web and Steam,
 * with the shell version as subtext: "v0.33.1 (Steam v0.2.0)".
 */
export function composeVersionDisplay(
  gameVersion: string,
  shellVersion: string | null,
): string {
  if (!shellVersion) return gameVersion;
  const trimmed = shellVersion.trim();
  if (trimmed === "") return gameVersion;
  // Prefixed only when the value looks like a bare version. The shell reports
  // its 7-char commit on an untagged build (OPE-358), and "va1b2c3d" reads as
  // a version that does not exist. Conditional rather than dropped outright
  // so an older shell -- which always answers "0.2.0" -- still renders
  // "v0.2.0": the two repositories update on separate schedules, so both
  // shapes are live at once.
  const withV = /^\d+\.\d+\.\d+/.test(trimmed) ? `v${trimmed}` : trimmed;
  return `${gameVersion} (Steam ${withV})`;
}

export type DesktopUpdateStatus =
  | "checking"
  | "current"
  | "downloading"
  | "staged"
  | "blocked"
  | "failed";

/**
 * The update-error kinds this client knows how to reason about.
 *
 * openfront-desktop's src/main/update/state.ts (`UpdateErrorKind`) is the
 * SOURCE OF TRUTH -- the shell produces these values and this client only
 * consumes them. The two repositories cannot import from each other, so this
 * must track that one by hand, the same arrangement multiplayerAllowed below
 * already relies on.
 */
export type DesktopUpdateErrorKind = "network" | "refused" | "verify" | "parse";

/**
 * A `kind` as it actually arrives over IPC.
 *
 * Deliberately permissive rather than the closed union above. The shell ships
 * in the Steam depot and updates on Steam's schedule while this client updates
 * at runtime, so running against a shell NEWER than the client is ordinary --
 * and such a shell may classify a failure into a kind this client has never
 * heard of.
 *
 * Typing the wire value as the closed union would be a lie about data we do
 * not control, and TypeScript would then narrow the unrecognised branch of
 * multiplayerAllowed to `never` and treat it as dead code -- which is exactly
 * the branch that has to exist. `(string & {})` admits any string while
 * keeping editor completion for the four known literals.
 */
export type DesktopUpdateErrorKindWire = DesktopUpdateErrorKind | (string & {});

export interface DesktopUpdateState {
  status: DesktopUpdateStatus;
  bytes: number;
  total: number;
  error?: { kind: DesktopUpdateErrorKindWire; message: string };
}

export interface DesktopUpdateBridge {
  subscribe: (cb: (state: DesktopUpdateState) => void) => () => void;
  apply: () => Promise<void>;
  retry: () => Promise<void>;
  setInGame?: (inGame: boolean) => Promise<void>;
}

// Narrowed locally rather than re-declaring the global -- see the note on
// VersionBridge above for why (TS2717).
type UpdateBridgeHolder = { update?: DesktopUpdateBridge };

/**
 * The shell's runtime-update bridge, or null when it is unavailable -- on the
 * web, and on any desktop shell older than the one that introduced it.
 *
 * Returning null rather than throwing is the contract: the shell ships in the
 * Steam depot and updates on Steam's schedule, while this client updates at
 * runtime, so a client newer than its shell is an ordinary situation and must
 * degrade rather than break.
 */
export function desktopUpdate(): DesktopUpdateBridge | null {
  if (typeof window === "undefined") return null;
  const desktop = window.openfrontDesktop as UpdateBridgeHolder | undefined;
  return desktop?.update ?? null;
}

let __updateState: DesktopUpdateState | null = null;

/**
 * The shell's current update state, or null before the first one has been
 * published -- always the case on the web, where there is no bridge at all.
 *
 * This exists for the same reason getDesktopSessionState() does in Auth.ts,
 * and it fixes the mirror-image bug (OPE-396). The bridge replays its current
 * state to every new subscriber SYNCHRONOUSLY, so DesktopStatusBar -- the one
 * subscriber, and therefore the one publisher of `desktop-update-state` --
 * dispatches during its own upgrade. <game-mode-selector> cannot exist yet at
 * that moment: it is rendered by <play-page> on a Lit microtask, which cannot
 * run until module evaluation has already finished. The dispatch is one-shot,
 * so a component that mounts afterwards never hears it and gates on null.
 *
 * That costs nothing on a cold launch (the updater is still `checking`, and
 * every later state arrives as an ordinary change event), and everything when
 * the renderer loads a document while the updater ALREADY holds `staged` --
 * the host navigating to the next lobby, a post-purchase refresh, a failed
 * apply(). There the replay was the only delivery, so the bar correctly reads
 * "Update ready" while the gate silently never applies.
 *
 * Seeding at the consumer rather than re-dispatching later at the publisher:
 * a second dispatch would only move the race to whoever mounts after IT.
 */
export function getDesktopUpdateState(): DesktopUpdateState | null {
  return __updateState;
}

/**
 * Caches `state` and broadcasts it, so entry-point components can gate
 * without each opening its own subscription to the bridge. Mirrors Auth.ts's
 * setSessionState: cache first, then dispatch, so a listener that reads the
 * accessor during the event sees the value it was just handed.
 *
 * Only DesktopStatusBar calls this -- it owns the bridge subscription.
 */
export function publishDesktopUpdateState(state: DesktopUpdateState): void {
  __updateState = state;
  document.dispatchEvent(
    new CustomEvent("desktop-update-state", { detail: state }),
  );
}

/**
 * Whether multiplayer should be available in a given update state.
 *
 * Gate when the player has a remedy, not merely when there is a problem:
 * downloading -> wait, staged -> reload. `blocked` means the shell is too old
 * and only a Steam depot push fixes it, so gating there would lock a paying
 * player out for hours with no action available.
 *
 * `failed` is not one case but four, and the remedy rule splits them:
 *
 *   - `network` -- transient. Retry may genuinely work. GATE.
 *   - `verify`  -- the CDN's bytes did not match the descriptor's sha256:
 *                  either corruption at an edge or something worse. Retry is a
 *                  real remedy, AND we know for certain a newer version exists,
 *                  because we successfully parsed the descriptor naming it. A
 *                  client sitting on a known-stale version with a working
 *                  remedy is the strongest case for gating there is. GATE.
 *   - `refused` -- our OWN Cloudflare WAF answering 403 (OPE-192).
 *   - `parse`   -- a descriptor from our own server that we could not read.
 *
 * The last two are deterministic and entirely server-side: no player-side
 * action changes the outcome, so Retry re-runs the identical failure. Gating
 * them locks the player out while showing a button that provably cannot help,
 * which is the same punishment-without-recourse `blocked` avoids. DO NOT GATE.
 *
 * Takes the whole state rather than the bare status because the error kind is
 * load-bearing in that decision.
 *
 * This mirrors multiplayerAllowed in openfront-desktop's
 * src/main/update/state.ts. The two repositories cannot import from each other;
 * if you change the rule, change it in both. Both are covered by tests
 * asserting all four error kinds.
 *
 * The one place the two DELIBERATELY differ is the unrecognised-kind branch
 * below, which has no counterpart in the shell. The asymmetry follows from
 * which direction the values travel: THE CLIENT MAY RECEIVE FROM A NEWER
 * SHELL, BUT THE SHELL CANNOT RECEIVE FROM A NEWER CLIENT. The shell only
 * ever classifies errors it raised itself, against a closed union, so an
 * unrecognised kind is unreachable there by construction. Do not "restore
 * symmetry" by deleting the branch here.
 */
export function multiplayerAllowed(state: DesktopUpdateState): boolean {
  const { status } = state;
  if (status === "current" || status === "checking" || status === "blocked") {
    return true;
  }
  if (status === "failed") {
    return failedAllowsMultiplayer(state.error?.kind);
  }
  // downloading (wait) and staged (reload) both have a real remedy.
  return false;
}

/**
 * The `failed` half of the rule above, as an ALLOW-LIST.
 *
 * It was previously a deny-list (`kind !== "network" && kind !== "verify"`),
 * which meant anything unrecognised fell through to ungated. Two problems with
 * that, and they are the reason for OPE-194:
 *
 *   1. It answered "I don't know what went wrong" with "then play on". For the
 *      one safety property this subsystem exists to provide, the default
 *      belongs the other way round.
 *   2. A typo on either side of that comparison -- "NETWORK", "verify " --
 *      compiled cleanly and silently ungated multiplayer. A one-character
 *      mistake became a safety hole with no compile error.
 *
 * Written as an explicit switch rather than a set lookup so each kind states
 * its own reason next to it.
 *
 * Note this switch is NOT exhaustiveness-checked, and cannot be: `kind` is the
 * permissive wire type, so a new member added to DesktopUpdateErrorKind and
 * left uncased here is not a compile error. It falls to `default` and gates,
 * which is the safe answer but a silent one. Adding a kind means adding a case
 * here deliberately.
 */
function failedAllowsMultiplayer(
  kind: DesktopUpdateErrorKindWire | undefined,
): boolean {
  switch (kind) {
    // `error` is optional on DesktopUpdateState, so a malformed `failed` state
    // can carry no kind at all. Every shell emit site classifies before
    // emitting, so this is unreachable from a real shell rather than a
    // forward-compatibility case -- unlike the default branch below, this is
    // absence of evidence, not evidence we cannot read. Kept ungated, which is
    // the pre-existing deliberate behaviour: an entirely unclassified failure
    // should not lock a player out.
    case undefined:
      return true;
    // Deterministic and entirely server-side: Retry re-runs the identical
    // failure, so gating is punishment without recourse.
    case "refused":
    case "parse":
      return true;
    // Retry is a real remedy, so gating buys something.
    case "network":
    case "verify":
      return false;
    // A kind from a shell newer than this client. The shell decided this
    // failure was worth naming and we cannot read the name -- so we cannot
    // reason about whether the player has a remedy. Fail safe: gate.
    //
    // This branch is reachable only because DesktopUpdateErrorKindWire is
    // permissive. Narrowing that type to the closed union would make this
    // `never` and delete the safety net.
    default:
      return false;
  }
}

export type DesktopSessionStatus =
  | "unknown" // the first sign-in attempt is still in flight
  | "signed-in"
  | "retrying" // the player pressed Retry and it has not settled
  | "signed-out";

/**
 * Why the shell has no session. Each maps to its own player-facing message,
 * because they are not equally actionable -- `steam-wedged` is the one with a
 * one-step fix (restart Steam), and it is the one we used to say nothing about.
 */
export type SessionFailureKind =
  | "steam-unavailable" // no Steam client running, or no native addon
  | "steam-wedged" // the web-api ticket timed out -- restart Steam
  | "steam-error" // the native ticket call threw for some other reason
  | "steam-ticket-rejected" // /auth/steam 401: Steam refused the ticket
  | "steam-backend" // /auth/steam 5xx: Steam's backend, not the player
  | "network"; // the request never completed

export interface DesktopSessionState {
  status: DesktopSessionStatus;
  reason?: SessionFailureKind;
}

/**
 * Whether multiplayer should be available in a given session state.
 *
 * This DELIBERATELY diverges from multiplayerAllowed's governing rule above
 * ("gate when there is a remedy, not merely when there is a problem"), and the
 * divergence is the point:
 *
 * With updates, declining to gate still lets the player play -- gating is a
 * cost we impose to keep them in sync. With a missing session, declining to
 * gate does NOT let them play. Worker.ts closes the socket on any first join
 * without a Steam-provider JWT, and Transport.ts renders that as a Turnstile
 * error the player never encountered. Gating is the only way that refusal
 * happens somewhere we can name a cause and offer Retry.
 *
 * So every signed-out reason gates, including the ones the player cannot fix.
 *
 * A null state means no desktop shell -- the web build -- where a logged-out
 * player passes Turnstile normally and must not be gated.
 */
export function multiplayerAllowedForSession(
  state: DesktopSessionState | null,
): boolean {
  if (state === null) return true;
  return state.status === "unknown" || state.status === "signed-in";
}

/**
 * The shell's account-linking gate, re-openable on demand.
 *
 * The desktop preload exposes `showLinkGate()`: it navigates the window to
 * the gate's re-entry variant, which mints a fresh link ticket, opens the
 * browser at the website's `#steam-link?token=...` URL, polls the ticket and
 * -- once the browser session has signed in and confirmed the link -- reloads
 * the game, whose Steam sign-in then resolves to the linked account. That is
 * the same handoff the first-launch gate uses, and it needs no return path
 * into the shell, which is why every provider login on desktop goes through
 * it (see Auth.ts) rather than an OAuth redirect: `window.location.href` in
 * the shell is `app://openfront/...`, which the API's redirect_uri allowlist
 * refuses, and the shell registers no scheme handler for a browser-completed
 * OAuth flow to come back to anyway.
 *
 * Guards on `showLinkGate` specifically -- the function actually invoked --
 * and not on a sibling like `linkGate` (the gate page's own namespace), so a
 * rename of one cannot leave a caller wired to nothing. Null on the web and
 * on a shell too old to expose it, for the same degrade-don't-break reason
 * desktopUpdate() above returns null.
 */
export interface DesktopLinkGateBridge {
  showLinkGate: () => Promise<void>;
}

export function desktopLinkGate(): DesktopLinkGateBridge | null {
  if (typeof window === "undefined") return null;
  const desktop = window.openfrontDesktop as
    | { showLinkGate?: unknown }
    | undefined;
  return typeof desktop?.showLinkGate === "function"
    ? (desktop as DesktopLinkGateBridge)
    : null;
}

/**
 * The shell's in-app exit (OPE-402).
 *
 * The desktop window opens borderless by default since OPE-173, which removes
 * the title bar, and the menu bar is hidden — so the OS offers the player no
 * visible way out. F11 back to windowed and Alt+F4 both still work, but
 * neither is discoverable, and Steam players expect a Quit item in the game's
 * own UI regardless.
 *
 * Null on the web, on CrazyGames and on any shell older than the one that
 * introduced `quit()` (`shell.api` 4) — the same degrade-don't-break contract
 * desktopUpdate() and desktopDisplay() keep, and for the same reason: the
 * shell ships in the Steam depot on Steam's schedule while this client updates
 * at runtime, so a client newer than its shell is ordinary.
 *
 * FEATURE DETECTION ON THE METHOD, not on `shell.api` — the rule
 * desktopLinkGate() and desktopDisplay() already apply. A rename on the shell
 * side then hides the control rather than wiring a button to nothing.
 */
export interface DesktopQuitBridge {
  quit: () => Promise<void>;
}

export function desktopQuit(): DesktopQuitBridge | null {
  if (typeof window === "undefined") return null;
  const desktop = window.openfrontDesktop as { quit?: unknown } | undefined;
  return typeof desktop?.quit === "function"
    ? (desktop as DesktopQuitBridge)
    : null;
}

/**
 * Asks the shell to quit, and swallows everything.
 *
 * The invoke MAY NEVER SETTLE: the main process begins shutting down inside
 * its handler, so this renderer is usually destroyed before a reply can come
 * back. Awaiting it in a click handler would leave the caller hanging forever
 * on the success path, and an unhandled rejection on the failure one.
 *
 * There is deliberately nothing to report back. A shell that refuses to quit
 * leaves the player exactly where they were, with the window they can still
 * close by every other means; a spinner or an error toast for it would be a
 * UI for a state that has no remedy.
 */
export function requestDesktopQuit(): void {
  const bridge = desktopQuit();
  if (bridge === null) return;
  try {
    void bridge.quit().catch(() => {});
  } catch {
    // A bridge that throws synchronously rather than rejecting.
  }
}
