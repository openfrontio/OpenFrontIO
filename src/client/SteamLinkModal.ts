import { html, TemplateResult } from "lit";
import { customElement } from "lit/decorators.js";
import { getUserMe, invalidateUserMe } from "./Api";
import { isLoggedIn } from "./Auth";
import { BaseModal } from "./components/BaseModal";
import { modalHeader } from "./components/ui/ModalHeader";
import {
  fetchSteamLinkTicket,
  redeemSteamLink,
  stashPendingLink,
} from "./SteamLink";
import { translateText } from "./Utils";

type LoadState = "loading" | "ready" | "load_error";
type RedeemState = "idle" | "redeeming" | "success" | "failed";

// Known machine-readable refusal reasons from POST /auth/steam/link (see the
// status-code mapping in SteamLink.ts's redeemSteamLink). Each gets its own
// message — the reason is surfaced verbatim by the server precisely so the
// UI doesn't have to collapse it into one generic failure. A reason this
// build doesn't recognise (e.g. a future addition) falls back to the generic
// key rather than rendering a raw server code.
const REASON_KEYS: Record<string, string> = {
  account_already_has_steam:
    "steam_link_modal.reason_account_already_has_steam",
  steam_linked_elsewhere: "steam_link_modal.reason_steam_linked_elsewhere",
  steam_has_progress: "steam_link_modal.reason_steam_has_progress",
  expired: "steam_link_modal.reason_expired",
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
 */
@customElement("steam-link-modal")
export class SteamLinkModal extends BaseModal {
  private loadState: LoadState = "loading";
  private redeemState: RedeemState = "idle";
  private failureReason: string | null = null;

  private token: string | null = null;
  private personaName: string | null = null;
  private username: string | null = null;

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
    this.token = token;
    this.open();
  }

  protected onOpen(): void {
    const myRequestId = ++this.requestId;
    this.loadState = "loading";
    this.redeemState = "idle";
    this.failureReason = null;
    this.personaName = null;
    this.username = null;

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
    this.requestId++;
  }

  private async handleConfirm(): Promise<void> {
    if (
      this.loadState !== "ready" ||
      this.redeemState === "redeeming" ||
      this.redeemState === "success"
    ) {
      return;
    }
    const token = this.token;
    if (token === null) return;

    const myRequestId = this.requestId;
    this.redeemState = "redeeming";
    this.failureReason = null;
    this.requestUpdate();

    const result = await redeemSteamLink(token);
    if (myRequestId !== this.requestId) return; // closed/reopened meanwhile

    if (result.ok) {
      invalidateUserMe();
      this.redeemState = "success";
    } else {
      this.redeemState = "failed";
      this.failureReason = result.reason;
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

    return html`
      <div class="flex flex-col gap-6 p-6">
        <p class="text-white text-lg font-medium text-center">${prompt}</p>
        ${this.redeemState === "failed"
          ? html`<p class="text-red-400 text-sm text-center">
              ${translateText(
                REASON_KEYS[this.failureReason ?? ""] ?? DEFAULT_REASON_KEY,
              )}
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
