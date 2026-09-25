import { html, LitElement, nothing, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { createIdentityToken, getIdentityTokenAudiences } from "../Api";
import { copyToClipboard, translateText } from "../Utils";
import "./baseComponents/Button";
import { styledSelect } from "./ui/StyledSelect";

/**
 * "Link to a third-party site": mints a short-lived identity token the player
 * pastes into a third-party site (e.g. ofstats.io) to prove which OpenFront
 * account they own. The site list is admin-managed on the API; with no sites
 * (or when it can't be loaded) the card renders nothing. The token only works
 * on the selected site, expires after 10 minutes, and is held in memory only —
 * a fresh one is minted on every click.
 */
@customElement("identity-token-card")
export class IdentityTokenCard extends LitElement {
  @state() private audiences: string[] = [];
  @state() private audience: string = "";
  @state() private token: string | null = null;
  @state() private busy: boolean = false;
  @state() private copied: boolean = false;
  @state() private errorKey: string | null = null;

  private expiryTimer: ReturnType<typeof setTimeout> | null = null;

  createRenderRoot() {
    return this;
  }

  connectedCallback(): void {
    super.connectedCallback();
    void this.loadAudiences();
  }

  disconnectedCallback(): void {
    this.clearToken();
    super.disconnectedCallback();
  }

  private async loadAudiences(): Promise<void> {
    const audiences = await getIdentityTokenAudiences();
    this.audiences = audiences;
    // Keep the player's pick if it survived a reload of the list.
    if (!audiences.includes(this.audience)) {
      this.audience = audiences[0] ?? "";
      this.clearToken();
    }
  }

  render(): TemplateResult | typeof nothing {
    if (this.audiences.length === 0) return nothing;
    return html`
      <div class="bg-white/5 rounded-xl border border-white/10 p-6">
        <div class="text-white font-medium">
          ${translateText("account_modal.identity_token_title")}
        </div>
        <div class="text-white/50 text-sm mt-1">
          ${translateText("account_modal.identity_token_desc")}
        </div>
        <div class="mt-4 flex items-center gap-3">
          ${styledSelect({
            options: this.audiences.map((a) => ({
              value: a,
              label: a,
            })),
            value: this.audience,
            onChange: this.handleAudienceChange,
            ariaLabel: translateText("account_modal.identity_token_site"),
            className: "flex-1",
          })}
          <o-button
            variant="primary"
            size="sm"
            translationKey="account_modal.identity_token_generate"
            .disable=${this.busy}
            @click=${this.handleGenerate}
          ></o-button>
        </div>
        ${this.errorKey
          ? html`<div class="text-red-400 text-sm mt-3">
              ${translateText(this.errorKey)}
            </div>`
          : nothing}
        ${this.token ? this.renderToken(this.token) : nothing}
      </div>
    `;
  }

  private renderToken(token: string): TemplateResult {
    return html`
      <div class="mt-4 flex items-center gap-3">
        <input
          type="text"
          readonly
          .value=${token}
          aria-label=${translateText("account_modal.identity_token_title")}
          @focus=${(e: Event) => (e.target as HTMLInputElement).select()}
          class="flex-1 min-w-0 px-3 py-1.5 bg-black/40 border border-white/20 rounded-lg text-white text-xs font-mono focus:outline-none focus:border-blue-500"
        />
        <o-button
          variant="secondary"
          size="sm"
          translationKey=${this.copied
            ? "account_modal.identity_token_copied"
            : "account_modal.identity_token_copy"}
          @click=${this.handleCopy}
        ></o-button>
      </div>
      <div class="text-white/50 text-xs mt-2">
        ${translateText("account_modal.identity_token_note", {
          site: this.audience,
        })}
      </div>
    `;
  }

  // A token is only valid on the site it was minted for, so switching sites
  // drops the old one rather than leaving it next to the wrong name.
  private handleAudienceChange = (value: string): void => {
    this.audience = value;
    this.clearToken();
    this.errorKey = null;
  };

  private handleGenerate = async (): Promise<void> => {
    if (this.busy) return;
    this.busy = true;
    this.errorKey = null;
    this.clearToken();
    const audience = this.audience;
    const result = await createIdentityToken(audience);
    this.busy = false;
    // The player switched sites while the request was in flight.
    if (audience !== this.audience) return;
    if (!result.ok) {
      this.errorKey =
        result.code === "rate_limited"
          ? "account_modal.identity_token_rate_limited"
          : result.code === "logged_out"
            ? "account_modal.identity_token_logged_out"
            : "account_modal.identity_token_failed";
      return;
    }
    this.token = result.data.token;
    // Drop the token from the UI once it can no longer be used.
    const ttl = Date.parse(result.data.expiresAt) - Date.now();
    this.expiryTimer = setTimeout(() => this.clearToken(), Math.max(ttl, 0));
  };

  private handleCopy = async (): Promise<void> => {
    if (!this.token) return;
    try {
      await copyToClipboard(
        this.token,
        () => (this.copied = true),
        () => (this.copied = false),
      );
    } catch {
      // Clipboard denied: the field is still selectable for a manual copy.
    }
  };

  private clearToken(): void {
    if (this.expiryTimer !== null) {
      clearTimeout(this.expiryTimer);
      this.expiryTimer = null;
    }
    this.token = null;
    this.copied = false;
  }
}
