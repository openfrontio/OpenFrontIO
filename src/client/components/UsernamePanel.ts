import { html, LitElement, nothing, TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  isTemporaryUsername,
  PutUsernameResponse,
  UserMeResponse,
} from "../../core/ApiSchemas";
import {
  MAX_ACCOUNT_USERNAME_LENGTH,
  MIN_ACCOUNT_USERNAME_LENGTH,
  validateAccountUsername,
} from "../../core/validations/username";
import { updateUsername, UpdateUsernameResult } from "../Api";
import { showInGameAlert, showInGameConfirm } from "../InGameModal";
import { translateText } from "../Utils";
import "./baseComponents/Button";
import { usernameText } from "./ui/UsernameText";

type UserMePlayer = UserMeResponse["player"];

/**
 * Account-username management. Renders the server-resolved display name as-is
 * (never assembles base + suffix), the set/change form with client-side
 * validation and the 30-day cooldown, the grace-period warning for lapsed claim
 * holders, and the free-rename notice after a TEMPORARY#### server rename.
 *
 * Hosted by the change-username modal, which supplies the title — this renders
 * the card only.
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

    if (result.ok) {
      // A premium player whose bare name is held gets the suffixed form
      // instead — a 200, not a 409. Say so before the reload: otherwise the
      // modal simply reopens showing a name they never chose, with nothing to
      // explain it and their 30-day rename already spent. Awaited so the
      // reload cannot race the dialog away.
      await this.warnBareClaimUnavailable(name, result.data);
      // Reload so every consumer starts from a fresh /users/@me; this modal
      // reopens via #modal=change-username showing the new name. Keep the
      // form locked (busy) while the reload happens.
      window.location.reload();
      return;
    }
    this.busy = false;
    this.error = this.errorMessage(result);
  }

  // Nothing to say for `claimed` (they got what they asked for) or
  // `not_eligible` (a suffix is just how free names work — a message there
  // would be noise on an ordinary rename). `undefined` means the API predates
  // the field, so behaviour is unchanged.
  private async warnBareClaimUnavailable(
    requested: string,
    data: PutUsernameResponse,
  ): Promise<void> {
    if (data.bareClaim !== "unavailable") return;
    const next = data.nextUsernameChangeAt;
    await showInGameAlert(
      next === null
        ? translateText("account_modal.username_bare_unavailable_no_date", {
            requested,
            name: data.username,
          })
        : translateText("account_modal.username_bare_unavailable", {
            requested,
            name: data.username,
            date: this.formatDate(new Date(next)),
          }),
    );
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
      return this.renderNotice(
        translateText("account_modal.username_temporary_notice"),
      );
    }
    const claimExpiresAt = this.player.usernameClaimExpiresAt;
    if (this.player.usernameStatus === "claimed" && claimExpiresAt) {
      return this.renderNotice(
        translateText("account_modal.username_grace_warning", {
          name: this.player.usernameBase ?? "",
          date: this.formatDate(new Date(claimExpiresAt)),
        }),
      );
    }
    return nothing;
  }

  private renderNotice(message: string): TemplateResult {
    return html`
      <div
        class="flex items-start gap-2.5 px-3 py-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-200 text-sm"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="w-4 h-4 shrink-0 mt-0.5"
          aria-hidden="true"
        >
          <path
            d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
          />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <span>${message}</span>
      </div>
    `;
  }

  // Cooldown state as a pill: locked until a date, or free to change now.
  private renderCooldownPill(cooldownEnd: Date | null): TemplateResult {
    const base =
      "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wider border shrink-0";
    if (cooldownEnd === null) {
      return html`<span
        class="${base} bg-green-500/10 border-green-500/30 text-green-300"
      >
        <span class="w-1.5 h-1.5 rounded-full bg-green-400"></span>
        ${translateText("account_modal.username_change_ready")}
      </span>`;
    }
    return html`<span
      class="${base} bg-amber-500/10 border-amber-500/30 text-amber-300"
    >
      <span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
      ${translateText("account_modal.username_locked_until", {
        date: this.formatDate(cooldownEnd),
      })}
    </span>`;
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
      <div class="flex flex-col gap-4">
        <div
          class="rounded-xl border border-white/10 bg-gradient-to-br from-white/10 to-white/[0.02] p-5 flex flex-col gap-4"
        >
          <div class="flex items-start justify-between gap-3 flex-wrap">
            <div class="flex flex-col gap-1 min-w-0">
              <span
                class="text-[10px] uppercase tracking-widest text-white/40 font-bold"
              >
                ${translateText("account_modal.username_current_label")}
              </span>
              ${this.player.username
                ? html`<div
                    class="text-xl font-bold text-white leading-tight break-all"
                  >
                    ${usernameText(this.player.username, "text-white")}
                  </div>`
                : html`<div class="text-sm text-white/50">
                    ${translateText("account_modal.username_not_set")}
                  </div>`}
            </div>
            ${this.renderCooldownPill(cooldownEnd)}
          </div>
          ${this.renderNotices()}

          <div class="border-t border-white/10 pt-4 flex flex-col gap-2">
            <label
              for="username-panel-input"
              class="text-[10px] uppercase tracking-widest text-white/40 font-bold"
            >
              ${translateText("account_modal.username_new_label")}
            </label>
            <input
              id="username-panel-input"
              type="text"
              .value=${this.draft}
              @input=${this.handleInput}
              @keydown=${(e: KeyboardEvent) => {
                if (e.key === "Enter" && canSave) void this.handleSave();
              }}
              placeholder=${translateText("account_modal.username_placeholder")}
              maxlength=${MAX_ACCOUNT_USERNAME_LENGTH}
              ?disabled=${locked || this.busy}
              class="w-full px-4 py-3 bg-white/5 border rounded-xl text-white placeholder-white/20 focus:outline-none focus:ring-2 transition-all font-medium hover:bg-white/10 disabled:opacity-50 disabled:hover:bg-white/5 ${this
                .error
                ? "border-red-500/50 focus:ring-red-500/40 focus:border-red-500/50"
                : "border-white/10 focus:ring-malibu-blue/50 focus:border-malibu-blue/50"}"
            />
            <div class="flex items-start justify-between gap-3 min-h-[1.25rem]">
              <span class="text-sm text-red-400">${this.error}</span>
              <span
                class="text-xs text-white/30 tabular-nums shrink-0 leading-5"
              >
                ${trimmed.length}/${MAX_ACCOUNT_USERNAME_LENGTH}
              </span>
            </div>
            <o-button
              variant="primary"
              width="block"
              size="md"
              translationKey="account_modal.username_save"
              .disable=${!canSave}
              @click=${this.handleSave}
            ></o-button>
          </div>
        </div>
      </div>
    `;
  }
}
