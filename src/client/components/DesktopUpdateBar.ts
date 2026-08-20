import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { desktopUpdate, type DesktopUpdateState } from "../DesktopShell";
import { translateText } from "../Utils";

/**
 * Bottom-of-screen progress/action bar for the Steam shell's runtime updates,
 * in the style of Garry's Mod's workshop download bar.
 *
 * Mounted in index.html as a direct <body> child with `in-[.in-game]:hidden`,
 * so "we do not update mid-game" is a property of the markup rather than of
 * logic here: the bar is simply off-screen during a match and reappears at the
 * menu in whatever state it reached.
 *
 * Renders nothing on the web, and nothing on a desktop shell too old to expose
 * the update bridge.
 */
@customElement("desktop-update-bar")
export class DesktopUpdateBar extends LitElement {
  // Light DOM so the app's Tailwind classes apply, matching the other
  // components in this directory.
  createRenderRoot() {
    return this;
  }

  @state() private updateState: DesktopUpdateState | null = null;
  @state() private wiggling = false;

  private unsubscribe: (() => void) | null = null;

  connectedCallback(): void {
    super.connectedCallback();
    const bridge = desktopUpdate();
    if (bridge === null) return;
    this.unsubscribe = bridge.subscribe((state) => {
      this.updateState = state;
      // Broadcast so entry-point components can gate without each opening its
      // own subscription to the bridge.
      document.dispatchEvent(
        new CustomEvent("desktop-update-state", { detail: state }),
      );
    });
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /** Draws attention when the player tries to do something the update gates. */
  wiggle(): void {
    this.wiggling = false;
    // Force a reflow so re-triggering the animation restarts it.
    void this.offsetWidth;
    this.wiggling = true;
    setTimeout(() => (this.wiggling = false), 600);
  }

  private percent(): number {
    const s = this.updateState;
    if (s === null || s.total === 0) return 0;
    return Math.min(100, Math.round((s.bytes / s.total) * 100));
  }

  render() {
    const s = this.updateState;
    if (s === null) return nothing;
    if (s.status === "current" || s.status === "checking") return nothing;

    return html`
      <div
        class="fixed bottom-0 left-0 w-full z-[300] in-[.in-game]:hidden
               bg-gray-900/95 backdrop-blur-sm border-t border-white/10
               px-4 py-3 flex items-center gap-4 text-white
               ${this.wiggling ? "animate-bounce" : ""}"
        role="status"
        aria-live="polite"
      >
        <div class="flex-1 min-w-0">
          <div class="text-sm font-medium truncate">${this.label(s)}</div>
          ${s.status === "downloading"
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
        ${this.action(s)}
      </div>
    `;
  }

  private label(s: DesktopUpdateState) {
    switch (s.status) {
      case "downloading":
        return `${translateText("desktop_update.downloading")} ${this.percent()}%`;
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
        @click=${() => void bridge.apply()}
      >
        ${translateText("desktop_update.reload")}
      </button>`;
    }
    if (s.status === "failed") {
      return html`<button
        class="shrink-0 px-4 py-2 rounded-md bg-surface hover:brightness-110
               text-sm font-medium uppercase tracking-wider"
        @click=${() => void bridge.retry()}
      >
        ${translateText("desktop_update.retry")}
      </button>`;
    }
    return nothing;
  }
}
