import { html, LitElement, nothing, TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { isTemporaryUsername, UserMeResponse } from "../../core/ApiSchemas";
import {
  MAX_ACCOUNT_USERNAME_LENGTH,
  MIN_ACCOUNT_USERNAME_LENGTH,
  validateAccountUsername,
} from "../../core/validations/username";
import { updateUsername, UpdateUsernameResult } from "../Api";
import { showInGameConfirm } from "../InGameModal";
import { translateText } from "../Utils";
import "./baseComponents/Button";

type UserMePlayer = UserMeResponse["player"];

/**
 * Account-username management card for the Account tab. Renders the
 * server-resolved display name as-is (never assembles base + suffix), the
 * set/change form with client-side validation and the 30-day cooldown, the
 * grace-period warning for lapsed claim holders, and the free-rename notice
 * after a TEMPORARY#### server rename.
 */
@customElement("username-panel")
export class UsernamePanel extends LitElement {
  @property({ attribute: false }) player!: UserMePlayer;

  @state() private draft = "";
  @state() private busy = false;
  @state() private error = "";

  createRenderRoot() {
    return this;
  }

  willUpdate(changed: Map<string, unknown>) {
    if (changed.has("player")) {
      // Prefill with the base only — never put ".suffix" in the input.
      this.draft = this.player?.usernameBase ?? "";
      this.error = "";
    }
  }

  // The date the player may next self-rename, or null when a rename is
  // allowed now (nextUsernameChangeAt may be null OR in the past).
  private cooldownEnd(): Date | null {
    const at = this.player.nextUsernameChangeAt;
    if (!at) return null;
    const date = new Date(at);
    return date.getTime() > Date.now() ? date : null;
  }

  private isTemporary(): boolean {
    const status = this.player.usernameStatus;
    return (
      (status === "premium" || status === "indefinite") &&
      isTemporaryUsername(this.player.usernameBase)
    );
  }

  private formatDate(date: Date): string {
    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  private handleInput(e: Event) {
    this.draft = (e.target as HTMLInputElement).value;
    const trimmed = this.draft.trim();
    if (trimmed.length === 0) {
      this.error = "";
      return;
    }
    const result = validateAccountUsername(trimmed);
    this.error = result.isValid ? "" : (result.error ?? "");
  }

  private async handleSave() {
    if (this.busy) return;
    const name = this.draft.trim();
    const validation = validateAccountUsername(name);
    if (!validation.isValid) {
      this.error = validation.error ?? "";
      return;
    }

    const base = this.player.usernameBase;
    const warnings = [translateText("account_modal.username_confirm_body")];
    // A case-only (or identical) resubmission still counts as a full rename
    // and restarts the cooldown.
    if (base !== null && base !== undefined) {
      if (name.toLowerCase() === base.toLowerCase()) {
        warnings.push(
          translateText("account_modal.username_confirm_case_only"),
        );
      }
      // A lapsed claim holder who renames abandons the old reservation
      // permanently — it does not transfer to the new name.
      if (this.player.usernameStatus === "claimed") {
        warnings.push(
          translateText("account_modal.username_confirm_abandon", {
            name: base,
          }),
        );
      }
    }

    const confirmed = await showInGameConfirm(warnings.join(" "), {
      heading: translateText("account_modal.username_confirm_heading"),
      variant: "warning",
      confirmText: translateText("account_modal.username_confirm_button"),
    });
    if (!confirmed) return;

    this.busy = true;
    const result = await updateUsername(name);
    this.busy = false;

    if (result.ok) {
      // The panel and AccountModal share the same player object, so updating
      // it here keeps every consumer consistent; the event just triggers the
      // parent re-render.
      this.player.username = result.data.username;
      this.player.usernameBase = result.data.base;
      this.player.usernameDiscriminator = result.data.discriminator;
      this.player.usernameStatus = result.data.usernameStatus;
      this.player.nextUsernameChangeAt = result.data.nextUsernameChangeAt;
      // A rename either kept the claim (premium/indefinite) or abandoned it
      // (unclaimed) — either way no grace deadline remains.
      this.player.usernameClaimExpiresAt = null;
      this.draft = result.data.base;
      this.error = "";
      this.requestUpdate();
      window.dispatchEvent(
        new CustomEvent("show-message", {
          detail: {
            message: translateText("account_modal.username_changed", {
              name: result.data.username,
            }),
            color: "green",
            duration: 4000,
          },
        }),
      );
      this.dispatchEvent(
        new CustomEvent("username-changed", {
          detail: result.data,
          bubbles: true,
          composed: true,
        }),
      );
    } else {
      this.error = this.errorMessage(result);
    }
  }

  private errorMessage(
    result: Exclude<UpdateUsernameResult, { ok: true }>,
  ): string {
    switch (result.code) {
      case "profane":
        return translateText("account_modal.username_error_profane");
      case "taken":
        return translateText("account_modal.username_error_taken");
      case "cooldown": {
        // Only reachable via a race (e.g. a rename on another device) — the
        // form is disabled while the client-known cooldown runs.
        if (result.retryAfterSeconds !== null) {
          return translateText("account_modal.username_error_cooldown", {
            days: Math.max(1, Math.ceil(result.retryAfterSeconds / 86_400)),
          });
        }
        return translateText("account_modal.username_error_failed");
      }
      case "invalid":
        return (
          result.message ?? translateText("account_modal.username_error_failed")
        );
      default:
        return translateText("account_modal.username_error_failed");
    }
  }

  private renderNotices(): TemplateResult | typeof nothing {
    if (this.isTemporary()) {
      return html`
        <div
          class="mt-3 px-3 py-2 rounded-lg border border-amber-500/50 bg-amber-900/30 text-amber-200 text-sm"
        >
          ${translateText("account_modal.username_temporary_notice")}
        </div>
      `;
    }
    const claimExpiresAt = this.player.usernameClaimExpiresAt;
    if (this.player.usernameStatus === "claimed" && claimExpiresAt) {
      return html`
        <div
          class="mt-3 px-3 py-2 rounded-lg border border-amber-500/50 bg-amber-900/30 text-amber-200 text-sm"
        >
          ${translateText("account_modal.username_grace_warning", {
            name: this.player.usernameBase ?? "",
            date: this.formatDate(new Date(claimExpiresAt)),
          })}
        </div>
      `;
    }
    return nothing;
  }

  render() {
    if (!this.player || this.player.usernameStatus === undefined)
      return nothing;
    const cooldownEnd = this.cooldownEnd();
    const locked = cooldownEnd !== null;
    const trimmed = this.draft.trim();
    const canSave =
      !locked &&
      !this.busy &&
      trimmed.length >= MIN_ACCOUNT_USERNAME_LENGTH &&
      this.error === "";
    return html`
      <div class="bg-white/5 rounded-xl border border-white/10 p-6">
        <h3 class="text-lg font-bold text-white mb-4 flex items-center gap-2">
          <span class="text-blue-400">🏷️</span>
          ${translateText("account_modal.username_title")}
        </h3>
        ${this.player.username
          ? html`<div class="text-white text-lg font-medium">
              ${this.player.username}
            </div>`
          : html`<div class="text-white/50 text-sm">
              ${translateText("account_modal.username_not_set")}
            </div>`}
        ${this.renderNotices()}
        <div class="mt-4 flex items-stretch gap-2">
          <input
            type="text"
            .value=${this.draft}
            @input=${this.handleInput}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === "Enter" && canSave) void this.handleSave();
            }}
            placeholder=${translateText("account_modal.username_placeholder")}
            maxlength=${MAX_ACCOUNT_USERNAME_LENGTH}
            ?disabled=${locked || this.busy}
            class="flex-1 min-w-0 px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-malibu-blue/50 focus:border-malibu-blue/50 transition-all font-medium hover:bg-white/10 disabled:opacity-50 disabled:hover:bg-white/5"
          />
          <o-button
            variant="primary"
            size="md"
            translationKey="account_modal.username_save"
            .disable=${!canSave}
            @click=${this.handleSave}
          ></o-button>
        </div>
        ${locked
          ? html`<div class="mt-2 text-white/50 text-sm">
              ${translateText("account_modal.username_cooldown_until", {
                date: this.formatDate(cooldownEnd),
              })}
            </div>`
          : nothing}
        ${this.error
          ? html`<div class="mt-2 text-red-400 text-sm">${this.error}</div>`
          : nothing}
      </div>
    `;
  }
}
