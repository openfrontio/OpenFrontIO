import { html, LitElement, nothing, TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { UserMeResponse } from "../../core/ApiSchemas";
import { isSteamPrimaryUser } from "../AccountIdentity";
import { deleteAccount, setMarketingConsent } from "../Api";
import { clearLocalSession, linkGoogle, sendMagicLink } from "../Auth";
import { crazyGamesSDK } from "../CrazyGamesSDK";
import { showInGameAlert } from "../InGameModal";
import { steamSDK } from "../SteamSDK";
import { translateText } from "../Utils";
import "./baseComponents/Button";
import "./DeleteAccountDialog";
import { googleLinkButton } from "./ui/GoogleLinkButton";

type UserMePlayer = UserMeResponse["player"];
type UserMeUser = UserMeResponse["user"];

/**
 * Account settings: marketing-consent control (with the bind-an-email flow when
 * the account has no verified email) and self-service account deletion.
 *
 * Extracted from AccountModal so the standalone account-settings modal opened
 * from the nav profile menu and the account modal's settings tab render the
 * exact same controls.
 */
@customElement("account-settings-panel")
export class AccountSettingsPanel extends LitElement {
  @property({ attribute: false }) player: UserMePlayer | null = null;
  @property({ attribute: false }) user: UserMeUser | null = null;

  @state() private email: string = "";
  @state() private consentBusy: boolean = false;
  @state() private deleteDialogOpen: boolean = false;
  @state() private deleteBusy: boolean = false;

  createRenderRoot() {
    return this;
  }

  /**
   * Dismiss the delete confirmation. The dialog portals to document.body, so a
   * host that merely hides itself (inline modals) must call this on close or
   * the dialog outlives the modal.
   */
  public closeDialogs(): void {
    this.deleteDialogOpen = false;
  }

  disconnectedCallback(): void {
    this.closeDialogs();
    super.disconnectedCallback();
  }

  // Steam is the primary (and only, in v1) identity for a Steam user — no
  // linking UI (email/Google) is offered for them.
  private isSteamPrimary(): boolean {
    return isSteamPrimaryUser(this.user ?? undefined);
  }

  render(): TemplateResult {
    return html`
      <div class="flex flex-col gap-6">
        ${this.renderMarketingCard()} ${this.renderDeleteAccountCard()}
      </div>
    `;
  }

  // Persistent marketing-consent control (client-driven consent). Mirrors the
  // post-login toast: a player can turn email updates on/off any time here, or
  // — when there's no verified email on the account — is told to link one.
  private renderMarketingCard(): TemplateResult | typeof nothing {
    const consent = this.player?.marketingConsent;
    // The API didn't return consent state (older backend). Nothing to
    // configure, so no card rather than a misleading "link an email" prompt.
    if (!consent) return nothing;
    const hasEmail = consent.hasEmail;
    const on = consent.consented === "approved";
    return html`
      <div class="bg-white/5 rounded-xl border border-white/10 p-6">
        <!-- Centred against the title+description block, like the delete card. -->
        <div class="flex items-center justify-between gap-4">
          <div class="flex-1">
            <div class="text-white font-medium">
              ${translateText("account_modal.marketing_title")}
            </div>
            <div class="text-white/50 text-sm mt-1">
              ${hasEmail
                ? translateText("account_modal.marketing_desc")
                : translateText("account_modal.marketing_no_email")}
            </div>
          </div>
          ${hasEmail
            ? html`<button
                role="switch"
                aria-checked=${on ? "true" : "false"}
                aria-label=${translateText("account_modal.marketing_title")}
                ?disabled=${this.consentBusy}
                @click=${() => this.setConsent(!on)}
                class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-malibu-blue/50 disabled:opacity-60 ${on
                  ? "bg-malibu-blue shadow-[var(--shadow-malibu-blue-pill)]"
                  : "bg-white/15"}"
              >
                <span
                  class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-200 ${on
                    ? "translate-x-6"
                    : "translate-x-1"}"
                ></span>
              </button>`
            : nothing}
        </div>
        ${hasEmail || this.isSteamPrimary()
          ? nothing
          : this.renderEmailBinding()}
      </div>
    `;
  }

  // No verified email on the account yet. Offer both ways to attach one:
  // a magic link to a plain email (the backend associates a not-yet-registered
  // email with the current session — the "new-association" path), or linking a
  // Google account.
  private renderEmailBinding(): TemplateResult {
    return html`
      <div class="mt-4 space-y-3">
        ${this.renderEmailField()}
        <div class="flex items-center gap-4 py-1">
          <div class="h-px bg-white/10 flex-1"></div>
          <span
            class="text-[10px] uppercase tracking-widest text-white/30 font-bold"
          >
            ${translateText("account_modal.or")}
          </span>
          <div class="h-px bg-white/10 flex-1"></div>
        </div>
        ${this.user?.google ? nothing : googleLinkButton(this.handleLinkGoogle)}
      </div>
    `;
  }

  private renderEmailField(): TemplateResult {
    return html`
      <input
        type="email"
        .value=${this.email}
        @input=${this.handleEmailInput}
        placeholder=${translateText("account_modal.email_placeholder")}
        class="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-malibu-blue/50 focus:border-malibu-blue/50 transition-all font-medium hover:bg-white/10"
      />
      <o-button
        variant="primary"
        width="block"
        size="md"
        translationKey="account_modal.get_magic_link"
        @click=${this.handleSubmit}
      ></o-button>
    `;
  }

  // Self-service account deletion (DELETE /users/@me). A valid request queues
  // the deletion for 24 hours later and logs the player out everywhere, so the
  // button opens a hard confirm (typed confirmation). Hidden on CrazyGames and
  // Steam: the endpoint's credential is the refresh cookie, which isn't usable
  // there (cross-site — see Auth.ts), so the request could never succeed.
  private renderDeleteAccountCard(): TemplateResult | typeof nothing {
    if (crazyGamesSDK.isOnCrazyGames() || steamSDK.isOnSteam()) return nothing;
    return html`
      <div class="bg-white/5 rounded-xl border border-red-500/30 p-6">
        <!-- The button is one line against a two-line block, so centre it
             rather than pinning it to the first line. -->
        <div class="flex items-center justify-between gap-4">
          <div class="flex-1">
            <div class="text-white font-medium">
              ${translateText("account_modal.delete_account_title")}
            </div>
            <div class="text-white/50 text-sm mt-1">
              ${translateText("account_modal.delete_account_desc")}
            </div>
          </div>
          <o-button
            variant="danger"
            size="sm"
            translationKey="account_modal.delete_account_title"
            .disable=${this.deleteBusy}
            @click=${() => {
              this.deleteDialogOpen = true;
            }}
          ></o-button>
        </div>
      </div>
      ${this.deleteDialogOpen
        ? html`<delete-account-dialog
            @confirm=${this.handleDeleteAccount}
            @cancel=${() => {
              this.deleteDialogOpen = false;
            }}
          ></delete-account-dialog>`
        : nothing}
    `;
  }

  private handleDeleteAccount = async (): Promise<void> => {
    this.deleteDialogOpen = false;
    if (this.deleteBusy) return;

    this.deleteBusy = true;
    const result = await deleteAccount();
    this.deleteBusy = false;

    if (result.ok) {
      // 204: the deletion is queued for 24 hours from now, not done — say so,
      // and point at support since cancelling is a support action (there is
      // no self-service cancel). Every session is already revoked and the
      // refresh cookie cleared, so only local state is left to drop; calling
      // /auth/logout here would be wrong (the credential no longer exists).
      // Drop local state before the alert: it resolves only when the player
      // clicks Close, and closing the tab instead must not leave the revoked
      // session looking signed in on the next launch.
      clearLocalSession();
      await showInGameAlert(
        translateText("account_modal.delete_account_scheduled"),
      );
      // Navigate to the homepage rather than reloading in place: reloading
      // keeps the #modal=account-settings hash, which reopens a login-gated
      // modal for a now-logged-out player.
      window.location.replace("/");
      return;
    }
    if (result.code === "logged_out") {
      // 401: the session was already gone and the cookie is cleared. Nothing
      // was queued; drop local state so the player can sign in and retry.
      clearLocalSession();
      window.location.replace("/");
      return;
    }
    if (result.code === "forbidden" && result.message !== undefined) {
      // Server's player-facing refusal (root player / banned account).
      await showInGameAlert(result.message);
    } else if (result.code === "rate_limited") {
      await showInGameAlert(
        translateText("account_modal.delete_account_rate_limited"),
      );
    } else {
      await showInGameAlert(
        translateText("account_modal.delete_account_failed"),
      );
    }
  };

  private async setConsent(consented: boolean): Promise<void> {
    const consent = this.player?.marketingConsent;
    if (!consent || this.consentBusy) return;
    const previous = consent.consented;
    const next = consented ? "approved" : "denied";
    if (previous === next) return;

    // Optimistic: reflect the new state immediately, revert if the request fails.
    this.consentBusy = true;
    consent.consented = next;
    this.requestUpdate();

    const ok = await setMarketingConsent(consented);
    if (!ok) {
      consent.consented = previous;
    }
    this.consentBusy = false;
    this.requestUpdate();
  }

  private handleEmailInput = (e: Event): void => {
    this.email = (e.target as HTMLInputElement).value;
  };

  private handleSubmit = async (): Promise<void> => {
    if (!this.email) {
      await showInGameAlert(translateText("account_modal.enter_email_address"));
      return;
    }

    const success = await sendMagicLink(this.email);
    await showInGameAlert(
      success
        ? translateText("account_modal.recovery_email_sent", {
            email: this.email,
          })
        : translateText("account_modal.failed_to_send_recovery_email"),
    );
  };

  private handleLinkGoogle = async (): Promise<void> => {
    // On success linkGoogle navigates to Google; the result comes back as a
    // `link=...` router arg handled by the account modal. A false return means
    // we couldn't start it.
    const started = await linkGoogle();
    if (!started) {
      await showInGameAlert(translateText("account_modal.link_google_failed"));
    }
  };
}
