import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { translateText } from "../Utils";

/**
 * A small banner shown inside the lobby when the user hasn't enabled
 * browser notifications yet. Dismissed permanently via localStorage.
 */
@customElement("notification-prompt")
export class NotificationPrompt extends LitElement {
  @property({ type: Boolean }) visible = false;

  createRenderRoot() {
    return this;
  }

  private handleEnable() {
    this.dispatchEvent(
      new CustomEvent("enable", { bubbles: true, composed: true }),
    );
    this.dismiss();
  }

  private dismiss() {
    localStorage.setItem("settings.notificationPromptDismissed", "true");
    this.visible = false;
    this.requestUpdate();
  }

  render() {
    if (!this.visible) return html``;

    return html`
      <div
        class="flex items-start gap-3 bg-blue-500/10 border border-blue-500/30 rounded-xl px-4 py-3 text-sm text-white/90"
      >
        <span class="text-xl leading-none mt-0.5">🔔</span>
        <div class="flex-1 min-w-0">
          <p class="font-medium text-white mb-1">
            ${translateText("notification_prompt.title")}
          </p>
          <p class="text-white/60 text-xs leading-relaxed">
            ${translateText("notification_prompt.body")}
          </p>
        </div>
        <div class="flex flex-col gap-1.5 shrink-0">
          <button
            class="px-3 py-1 text-xs font-semibold bg-blue-500/20 hover:bg-blue-500/40 border border-blue-500/40 rounded-lg text-blue-300 transition-colors"
            @click=${this.handleEnable}
          >
            ${translateText("notification_prompt.enable")}
          </button>
          <button
            class="px-3 py-1 text-xs text-white/40 hover:text-white/70 transition-colors"
            @click=${this.dismiss}
          >
            ${translateText("notification_prompt.dismiss")}
          </button>
        </div>
      </div>
    `;
  }
}
