import { html, TemplateResult } from "lit";
import { customElement } from "lit/decorators.js";
import { getUserMe, invalidateUserMe } from "./Api";
import { isLoggedIn } from "./Auth";
import { BaseModal } from "./components/BaseModal";
import { modalHeader } from "./components/ui/ModalHeader";
import {
  fetchSteamLinkTicket,
  isValidSteamLinkCode,
  normalizeSteamLinkCode,
  redeemSteamLink,
  redeemSteamLinkCode,
  stashPendingCodeEntry,
  stashPendingLink,
} from "./SteamLink";
import { translateText } from "./Utils";

// "code_entry" is a step before "loading"/"ready"/"load_error" exist at all —
// the player hasn't given us a code yet, so there's nothing to fetch.
type LoadState = "code_entry" | "loading" | "ready" | "load_error";
type RedeemState = "idle" | "redeeming" | "success" | "failed";
type Mode = "token" | "code";

// Known machine-readable refusal reasons from POST /auth/steam/link (see the
// status-code mapping in SteamLink.ts's redeemSteamLink/redeemSteamLinkCode).
// Each gets its own message — the reason is surfaced verbatim by the server
// precisely so the UI doesn't have to collapse it into one generic failure.
// A reason this build doesn't recognise (e.g. a future addition) falls back
// to the generic key rather than rendering a raw server code.
//
// "rate_limited" is client-synthesized (not a server reason string) by
// SteamLink.ts when the throttle returns 429 — it must render its own
// "please wait" message rather than the generic failure key, since the
// throttle refuses even a correct token/code and "that was wrong" would be
// actively misleading.
const REASON_KEYS: Record<string, string> = {
  account_already_has_steam:
    "steam_link_modal.reason_account_already_has_steam",
  steam_linked_elsewhere: "steam_link_modal.reason_steam_linked_elsewhere",
  steam_has_progress: "steam_link_modal.reason_steam_has_progress",
  expired: "steam_link_modal.reason_expired",
  rate_limited: "steam_link_modal.reason_rate_limited",
};
const DEFAULT_REASON_KEY = "steam_link_modal.reason_failed";

// "rate_limited" is the one reason whose message takes a parameter
// (Retry-After's seconds, when the server sent one) — every other reason is
// a fixed string, so only this one needs the params argument at all.
// Module-level (not a method) so both the ready-state render and the
// code-mode failure handling in handleConfirm can reuse it.
function reasonMessage(
  reason: string | null,
  retryAfterSeconds: number | null,
): string {
  const reasonKey = REASON_KEYS[reason ?? ""] ?? DEFAULT_REASON_KEY;
  if (reason === "rate_limited") {
    return translateText(reasonKey, { seconds: retryAfterSeconds ?? 0 });
  }
  return translateText(reasonKey);
}

const BUTTON_BASE =
  "flex-1 px-4 py-2.5 text-xs font-bold uppercase tracking-wider rounded-xl " +
  "transition-all disabled:opacity-50 disabled:pointer-events-none border-0";

/**
 * Confirmation modal for the Steam <-> web account linking handoff.
 *
 * Opened from Main.ts's boot hook when the URL carries a
 * `#steam-link?token=...` hash (see SteamLink.ts's parseSteamLinkToken), or
 * when resuming a stashed token after a login completes.
 *
 * Security note — this is the point of the whole component. The link token
 * is opaque and carries nothing about either account, and on a shared
 * machine the browser may be logged into someone else's OpenFront session.
 * So the two names shown here come from two different, specific places, and
 * mixing them up is the defect this component exists to avoid:
 *   - the Steam persona comes from GET /auth/steam/link_ticket/:token
 *     (server-resolved from the verified Steam ticket the desktop minted);
 *   - the web account name comes from the logged-in session's /users/@me —
 *     NEVER from the token, which is attacker-controllable.
 *
 * Also opened via openForCodeEntry() when the browser handoff itself fails
 * (wrong default browser, an odd Linux setup, Steam's overlay browser) and
 * the desktop gate falls back to showing an 8-character code instead. That
 * path has no token, so no GET /auth/steam/link_ticket/:token lookup is
 * possible either — there is nothing that resolves a persona from a code
 * alone, and this component does not invent one. The confirm step still
 * appears (still names the *web* account from /users/@me, still requires an
 * explicit click); the prompt just uses a dedicated no-persona phrasing
 * (steam_link_modal.confirm_prompt_no_persona) rather than filling the
 * generic template's {persona} slot with a placeholder noun, which reads as
 * a doubled "Steam ... Steam account".
 */
@customElement("steam-link-modal")
export class SteamLinkModal extends BaseModal {
  private mode: Mode = "token";
  private loadState: LoadState = "loading";
  private redeemState: RedeemState = "idle";
  private failureReason: string | null = null;
  // Only meaningful when failureReason === "rate_limited"; see
  // SteamLink.ts's Retry-After parsing.
  private retryAfterSeconds: number | null = null;

  private token: string | null = null;
  private personaName: string | null = null;
  private username: string | null = null;

  // Code-entry state. `code` is the normalized, validated code once the
  // player has submitted one; `codeDraft` mirrors the input's live value so
  // the field stays controlled; `codeError` holds an inline validation
  // message when the submitted draft doesn't parse.
  private code: string | null = null;
  private codeDraft = "";
  private codeError: string | null = null;

  // Guards a stale open()'s fetch/redeem continuation from clobbering state
  // that belongs to a later call (a re-open with a different token, or a
  // close while a request is still in flight).
  private requestId = 0;

  protected modalConfig() {
    return { maxWidth: "480px" };
  }

  protected renderHeaderSlot() {
    return modalHeader({
      title: translateText("steam_link_modal.title"),
      onBack: () => this.close(),
      ariaLabel: translateText("common.back"),
    });
  }

  // Entry point. The confirm step needs the *logged-in* account's name, so
  // if nobody is logged in there is nothing to confirm yet: stash the token
  // (survives the login redirect) and send the player to log in instead of
  // opening a confirm dialog with a blank side — that would either show
  // nothing useful or, worse, tempt a fallback to something token-derived.
  public async openWithToken(token: string): Promise<void> {
    if (!(await isLoggedIn())) {
      stashPendingLink(token);
      window.location.hash = "modal=account";
      return;
    }
    this.mode = "token";
    this.token = token;
    this.open();
  }

  // Entry point for the fallback code (see the class doc comment above).
  // Same login precondition as openWithToken and for the same reason: the
  // confirm step needs the logged-in account's name. Unlike a token, there's
  // no code to preserve yet (the player hasn't typed one) — but the *intent*
  // to resume the code-entry form still has to survive the login redirect,
  // or the whole point of this fallback (a route through when the browser
  // handoff fails) evaporates on the one step most likely to interrupt it.
  // See SteamLink.ts's stashPendingCodeEntry/resumePendingSteamLink and
  // Main.ts's onUserMe for the resume side of this.
  public async openForCodeEntry(): Promise<void> {
    if (!(await isLoggedIn())) {
      stashPendingCodeEntry();
      window.location.hash = "modal=account";
      return;
    }
    this.mode = "code";
    this.token = null;
    this.open();
  }

  protected onOpen(): void {
    const myRequestId = ++this.requestId;
    this.redeemState = "idle";
    this.failureReason = null;
    this.retryAfterSeconds = null;
    this.personaName = null;
    this.username = null;

    if (this.mode === "code") {
      this.loadState = "code_entry";
      this.code = null;
      this.codeDraft = "";
      this.codeError = null;
      return;
    }

    this.loadState = "loading";
    const token = this.token;
    if (token === null) {
      this.loadState = "load_error";
      return;
    }

    void Promise.all([fetchSteamLinkTicket(token), getUserMe()]).then(
      ([ticket, userMe]) => {
        if (myRequestId !== this.requestId) return; // superseded
        if (!ticket.ok || userMe === false) {
          this.loadState = "load_error";
          this.requestUpdate();
          return;
        }
        this.personaName = ticket.personaName;
        // player.username is null for anyone who has never claimed one — the
        // default state, not an edge case (usernameStatus starts
        // "unclaimed"). Falling back to a placeholder noun there would gut
        // the whole point of this screen: identifying which web account is
        // about to be linked. Follows the repo-wide `username ?? publicId`
        // convention (ApiSchemas.ts, PlayerName.ts) instead.
        this.username = userMe.player.username ?? userMe.player.publicId;
        this.loadState = "ready";
        this.requestUpdate();
      },
    );
  }

  protected onClose(): void {
    this.token = null;
    this.code = null;
    this.codeDraft = "";
    this.codeError = null;
    this.requestId++;
  }

  private handleCodeInput(e: Event): void {
    this.codeDraft = (e.target as HTMLInputElement).value;
  }

  // Validates client-side before touching the network at all: a malformed
  // code (wrong length, or containing a character the alphabet deliberately
  // excludes — see SteamLink.ts) is rejected here rather than guessed at or
  // sent to the server to reject.
  private handleCodeSubmit(): void {
    const normalized = normalizeSteamLinkCode(this.codeDraft);
    if (!isValidSteamLinkCode(normalized)) {
      this.codeError = translateText("steam_link_modal.invalid_code");
      this.requestUpdate();
      return;
    }

    const myRequestId = this.requestId;
    this.code = normalized;
    this.codeError = null;
    this.loadState = "loading";
    this.requestUpdate();

    // No ticket to fetch for a code (see the class doc comment) — just the
    // logged-in account's name. personaName stays null, which the ready-state
    // render below renders via the dedicated no-persona prompt.
    void getUserMe().then((userMe) => {
      if (myRequestId !== this.requestId) return; // superseded
      if (userMe === false) {
        this.loadState = "load_error";
        this.requestUpdate();
        return;
      }
      this.personaName = null;
      // See the same fallback in onOpen() above — publicId, never a
      // placeholder noun, when the account has no claimed username yet.
      this.username = userMe.player.username ?? userMe.player.publicId;
      this.loadState = "ready";
      this.requestUpdate();
    });
  }

  private async handleConfirm(): Promise<void> {
    if (
      this.loadState !== "ready" ||
      this.redeemState === "redeeming" ||
      this.redeemState === "success"
    ) {
      return;
    }

    let redeem: () => ReturnType<typeof redeemSteamLink>;
    if (this.mode === "code") {
      const code = this.code;
      if (code === null) return;
      redeem = () => redeemSteamLinkCode(code);
    } else {
      const token = this.token;
      if (token === null) return;
      redeem = () => redeemSteamLink(token);
    }

    const myRequestId = this.requestId;
    this.redeemState = "redeeming";
    this.failureReason = null;
    this.retryAfterSeconds = null;
    this.requestUpdate();

    const result = await redeem();
    if (myRequestId !== this.requestId) return; // closed/reopened meanwhile

    if (result.ok) {
      invalidateUserMe();
      this.redeemState = "success";
    } else if (this.mode === "code") {
      // A refused code has nothing left to fix on this confirm screen —
      // Confirm would just resubmit the exact same, already-refused code.
      // The alphabet still has eye-confusable pairs (B/8, S/5, 2/Z, G/6), so
      // a one-character mistranscription is a realistic way to land here,
      // and the only other action was Cancel — which closes the modal for
      // good (Main.ts's strip() already removed #steam-link from the URL,
      // so a refresh can't reopen it). Go back to the field instead, with
      // the refusal explained inline, so the player can correct a character
      // and try again without leaving the modal. Reset the confirm state
      // too, so a later, successful resubmission doesn't render this stale
      // failure the instant it reaches "ready" again.
      this.loadState = "code_entry";
      this.codeError = reasonMessage(
        result.reason,
        result.retryAfterSeconds ?? null,
      );
      this.redeemState = "idle";
      this.failureReason = null;
      this.retryAfterSeconds = null;
    } else {
      this.redeemState = "failed";
      this.failureReason = result.reason;
      this.retryAfterSeconds = result.retryAfterSeconds ?? null;
    }
    this.requestUpdate();
  }

  protected renderBody(): TemplateResult {
    if (this.loadState === "load_error") {
      // The token path's copy ("...try again from Steam") is the wrong
      // instruction on the code path — the player is already on the
      // website holding a code, not going back through Steam.
      const loadErrorMessage =
        this.mode === "code"
          ? translateText("steam_link_modal.load_error_code")
          : translateText("steam_link_modal.load_error");
      return html`
        <div class="flex flex-col gap-4 p-6 text-center">
          <p
            class="steam-link-load-error-text text-red-300 text-sm font-medium"
          >
            ${loadErrorMessage}
          </p>
          <button
            class="${BUTTON_BASE} bg-white/5 text-white/60 border border-white/10 hover:bg-white/10 hover:text-white/80"
            @click=${() => this.close()}
          >
            ${translateText("common.close")}
          </button>
        </div>
      `;
    }

    if (this.redeemState === "success") {
      return html`
        <div class="flex flex-col gap-4 p-6 text-center">
          <p class="text-white/90 text-sm font-medium">
            ${translateText("steam_link_modal.success")}
          </p>
          <button
            class="${BUTTON_BASE} bg-malibu-blue text-white hover:bg-aquarius"
            @click=${() => this.close()}
          >
            ${translateText("common.close")}
          </button>
        </div>
      `;
    }

    if (this.loadState === "code_entry") {
      return html`
        <div class="flex flex-col gap-4 p-6">
          <p class="text-white text-sm text-center">
            ${translateText("steam_link_modal.code_prompt")}
          </p>
          <input
            type="text"
            class="steam-link-code-input w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white text-center tracking-widest uppercase placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-malibu-blue/50 focus:border-malibu-blue/50 transition-all font-medium"
            placeholder=${translateText("steam_link_modal.code_placeholder")}
            .value=${this.codeDraft}
            @input=${(e: Event) => this.handleCodeInput(e)}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === "Enter") this.handleCodeSubmit();
            }}
          />
          ${this.codeError
            ? html`<p class="text-red-400 text-sm text-center">
                ${this.codeError}
              </p>`
            : null}
          <div class="flex gap-3">
            <button
              class="steam-link-cancel-btn ${BUTTON_BASE} bg-white/5 text-white/60 border border-white/10 hover:bg-white/10 hover:text-white/80"
              @click=${() => this.close()}
            >
              ${translateText("common.cancel")}
            </button>
            <button
              class="steam-link-code-submit-btn ${BUTTON_BASE} bg-malibu-blue text-white hover:bg-aquarius"
              @click=${() => this.handleCodeSubmit()}
            >
              ${translateText("steam_link_modal.code_submit")}
            </button>
          </div>
        </div>
      `;
    }

    const ready = this.loadState === "ready";
    // this.username is only ever set from userMe.player.username ?? publicId
    // (see onOpen/handleCodeSubmit) — always a real, identifying string once
    // ready. The `?? ""` here is just a defensive TS-null guard, never
    // expected to actually render; there is deliberately no "unknown
    // account" placeholder text, since a shared-machine confirm screen that
    // can't name the account defeats the point of asking at all.
    const account = ready
      ? (this.username ?? "")
      : translateText("steam_link_modal.loading_placeholder");

    // Once ready, a null personaName means there is genuinely no Steam name
    // to show — always true for the code path (no ticket lookup exists for
    // a code), and rarely also true for the token path when Steam itself
    // declines to resolve one. Filling the generic template's {persona} slot
    // with a placeholder noun in that case reads as "Link Steam your Steam
    // account with account ..." — a doubled "Steam" — so it gets its own
    // template instead of trying to make one string serve both cases.
    const prompt =
      ready && this.personaName === null
        ? translateText("steam_link_modal.confirm_prompt_no_persona", {
            username: account,
          })
        : translateText("steam_link_modal.confirm_prompt", {
            persona: ready
              ? (this.personaName as string)
              : translateText("steam_link_modal.loading_placeholder"),
            username: account,
          });

    // "success" is handled by the early return above — by construction it
    // can't reach here, so only "redeeming" needs to gate the button.
    const confirmDisabled = !ready || this.redeemState === "redeeming";
    const confirmLabel =
      this.redeemState === "redeeming"
        ? translateText("steam_link_modal.linking")
        : translateText("steam_link_modal.confirm");

    return html`
      <div class="flex flex-col gap-6 p-6">
        <p class="text-white text-lg font-medium text-center">${prompt}</p>
        ${this.redeemState === "failed"
          ? html`<p class="text-red-400 text-sm text-center">
              ${reasonMessage(this.failureReason, this.retryAfterSeconds)}
            </p>`
          : null}
        <div class="flex gap-3">
          <button
            class="steam-link-cancel-btn ${BUTTON_BASE} bg-white/5 text-white/60 border border-white/10 hover:bg-white/10 hover:text-white/80"
            ?disabled=${this.redeemState === "redeeming"}
            @click=${() => this.close()}
          >
            ${translateText("common.cancel")}
          </button>
          <button
            class="steam-link-confirm-btn ${BUTTON_BASE} bg-malibu-blue text-white hover:bg-aquarius"
            ?disabled=${confirmDisabled}
            @click=${() => this.handleConfirm()}
          >
            ${confirmLabel}
          </button>
        </div>
      </div>
    `;
  }
}
