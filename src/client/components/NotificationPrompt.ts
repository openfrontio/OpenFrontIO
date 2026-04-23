import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { translateText } from "../Utils";
import megaphoneIcon from "./megaphone.svg?raw";

type PromptState = "default" | "test" | "sent";

/**
 * A dismissible banner shown inside the lobby when the user hasn't enabled
 * browser notifications yet.
 *
 * Emits the following custom events:
 * - `enable`          — user clicked "Enable"; parent should enable notifications
 * - `dismiss`         — user clicked "Not now"; hides for this session only
 * - `dismiss-forever` — user clicked "Don't show again"; persists to localStorage
 *
 * Visibility is controlled by the parent via the `visible` property.
 */
@customElement("notification-prompt")
export class NotificationPrompt extends LitElement {
  /** Whether the banner is currently visible. Controlled by the parent. */
  @property({ type: Boolean }) visible = false;

  /**
   * Optional hint shown when the browser has denied notification permission.
   * When set, replaces the action buttons with this message.
   */
  @property({ type: String }) deniedHint = "";

  /** Internal state: default → test (after enable) → sent (after test) */
  @state() private promptState: PromptState = "default";

  createRenderRoot() {
    return this;
  }

  updated(changed: Map<string, unknown>) {
    // Reset internal state when the prompt is re-shown
    if (changed.has("visible") && this.visible) {
      this.promptState = "default";
    }
  }

  /**
   * Dispatches the "enable" event and switches to the test state.
   * The parent is responsible for actually enabling notifications.
   */
  private handleEnable() {
    this.dispatchEvent(
      new CustomEvent("enable", { bubbles: true, composed: true }),
    );
    this.promptState = "test";
    this.requestUpdate();
  }

  /** Sends a test notification and switches to the sent state. */
  private handleTest() {
    if ("Notification" in window && Notification.permission === "granted") {
      try {
        new Notification(
          translateText("notification_prompt.test_notification_title"),
        );
      } catch (e) {
        console.warn("[NotificationPrompt] Test notification failed:", e);
      }
    }
    this.promptState = "sent";
    this.requestUpdate();
  }

  /**
   * Hides the prompt for this session only (no localStorage write).
   * Dispatches the "dismiss" event so the parent can update its state.
   */
  private dismiss() {
    this.dispatchEvent(
      new CustomEvent("dismiss", { bubbles: true, composed: true }),
    );
    this.promptState = "default";
    this.visible = false;
    this.requestUpdate();
  }

  /**
   * Persists the dismissal to localStorage so the prompt never shows again,
   * then hides the prompt. The localStorage write is wrapped in try/catch so
   * the prompt always closes even if storage is unavailable (e.g. private mode).
   * Dispatches the "dismiss-forever" event so the parent can update its state.
   */
  private dismissForever() {
    try {
      localStorage.setItem("settings.notificationPromptDismissed", "true");
    } catch (e) {
      console.warn("[NotificationPrompt] Failed to persist dismissal:", e);
    } finally {
      this.dispatchEvent(
        new CustomEvent("dismiss-forever", { bubbles: true, composed: true }),
      );
      this.promptState = "default";
      this.visible = false;
      this.requestUpdate();
    }
  }

  private renderContent() {
    if (this.deniedHint) {
      return html`
        <p class="font-medium text-white text-xs mb-0.5">
          ${translateText("notification_prompt.title")}
        </p>
        <p class="text-xs text-red-400/80 italic mt-0.5">${this.deniedHint}</p>
        <div class="flex justify-end mt-2">
          <button
            type="button"
            class="px-2 py-1 text-xs text-white/45 hover:text-white/70 transition-colors"
            @click=${this.dismiss}
          >
            ${translateText("notification_prompt.dismiss")}
          </button>
        </div>
      `;
    }

    if (this.promptState === "test") {
      return html`
        <p class="font-medium text-white text-xs mb-0.5">
          ${translateText("notification_prompt.test_title")}
        </p>
        <p class="text-white/55 text-xs leading-relaxed">
          ${translateText("notification_prompt.test_body")}
        </p>
        <div class="flex items-center gap-1.5 justify-end mt-2">
          <button
            type="button"
            class="px-2 py-1 text-xs text-white/35 hover:text-white/60 transition-colors"
            @click=${this.dismissForever}
          >
            ${translateText("notification_prompt.dismiss_forever")}
          </button>
          <button
            type="button"
            class="px-3 py-1 text-xs font-semibold bg-blue-500/20 hover:bg-blue-500/40 border border-blue-500/40 rounded-lg text-blue-300 transition-colors"
            @click=${this.handleTest}
          >
            ${translateText("notification_prompt.test_button")}
          </button>
        </div>
      `;
    }

    if (this.promptState === "sent") {
      return html`
        <p class="font-medium text-white text-xs mb-0.5">
          ${translateText("notification_prompt.sent_title")}
        </p>
        <p class="text-white/55 text-xs leading-relaxed">
          ${translateText("notification_prompt.sent_body")}
        </p>
        <div class="flex justify-end mt-2">
          <button
            type="button"
            class="px-3 py-1 text-xs font-semibold bg-blue-500/20 hover:bg-blue-500/40 border border-blue-500/40 rounded-lg text-blue-300 transition-colors"
            @click=${this.dismiss}
          >
            ${translateText("notification_prompt.sent_ok")}
          </button>
        </div>
      `;
    }

    return html`
      <p class="font-medium text-white text-xs mb-0.5">
        ${translateText("notification_prompt.title")}
      </p>
      <p class="text-white/55 text-xs leading-relaxed">
        ${translateText("notification_prompt.body")}
      </p>
      <p class="text-white/30 text-xs italic mt-0.5">
        ${translateText("notification_prompt.hint")}
      </p>
      <div class="flex items-center gap-1.5 justify-end mt-2">
        <button
          type="button"
          class="px-2 py-1 text-xs text-white/35 hover:text-white/60 transition-colors"
          @click=${this.dismissForever}
        >
          ${translateText("notification_prompt.dismiss_forever")}
        </button>
        <button
          type="button"
          class="px-2 py-1 text-xs text-white/45 hover:text-white/70 transition-colors"
          @click=${this.dismiss}
        >
          ${translateText("notification_prompt.dismiss")}
        </button>
        <button
          type="button"
          class="px-3 py-1 text-xs font-semibold bg-blue-500/20 hover:bg-blue-500/40 border border-blue-500/40 rounded-lg text-blue-300 transition-colors"
          @click=${this.handleEnable}
        >
          ${translateText("notification_prompt.enable")}
        </button>
      </div>
    `;
  }

  render() {
    if (!this.visible) return html``;

    return html`
      <div
        class="mx-4 mt-3 bg-blue-500/10 border border-blue-500/30 rounded-xl px-3 py-3 text-sm text-white/90"
      >
        <div class="flex items-start gap-2">
          <div class="w-7 h-7 mt-0.5 shrink-0" style="opacity: 0.85;">
            ${unsafeHTML(megaphoneIcon)}
          </div>
          <div class="flex-1 min-w-0">${this.renderContent()}</div>
        </div>
      </div>
    `;
  }
}
