import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { createRef, ref, type Ref } from "lit/directives/ref.js";
import { getDesktopSessionState } from "../Auth";
import {
  desktopLinkGate,
  desktopUpdate,
  isDesktopShell,
  multiplayerAllowedForSession,
  publishDesktopUpdateState,
  type DesktopSessionState,
  type DesktopUpdateState,
} from "../DesktopShell";
import {
  attemptInFlight,
  backendUnreachableConfirmed,
  MANUAL_RETRY_COOLDOWN_MS,
  retryServerList,
  type BackendReachabilityDetail,
  type ServerListAttemptDetail,
} from "../ServerList";
import { translateText } from "../Utils";

const WIGGLE_CLASS = "animate-bounce";

// How long Retry stays disabled after a press, on top of however long that
// press's own attempt takes. The number lives in ServerList because the web
// shares it: with no bar to press there, a refused multiplayer click is the
// retry (GameModeSelector.reportMultiplayerRefusal), throttled by
// manualRetryAvailable() on this same cooldown and the same clock.

/**
 * Which state the single bottom slot shows, in one fixed order rather than a
 * precedence matrix:
 *
 *   session > reachability > update
 *
 * Session outranks everything because the update's remedy is a reload, which
 * leads straight back to the same wall, and a reload re-runs the update flow
 * anyway. Reachability outranks the update because an update failure while
 * the backend is unreachable is a SYMPTOM of it: "Couldn't download the
 * update -- Retry" points at a button that provably cannot work until the
 * network comes back, while "Offline" names the actual cause.
 *
 * One signed-out reason breaks the session > reachability half of that order:
 * `needs-account`'s own remedy is itself a network call, so while the backend
 * is unreachable it is really a symptom of reachability too. See the
 * exception carved out at the top of the function below.
 *
 * `backendOutage` is the DEBOUNCED signal
 * (ServerList.backendUnreachableConfirmed()), and it is only ever true on
 * desktop -- the bar renders nothing on the web, so the component never
 * tracks it there. Nothing is shown while the heartbeat is merely unsettled
 * or has missed once: there is no neutral state in this bar to hang a
 * "Checking…" on, and inventing one would put a strip across the bottom of a
 * perfectly healthy game every time a single request timed out.
 */
export function barSource(
  update: DesktopUpdateState | null,
  session: DesktopSessionState | null,
  backendOutage: boolean,
): "session" | "reachability" | "update" | "none" {
  // The one exception to session > reachability. "needs-account" is the only
  // signed-out reason whose action is itself a network call: reopening the
  // gate mints a link ticket. While the backend is unreachable that button
  // cannot succeed, and an offline message with a working Retry beats an
  // account prompt with a dead one. Every other signed-out reason still
  // outranks reachability, because each names something the player can act
  // on regardless of the backend.
  if (
    backendOutage &&
    session?.status === "signed-out" &&
    session.reason === "needs-account"
  ) {
    return "reachability";
  }
  if (session !== null && !multiplayerAllowedForSession(session)) {
    return "session";
  }
  if (backendOutage) return "reachability";
  if (update === null) return "none";
  if (update.status === "current" || update.status === "checking") {
    return "none";
  }
  return "update";
}

/**
 * Bottom-of-screen status bar for the Steam shell: runtime-update
 * progress/action, a missing session and its remedy, or a confirmed backend
 * outage and its Retry, whichever applies. One bottom slot, three kinds of
 * status, so they can never stack -- barSource above picks exactly one.
 *
 * Mounted in index.html as a direct <body> child with `in-[.in-game]:hidden`,
 * so "we do not update mid-game" is a property of the markup rather than of
 * logic here: the bar is simply off-screen during a match and reappears at the
 * menu in whatever state it reached.
 *
 * Renders nothing on the web. On a desktop shell too old to expose the update
 * bridge it still renders the session and outage states, both of which are
 * the client's own signals and need no bridge; only the update half goes
 * quiet there.
 */
@customElement("desktop-status-bar")
export class DesktopStatusBar extends LitElement {
  // Light DOM so the app's Tailwind classes apply, matching the other
  // components in this directory.
  createRenderRoot() {
    return this;
  }

  @state() private updateState: DesktopUpdateState | null = null;
  @state() private sessionState: DesktopSessionState | null = null;
  @state() private backendOutage = false;
  // Whether ANY server-list attempt is out, this bar's own Retry press or a
  // heartbeat beat. ServerList throttles and dedupes underneath, but a button
  // that keeps accepting clicks and visibly does nothing reads as broken --
  // and while the heartbeat is already asking, a press could only ever join
  // the attempt that is out, so offering it is a lie.
  @state() private attempting = false;
  // Whether the post-press cooldown is still running. The button is disabled
  // while EITHER this or `attempting` holds, so the two compose into "until
  // whichever ends later" without either needing to know about the other.
  @state() private coolingDown = false;
  private cooldownTimer: number | undefined;

  private unsubscribe: (() => void) | null = null;

  private onSessionState = (e: Event) => {
    this.sessionState = (e as CustomEvent<DesktopSessionState>).detail;
  };

  private onBackendReachability = (e: Event) => {
    this.backendOutage = (
      e as CustomEvent<BackendReachabilityDetail>
    ).detail.confirmed;
  };

  private onAttempt = (e: Event) => {
    this.attempting = (
      e as CustomEvent<ServerListAttemptDetail>
    ).detail.inFlight;
  };

  // The bar's own element, so wiggle() can restart the animation with a real
  // synchronous class removal + reflow + re-add. Routing that through a Lit
  // @state does NOT work: Lit batches writes into one microtask render and
  // keeps only the first oldValue of a batch, so false-then-true in a single
  // tick nets to no change and lit-html's dirty check skips the DOM write --
  // silently breaking the repeat-click case this exists for.
  private readonly barRef: Ref<HTMLElement> = createRef();
  private wiggleTimer: number | undefined;

  connectedCallback(): void {
    super.connectedCallback();
    const bridge = desktopUpdate();
    if (bridge !== null) {
      this.unsubscribe = bridge.subscribe((state) => {
        this.updateState = state;
        // Broadcast so entry-point components can gate without each opening
        // its own subscription to the bridge. Routed through DesktopShell so
        // the value is also CACHED: the bridge replays synchronously during
        // this element's upgrade, long before <game-mode-selector> exists,
        // and a component that mounts afterwards has nothing but the cache to
        // read (OPE-396).
        publishDesktopUpdateState(state);
      });
    }

    // Seed from the current value: Auth publishes its first transition during
    // startup, quite possibly before this element upgrades.
    if (isDesktopShell()) this.sessionState = getDesktopSessionState();
    document.addEventListener("desktop-session-state", this.onSessionState);

    // Reachability is subscribed ONLY on desktop, unlike the entry-point
    // components that gate on it. The heartbeat runs on the web too and
    // dispatches the same event, but this bar renders nothing there -- a web
    // player has the page's own chrome and no status bar to put an offline
    // strip in. Seeded first, for the same reason as the session above: the
    // heartbeat starts in Main's initialize and may well have settled before
    // this element upgrades.
    if (isDesktopShell()) {
      this.backendOutage = backendUnreachableConfirmed();
      this.attempting = attemptInFlight();
      document.addEventListener(
        "backend-reachability",
        this.onBackendReachability,
      );
      document.addEventListener("server-list-attempt", this.onAttempt);
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubscribe?.();
    this.unsubscribe = null;
    document.removeEventListener("desktop-session-state", this.onSessionState);
    document.removeEventListener(
      "backend-reachability",
      this.onBackendReachability,
    );
    document.removeEventListener("server-list-attempt", this.onAttempt);
    window.clearTimeout(this.wiggleTimer);
    window.clearTimeout(this.cooldownTimer);
  }

  /** Draws attention when the player tries to do something the update gates. */
  wiggle(): void {
    const el = this.barRef.value;
    if (el === undefined) return;
    el.classList.remove(WIGGLE_CLASS);
    // A real reflow, between a real removal and a real re-add.
    void el.offsetWidth;
    el.classList.add(WIGGLE_CLASS);
    window.clearTimeout(this.wiggleTimer);
    this.wiggleTimer = window.setTimeout(() => {
      this.barRef.value?.classList.remove(WIGGLE_CLASS);
    }, 600);
  }

  private percent(): number {
    const s = this.updateState;
    if (s === null || s.total === 0) return 0;
    return Math.min(100, Math.round((s.bytes / s.total) * 100));
  }

  render() {
    const source = barSource(
      this.updateState,
      this.sessionState,
      this.backendOutage,
    );
    if (source === "none") return nothing;
    const update = this.updateState;

    return html`
      <div
        ${ref(this.barRef)}
        class="fixed bottom-0 left-0 w-full z-[300] in-[.in-game]:hidden
               bg-gray-900/95 backdrop-blur-sm border-t border-white/10
               px-4 py-3 flex items-center gap-4 text-white"
        role="status"
        aria-live="polite"
      >
        <div class="flex-1 min-w-0">
          <!-- The action button sits right after the text instead of at the
               far right edge: the Steam overlay's notification popup covers
               the bar's bottom-right corner. -->
          <div class="flex items-center gap-4">
            <div class="text-sm font-medium truncate min-w-0">
              ${this.slotLabel(source)}
            </div>
            ${this.slotAction(source)}
          </div>
          ${source === "update" && update?.status === "downloading"
            ? html`<div
                class="mt-1 h-1.5 w-full rounded-full bg-white/15 overflow-hidden"
              >
                <div
                  class="h-full bg-malibu-blue transition-[width] duration-200"
                  style="width: ${this.percent()}%"
                ></div>
              </div>`
            : nothing}
        </div>
      </div>
    `;
  }

  /** The one line of text for whichever source won barSource. */
  private slotLabel(source: "session" | "reachability" | "update"): string {
    if (source === "session") {
      return this.sessionState === null
        ? ""
        : this.sessionLabel(this.sessionState);
    }
    if (source === "reachability") {
      return translateText("desktop_status.offline");
    }
    return this.updateState === null ? "" : this.label(this.updateState);
  }

  /** That source's remedy, if it has one. */
  private slotAction(source: "session" | "reachability" | "update") {
    if (source === "session") {
      return this.sessionState === null
        ? nothing
        : this.sessionAction(this.sessionState);
    }
    if (source === "reachability") return this.reachabilityAction();
    return this.updateState === null ? nothing : this.action(this.updateState);
  }

  /**
   * Retry for the offline state: ask the server list to try the API again
   * right now rather than waiting out the heartbeat's backoff, which after a
   * few failures is up to a minute long.
   *
   * Nothing is rendered from the result. A successful attempt flips
   * backendReachable() to true, which dispatches "backend-reachability",
   * which is what makes this whole bar disappear -- so the button's own
   * feedback is the bar going away. A failed one leaves the bar as it is,
   * which is also correct.
   *
   * Disabled while an attempt is out (whoever started it) and for
   * MANUAL_RETRY_COOLDOWN_MS after a press, whichever ends later. While the
   * heartbeat is the one asking, the label says so rather than sitting there
   * greyed out for no visible reason: a dead button with no explanation is
   * the thing this feature was reported as.
   */
  private reachabilityAction() {
    const disabled = this.retryDisabled();
    return html`<button
      class="shrink-0 px-4 py-2 rounded-md bg-malibu-blue hover:bg-aquarius
             text-sm font-medium uppercase tracking-wider
             disabled:opacity-50 disabled:cursor-not-allowed
             disabled:hover:bg-malibu-blue"
      ?disabled=${disabled}
      title=${this.attempting
        ? translateText("desktop_status.retrying")
        : nothing}
      @click=${() => this.onRetryClick()}
    >
      ${this.attempting
        ? translateText("desktop_status.retrying")
        : translateText("desktop_status.retry")}
    </button>`;
  }

  private retryDisabled(): boolean {
    return this.attempting || this.coolingDown;
  }

  private onRetryClick(): void {
    // The rendered `disabled` already stops a real click getting here; this
    // guard is for the synthetic ones (a double click delivered in the same
    // task, before Lit has re-rendered) and costs nothing.
    if (this.retryDisabled()) return;
    this.coolingDown = true;
    window.clearTimeout(this.cooldownTimer);
    this.cooldownTimer = window.setTimeout(() => {
      this.coolingDown = false;
    }, MANUAL_RETRY_COOLDOWN_MS);
    // `attempting` is not set here: retryServerList dispatches
    // "server-list-attempt" synchronously when it starts a fetch, and that
    // one event covers this press and the heartbeat alike. Setting it here
    // too would leave it stuck on for a press the 1s floor swallowed, which
    // starts no attempt and so announces no settle.
    retryServerList().catch((err: unknown) => {
      // retryServerList never rejects; belt and braces, so a change there
      // cannot surface as an unhandled rejection from a click handler.
      console.error("desktop-status-bar: server list retry failed", err);
    });
  }

  private label(s: DesktopUpdateState) {
    switch (s.status) {
      case "downloading":
        return translateText("desktop_update.downloading", {
          percent: this.percent(),
        });
      case "staged":
        return translateText("desktop_update.ready");
      case "failed":
        return translateText("desktop_update.failed");
      case "blocked":
        return translateText("desktop_update.blocked");
      default:
        return "";
    }
  }

  private action(s: DesktopUpdateState) {
    const bridge = desktopUpdate();
    if (bridge === null) return nothing;
    if (s.status === "staged") {
      return html`<button
        class="shrink-0 px-4 py-2 rounded-md bg-malibu-blue hover:bg-aquarius
               text-sm font-medium uppercase tracking-wider"
        @click=${() => {
          bridge.apply().catch((err: unknown) => {
            console.error("desktop-status-bar: apply failed", err);
          });
        }}
      >
        ${translateText("desktop_update.reload")}
      </button>`;
    }
    if (s.status === "failed") {
      return html`<button
        class="shrink-0 px-4 py-2 rounded-md bg-surface hover:brightness-110
               text-sm font-medium uppercase tracking-wider"
        @click=${() => {
          bridge.retry().catch((err: unknown) => {
            console.error("desktop-status-bar: retry failed", err);
          });
        }}
      >
        ${translateText("desktop_update.retry")}
      </button>`;
    }
    return nothing;
  }

  private sessionLabel(s: DesktopSessionState): string {
    switch (s.reason) {
      case "needs-account":
        return translateText("desktop_session.needs_account");
      case "steam-wedged":
        return translateText("desktop_session.steam_wedged");
      case "steam-unavailable":
        return translateText("desktop_session.steam_unavailable");
      case "steam-ticket-rejected":
        return translateText("desktop_session.steam_rejected");
      case "steam-backend":
        return translateText("desktop_session.steam_backend");
      case "network":
        return translateText("desktop_session.network");
      default:
        // `retrying`, and `steam-error` -- nothing specific to say.
        return s.status === "retrying"
          ? translateText("desktop_session.retrying")
          : translateText("desktop_session.generic");
    }
  }

  private sessionAction(s: DesktopSessionState) {
    if (s.status === "retrying") return nothing;
    // "needs-account" gets its own button rather than the Retry below: there
    // is nothing to retry, the account simply does not exist yet, and the
    // remedy is reopening the shell's link gate so the player can create or
    // link one.
    if (s.status === "signed-out" && s.reason === "needs-account") {
      return html`<button
        class="shrink-0 px-4 py-2 rounded-md bg-malibu-blue hover:bg-aquarius
               text-sm font-medium uppercase tracking-wider"
        @click=${() => {
          // desktopLinkGate() is null on the web and on a shell too old to
          // expose showLinkGate -- see its own doc comment in DesktopShell.ts.
          // That case is unreachable from this button specifically: a shell
          // with no bridge at all makes SteamSDK.getTicket() report
          // `unavailable`, not `needs-account`, and any shell whose preload
          // reports `needs-account` also exposes showLinkGate -- so this
          // click handler can only ever run against a real bridge. If it
          // somehow didn't, the `?.` below would short-circuit and swallow it
          // with nothing in the console; only a REJECTION from showLinkGate()
          // reaches the .catch. The bare `void` form used elsewhere in this
          // file would swallow a rejection into an unhandled promise instead;
          // AccountModal's handleShowLinkGate catches for the same reason.
          desktopLinkGate()
            ?.showLinkGate()
            .catch((err: unknown) => {
              console.error("desktop-status-bar: showLinkGate failed", err);
            });
        }}
      >
        ${translateText("desktop_status.go_online")}
      </button>`;
    }
    return html`<button
      class="shrink-0 px-4 py-2 rounded-md bg-malibu-blue hover:bg-aquarius
             text-sm font-medium uppercase tracking-wider"
      @click=${() => {
        // Main.ts owns the retry, because a successful sign-in also has to
        // refresh userMe, the nav account button and the cached profile --
        // all of which already live there. See its crazyGamesSDK listener.
        document.dispatchEvent(new CustomEvent("desktop-session-retry"));
      }}
    >
      ${translateText("desktop_session.retry")}
    </button>`;
  }
}
