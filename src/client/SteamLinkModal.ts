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
 * explicit click), it just falls back to the same "unknown persona" copy
 * already used when Steam itself declines to resolve a name.
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
  // confirm step needs the logged-in account's name. Unlike a token, a
  // not-yet-submitted code isn't stashed across the login redirect — there's
  // nothing typed yet to preserve, so the player just re-opens this after
  // logging in and re-enters it. That's a minor inconvenience (a few
  // keystrokes), not a lost flow.
  public async openForCodeEntry(): Promise<void> {
    if (!(await isLoggedIn())) {
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
        this.username = userMe.player.username ?? null;
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
    // render already falls back to "unknown_persona" for.
    void getUserMe().then((userMe) => {
      if (myRequestId !== this.requestId) return; // superseded
      if (userMe === false) {
        this.loadState = "load_error";
        this.requestUpdate();
        return;
      }
      this.personaName = null;
      this.username = userMe.player.username ?? null;
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
    } else {
      this.redeemState = "failed";
      this.failureReason = result.reason;
      this.retryAfterSeconds = result.retryAfterSeconds ?? null;
    }
    this.requestUpdate();
  }

  protected renderBody(): TemplateResult {
    if (this.loadState === "load_error") {
      return html`
        <div class="flex flex-col gap-4 p-6 text-center">
          <p class="text-red-300 text-sm font-medium">
            ${translateText("steam_link_modal.load_error")}
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
    const persona = ready
      ? (this.personaName ?? translateText("steam_link_modal.unknown_persona"))
      : translateText("steam_link_modal.loading_placeholder");
    const account = ready
      ? (this.username ?? translateText("steam_link_modal.unknown_username"))
      : translateText("steam_link_modal.loading_placeholder");

    const prompt = translateText("steam_link_modal.confirm_prompt", {
      persona,
      username: account,
    });

    // "success" is handled by the early return above — by construction it
    // can't reach here, so only "redeeming" needs to gate the button.
    const confirmDisabled = !ready || this.redeemState === "redeeming";
    const confirmLabel =
      this.redeemState === "redeeming"
        ? translateText("steam_link_modal.linking")
        : translateText("steam_link_modal.confirm");

    // "rate_limited" is the one reason whose message takes a parameter
    // (Retry-After's seconds, when the server sent one) — every other reason
    // is a fixed string, so only this one needs the params argument at all.
    const failureMessage = () => {
      const reasonKey =
        REASON_KEYS[this.failureReason ?? ""] ?? DEFAULT_REASON_KEY;
      if (this.failureReason === "rate_limited") {
        return translateText(reasonKey, {
          seconds: this.retryAfterSeconds ?? 0,
        });
      }
      return translateText(reasonKey);
    };

    return html`
      <div class="flex flex-col gap-6 p-6">
        <p class="text-white text-lg font-medium text-center">${prompt}</p>
        ${this.redeemState === "failed"
          ? html`<p class="text-red-400 text-sm text-center">
              ${failureMessage()}
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
