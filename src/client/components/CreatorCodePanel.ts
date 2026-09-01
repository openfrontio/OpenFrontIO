import { html, LitElement, nothing, TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { UserMeResponse } from "../../core/ApiSchemas";
import {
  clearCreatorCode,
  getUserMe,
  setCreatorCode,
  SetCreatorCodeResult,
} from "../Api";
import { normalizeCreatorCodeInput } from "../CreatorCode";
import { translateText } from "../Utils";
import "./baseComponents/Button";

type UserMePlayer = UserMeResponse["player"];
type CreatorBinding = NonNullable<UserMePlayer["creator"]>;

// Fired after a successful set/switch/unsupport, once the panel has
// re-fetched /users/@me (the mutating Api calls already invalidated the
// cache). The host patches its own cached player.creator in place and
// re-renders — same idiom as RewardsPanel's `rewards-changed` event /
// AccountModal.handleRewardsChanged, not a full page reload.
export interface CreatorChangedDetail {
  creator: UserMePlayer["creator"];
}

/**
 * "Support a creator" panel on the account profile (Creator Code programme).
 * `undefined` means the API predates the field — render nothing rather than a
 * broken/empty card. `null` is the normal unbound state; an object is the
 * active binding.
 *
 * Every set/switch/unsupport is a favour, and every one of those three
 * actions goes through the same two-click "arm, then confirm" idiom on a
 * single button: the first click arms it (swapping the label to a warning
 * about the 7-day gap before the next BIND), the second fires the request.
 * Any edit to the code field disarms whatever was armed.
 *
 * Only the next BIND is 7-day-gapped (server-enforced, via `canChangeAt`) —
 * unsupporting is never blocked, so the Unsupport control stays enabled
 * through the cooldown; only the change-to-another-creator input/button are
 * disabled then. See `clearCreatorCode()` in Api.ts.
 *
 * Hosted by AccountModal's account tab, beside the rewards panel — see
 * `.creator` / `.prefillCode` there.
 */
@customElement("creator-code-panel")
export class CreatorCodePanel extends LitElement {
  @property({ attribute: false }) creator: UserMePlayer["creator"] = undefined;
  // Prefill for the unbound state only, sourced from the `creatorCode` router
  // arg (a `/c/CODE` share-link visit) — never used once a binding exists.
  @property({ attribute: false }) prefillCode?: string;

  @state() private draft = "";
  @state() private busy = false;
  @state() private error = "";
  // Which action is armed (first click done, waiting for the confirming
  // second click) — null when nothing is armed.
  @state() private armed: "set" | "unsupport" | null = null;

  createRenderRoot() {
    return this;
  }

  willUpdate(changed: Map<string, unknown>) {
    if (changed.has("creator") || changed.has("prefillCode")) {
      if (this.creator || this.prefillCode === undefined) {
        this.draft = this.creator ? "" : (this.prefillCode ?? "");
        this.error = "";
      } else {
        // Unbound with a prefill: a valid share-link code is normalized to
        // its canonical (uppercase) form, same as a typed one would be on
        // submit. A stale/malformed one is shown as-is with an inline error
        // rather than silently leaving the Support button disabled with no
        // explanation.
        const normalized = normalizeCreatorCodeInput(this.prefillCode);
        this.draft = normalized ?? this.prefillCode;
        this.error =
          normalized === null
            ? translateText("creator_code.errors.invalid")
            : "";
      }
      this.armed = null;
    }
  }

  // The date the player may next set/switch, or null when changing is
  // allowed now (canChangeAt may be null OR in the past).
  private cooldownEnd(): Date | null {
    if (!this.creator) return null;
    const at = this.creator.canChangeAt;
    if (!at) return null;
    const date = new Date(at);
    return date.getTime() > Date.now() ? date : null;
  }

  private daysUntil(date: Date): number {
    return Math.max(1, Math.ceil((date.getTime() - Date.now()) / 86_400_000));
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
    this.armed = null;
    const trimmed = this.draft.trim();
    if (trimmed.length === 0) {
      this.error = "";
      return;
    }
    this.error =
      normalizeCreatorCodeInput(trimmed) === null
        ? translateText("creator_code.errors.invalid")
        : "";
  }

  private async handleSet(): Promise<void> {
    if (this.busy || this.cooldownEnd() !== null) return;
    const normalized = normalizeCreatorCodeInput(this.draft);
    if (normalized === null) {
      this.error = translateText("creator_code.errors.invalid");
      return;
    }
    if (this.armed !== "set") {
      this.armed = "set";
      return;
    }
    this.armed = null;
    this.busy = true;
    const result = await setCreatorCode(normalized);
    if (result.ok) {
      await this.refreshAfterChange();
      this.busy = false;
      return;
    }
    this.busy = false;
    this.error = this.errorMessage(result);
  }

  // Unsupporting is never blocked by the change cooldown — only the NEXT
  // bind is (see the class doc comment) — so this has no cooldownEnd() guard,
  // unlike handleSet() above.
  private async handleUnsupport(): Promise<void> {
    if (this.busy) return;
    if (this.armed !== "unsupport") {
      this.armed = "unsupport";
      return;
    }
    this.armed = null;
    this.busy = true;
    const ok = await clearCreatorCode();
    if (ok) {
      await this.refreshAfterChange();
      this.busy = false;
      return;
    }
    this.busy = false;
    this.error = translateText("creator_code.errors.failed");
  }

  // setCreatorCode()/clearCreatorCode() already invalidated the cached
  // /users/@me on success (see Api.ts) — re-fetch it here and hand the fresh
  // creator field up to the host, which patches its own cached player.creator
  // in place and re-renders. Mirrors RewardsPanel's `rewards-changed` event +
  // AccountModal.handleRewardsChanged; deliberately not a page reload.
  //
  // A failed re-fetch leaves the panel showing its pre-action state rather
  // than guessing — the server-side change already happened (and the cache
  // is already invalidated), so the next natural load picks it up.
  private async refreshAfterChange(): Promise<void> {
    const userMe = await getUserMe();
    if (userMe === false) return;
    this.dispatchEvent(
      new CustomEvent<CreatorChangedDetail>("creator-changed", {
        detail: { creator: userMe.player.creator ?? null },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private errorMessage(
    result: Exclude<SetCreatorCodeResult, { ok: true }>,
  ): string {
    switch (result.code) {
      case "invalid":
        return translateText("creator_code.errors.invalid");
      case "not_found":
        return translateText("creator_code.errors.not_found");
      case "self_referral":
        return translateText("creator_code.errors.self_referral");
      case "rate_limited":
        return translateText("creator_code.errors.rate_limited");
      case "cooldown":
        // Retry-After was missing/unparseable -- a generic message beats
        // guessing at a day count (or worse, rendering a fake one-day
        // cooldown from a 0 fallback).
        if (result.retryAfterSeconds === null) {
          return translateText("creator_code.errors.cooldown");
        }
        return translateText("creator_code.cooldown_days", {
          days: Math.max(1, Math.ceil(result.retryAfterSeconds / 86_400)),
        });
      default:
        return translateText("creator_code.errors.failed");
    }
  }

  private renderStatus(
    creator: CreatorBinding,
    locked: boolean,
  ): TemplateResult {
    return html`
      <div class="flex flex-col gap-1">
        <div class="text-xl font-bold text-white leading-tight break-all">
          ${translateText("creator_code.supporting", {
            name: creator.displayName,
            code: creator.code,
          })}
        </div>
        <div class="text-xs text-white/50">
          ${translateText("creator_code.since", {
            date: this.formatDate(new Date(creator.sinceAt)),
          })}
        </div>
        ${locked
          ? html`<div class="text-xs text-amber-300">
              ${translateText("creator_code.cooldown_days", {
                days: this.daysUntil(this.cooldownEnd()!),
              })}
            </div>`
          : nothing}
      </div>
    `;
  }

  render() {
    if (this.creator === undefined) return nothing;

    const locked = this.cooldownEnd() !== null;
    const normalized = normalizeCreatorCodeInput(this.draft);
    const canSubmit = !locked && !this.busy && normalized !== null;
    const setArmed = this.armed === "set";
    const unsupportArmed = this.armed === "unsupport";

    return html`
      <div
        class="rounded-xl border border-white/10 bg-gradient-to-br from-white/10 to-white/[0.02] p-5 flex flex-col gap-4"
      >
        <div class="flex flex-col gap-1">
          <span
            class="text-[10px] uppercase tracking-widest text-white/40 font-bold"
          >
            ${translateText("creator_code.title")}
          </span>
          ${this.creator ? this.renderStatus(this.creator, locked) : nothing}
        </div>

        <div
          class="${this.creator
            ? "border-t border-white/10 pt-4"
            : ""} flex flex-col gap-2"
        >
          <label
            for="creator-code-panel-input"
            class="text-[10px] uppercase tracking-widest text-white/40 font-bold"
          >
            ${translateText("creator_code.input_label")}
          </label>
          <input
            id="creator-code-panel-input"
            type="text"
            .value=${this.draft}
            @input=${this.handleInput}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === "Enter" && canSubmit) void this.handleSet();
            }}
            placeholder=${translateText("creator_code.input_placeholder")}
            ?disabled=${locked || this.busy}
            class="w-full px-4 py-3 bg-white/5 border rounded-xl text-white placeholder-white/20 focus:outline-none focus:ring-2 transition-all font-medium hover:bg-white/10 disabled:opacity-50 disabled:hover:bg-white/5 ${this
              .error
              ? "border-red-500/50 focus:ring-red-500/40 focus:border-red-500/50"
              : "border-white/10 focus:ring-malibu-blue/50 focus:border-malibu-blue/50"}"
          />
          <div class="text-sm text-red-400 min-h-[1.25rem]">${this.error}</div>
          <o-button
            variant=${setArmed ? "warning" : "primary"}
            width="block"
            size="md"
            translationKey=${setArmed
              ? "creator_code.confirm_lock"
              : this.creator
                ? "creator_code.change"
                : "creator_code.support"}
            .disable=${!canSubmit}
            @click=${this.handleSet}
          ></o-button>
        </div>

        ${this.creator
          ? html`<o-button
              variant=${unsupportArmed ? "warning" : "danger"}
              width="block"
              size="md"
              translationKey=${unsupportArmed
                ? "creator_code.confirm_unsupport"
                : "creator_code.unsupport"}
              .disable=${this.busy}
              @click=${this.handleUnsupport}
            ></o-button>`
          : nothing}
      </div>
    `;
  }
}
