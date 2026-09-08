import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { createRef, ref, type Ref } from "lit/directives/ref.js";
import { getDesktopSessionState } from "../Auth";
import {
  desktopUpdate,
  isDesktopShell,
  multiplayerAllowedForSession,
  type DesktopSessionState,
  type DesktopUpdateState,
} from "../DesktopShell";
import { translateText } from "../Utils";

const WIGGLE_CLASS = "animate-bounce";

/**
 * Which state the single bottom slot shows. Session takes precedence over
 * every update state -- the update's remedy is a reload, which leads straight
 * back to the same wall, and a reload re-runs the update flow anyway. One
 * rule, deliberately, rather than a precedence matrix.
 */
export function barSource(
  update: DesktopUpdateState | null,
  session: DesktopSessionState | null,
): "session" | "update" | "none" {
  if (session !== null && !multiplayerAllowedForSession(session)) {
    return "session";
  }
  if (update === null) return "none";
  if (update.status === "current" || update.status === "checking") {
    return "none";
  }
  return "update";
}

/**
 * Bottom-of-screen status bar for the Steam shell: runtime-update
 * progress/action, or a missing session and its remedy, whichever applies.
 * One bottom slot, two kinds of status, so the two can never stack.
 *
 * Mounted in index.html as a direct <body> child with `in-[.in-game]:hidden`,
 * so "we do not update mid-game" is a property of the markup rather than of
 * logic here: the bar is simply off-screen during a match and reappears at the
 * menu in whatever state it reached.
 *
 * Renders nothing on the web, and nothing on a desktop shell too old to expose
 * the update bridge.
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

  private unsubscribe: (() => void) | null = null;

  private onSessionState = (e: Event) => {
    this.sessionState = (e as CustomEvent<DesktopSessionState>).detail;
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
        // its own subscription to the bridge.
        document.dispatchEvent(
          new CustomEvent("desktop-update-state", { detail: state }),
        );
      });
    }

    // Seed from the current value: Auth publishes its first transition during
    // startup, quite possibly before this element upgrades.
    if (isDesktopShell()) this.sessionState = getDesktopSessionState();
    document.addEventListener("desktop-session-state", this.onSessionState);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubscribe?.();
    this.unsubscribe = null;
    document.removeEventListener("desktop-session-state", this.onSessionState);
    window.clearTimeout(this.wiggleTimer);
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
    const source = barSource(this.updateState, this.sessionState);
    if (source === "none") return nothing;
    const update = this.updateState;
    const session = this.sessionState;

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
          <div class="text-sm font-medium truncate">
            ${source === "session" && session !== null
              ? this.sessionLabel(session)
              : update !== null
                ? this.label(update)
                : ""}
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
        ${source === "session" && session !== null
          ? this.sessionAction(session)
          : update !== null
            ? this.action(update)
            : nothing}
      </div>
    `;
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
