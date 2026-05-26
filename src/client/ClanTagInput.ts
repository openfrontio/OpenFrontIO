import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { translateText } from "../client/Utils";
import {
  MAX_CLAN_TAG_LENGTH,
  MIN_CLAN_TAG_LENGTH,
} from "../core/validations/username";
import { IdentityReadyController } from "./identity/IdentityReadyController";
import {
  awaitIdentityReady,
  getClanTagForSubmit,
  initIdentityFromStorage,
  revalidateIdentityTranslations,
  setClanTag,
} from "./identity/IdentityStore";

interface LangSelectorLike {
  currentLang?: string;
  translations?: Record<string, string>;
  defaultTranslations?: Record<string, string>;
}

@customElement("clan-tag-input")
export class ClanTagInput extends LitElement {
  private identity = new IdentityReadyController(this);
  private lastTranslatedLang: string | null = null;

  createRenderRoot() {
    return this;
  }

  public isValid(): boolean {
    return this.identity.state.clanTag.valid;
  }

  public getValue(): string | null {
    return getClanTagForSubmit();
  }

  connectedCallback() {
    super.connectedCallback();
    initIdentityFromStorage();
  }

  protected updated(): void {
    // Re-translate any error string when the active language changes — the
    // store caches the i18n key for ownership errors, but format errors are
    // raw translated strings that need to be regenerated.
    const ls = document.querySelector<LangSelectorLike & Element>(
      "lang-selector",
    );
    const lang = ls?.currentLang;
    const hasTranslations = ls?.translations ?? ls?.defaultTranslations;
    if (hasTranslations && lang && lang !== this.lastTranslatedLang) {
      this.lastTranslatedLang = lang;
      revalidateIdentityTranslations();
    }
  }

  render() {
    const { value, error } = this.identity.state.clanTag;
    const checking = this.identity.validating;
    const displayError = this.translatedError(error);
    return html`
      <div class="relative flex items-center h-full">
        <input
          type="text"
          .value=${value}
          @input=${this.handleInput}
          placeholder="${translateText("username.tag")}"
          minlength="${MIN_CLAN_TAG_LENGTH}"
          maxlength="${MAX_CLAN_TAG_LENGTH}"
          aria-busy=${checking ? "true" : "false"}
          aria-invalid=${displayError ? "true" : "false"}
          class="w-[6rem] text-xl font-medium tracking-wider text-center uppercase shrink-0 bg-transparent text-white placeholder-white/70 focus:placeholder-transparent border-0 border-b border-white/40 focus:outline-none focus:border-white/60"
        />
        ${checking
          ? html`<span
              class="absolute right-1 top-1/2 -translate-y-1/2 w-3 h-3 border-2 border-white/30 border-t-white/80 rounded-full animate-spin pointer-events-none"
              aria-hidden="true"
            ></span>`
          : null}
        ${displayError
          ? html`<div
              id="clan-tag-validation-error"
              class="absolute top-full left-0 z-50 mt-1 px-3 py-2 text-sm font-medium border border-red-500/50 rounded-lg bg-red-900/90 text-red-200 backdrop-blur-md shadow-lg whitespace-nowrap"
            >
              ${displayError}
            </div>`
          : null}
      </div>
    `;
  }

  private translatedError(raw: string): string {
    if (!raw) return "";
    // Ownership errors are stored as i18n keys (with optional tag param);
    // format errors are already-translated strings from validateClanTag.
    if (raw === "username.tag_not_member") {
      return translateText(raw, { tag: this.identity.state.clanTag.value });
    }
    return raw;
  }

  private handleInput(e: Event) {
    const input = e.target as HTMLInputElement;
    const raw = input.value;
    const upper = raw.toUpperCase();
    setClanTag(raw);
    const sanitized = this.identity.state.clanTag.value;
    if (upper !== sanitized) {
      window.dispatchEvent(
        new CustomEvent("show-message", {
          detail: {
            message: translateText("username.tag_invalid_chars"),
            color: "red",
            duration: 2000,
          },
        }),
      );
    }
    input.value = sanitized;
  }

  // Resolves once any in-flight async ownership check settles. Returns
  // immediately when nothing is in flight.
  public async awaitValidation(): Promise<void> {
    await awaitIdentityReady();
  }

  public showValidationFeedback() {
    const message =
      this.translatedError(this.identity.state.clanTag.error) ||
      translateText("username.tag_invalid_chars");
    window.dispatchEvent(
      new CustomEvent("show-message", {
        detail: { message, color: "red", duration: 2500 },
      }),
    );
  }

  public validateOrShowError(): boolean {
    if (this.isValid()) return true;
    this.showValidationFeedback();
    return false;
  }
}
