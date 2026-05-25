import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { translateText } from "../client/Utils";
import { sanitizeClanTag } from "../core/Util";
import {
  MAX_CLAN_TAG_LENGTH,
  MIN_CLAN_TAG_LENGTH,
  validateClanTag,
} from "../core/validations/username";
import { getUserMe } from "./Api";
import { fetchClanExists } from "./ClanApi";

const CLAN_OWNERSHIP_DEBOUNCE_MS = 400;
const clanTagKey = "clanTag";

interface LangSelectorLike {
  currentLang?: string;
  translations?: Record<string, string>;
  defaultTranslations?: Record<string, string>;
}

@customElement("clan-tag-input")
export class ClanTagInput extends LitElement {
  @state() private clanTag: string = "";

  @property({ type: String }) validationError: string = "";

  private formatError: string = "";
  private ownershipError: string = "";
  private checkCounter: number = 0;
  private checkTimer: ReturnType<typeof setTimeout> | null = null;
  private lastTranslatedLang: string | null = null;

  createRenderRoot() {
    return this;
  }

  public isValid(): boolean {
    return this.formatError === "" && this.ownershipError === "";
  }

  public getValue(): string | null {
    return this.clanTag.length >= MIN_CLAN_TAG_LENGTH &&
      this.clanTag.length <= MAX_CLAN_TAG_LENGTH &&
      validateClanTag(this.clanTag).isValid
      ? this.clanTag
      : null;
  }

  connectedCallback() {
    super.connectedCallback();
    this.clanTag = localStorage.getItem(clanTagKey) ?? "";
    this.validate();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.checkTimer !== null) {
      clearTimeout(this.checkTimer);
      this.checkTimer = null;
    }
    this.checkCounter++; // cancel any in-flight async check
  }

  protected updated(): void {
    // Re-validate when translations finish loading so the initial error
    // (which may have been built from raw keys) gets re-translated.
    if (!this.validationError) return;
    const ls = document.querySelector<LangSelectorLike & Element>(
      "lang-selector",
    );
    const lang = ls?.currentLang;
    const hasTranslations = ls?.translations ?? ls?.defaultTranslations;
    if (hasTranslations && lang && lang !== this.lastTranslatedLang) {
      this.lastTranslatedLang = lang;
      this.validate();
    }
  }

  render() {
    return html`
      <div class="relative flex items-center h-full">
        <input
          type="text"
          .value=${this.clanTag}
          @input=${this.handleInput}
          placeholder="${translateText("username.tag")}"
          minlength="${MIN_CLAN_TAG_LENGTH}"
          maxlength="${MAX_CLAN_TAG_LENGTH}"
          class="w-[6rem] text-xl font-medium tracking-wider text-center uppercase shrink-0 bg-transparent text-white placeholder-white/70 focus:placeholder-transparent border-0 border-b border-white/40 focus:outline-none focus:border-white/60"
        />
        ${this.validationError
          ? html`<div
              id="clan-tag-validation-error"
              class="absolute top-full left-0 z-50 mt-1 px-3 py-2 text-sm font-medium border border-red-500/50 rounded-lg bg-red-900/90 text-red-200 backdrop-blur-md shadow-lg whitespace-nowrap"
            >
              ${this.validationError}
            </div>`
          : null}
      </div>
    `;
  }

  private handleInput(e: Event) {
    const input = e.target as HTMLInputElement;
    const sanitized = sanitizeClanTag(input.value);
    if (input.value.toUpperCase() !== sanitized) {
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
    this.clanTag = sanitized;
    this.validate();
  }

  private validate() {
    const tag = this.clanTag;
    const result = validateClanTag(tag);
    this.formatError = result.isValid ? "" : (result.error ?? "");

    // Cancel any pending/in-flight ownership check.
    if (this.checkTimer !== null) clearTimeout(this.checkTimer);
    this.checkTimer = null;
    this.checkCounter++;

    if (!result.isValid || tag.length === 0) {
      // Nothing to ask the server about — clear any old ownership error,
      // and remember the cleared/short value across reloads.
      this.ownershipError = "";
      if (result.isValid) localStorage.setItem(clanTagKey, "");
    } else {
      this.checkTimer = setTimeout(() => {
        this.checkTimer = null;
        void this.checkOwnership(tag);
      }, CLAN_OWNERSHIP_DEBOUNCE_MS);
    }

    this.refreshError();
  }

  // Are you a member? If not, does the clan exist? If it doesn't (fictional)
  // or the check fails open, accept. Otherwise reject.
  private async checkOwnership(tag: string) {
    const checkId = this.checkCounter;
    const stillCurrent = () =>
      checkId === this.checkCounter && this.clanTag === tag;

    const me = await getUserMe();
    if (!stillCurrent()) return;
    const myTags = me
      ? (me.player.clans ?? []).map((c) => c.tag.toUpperCase())
      : [];

    if (!myTags.includes(tag.toUpperCase())) {
      const exists = await fetchClanExists(tag);
      if (!stillCurrent()) return;
      if (exists === true) {
        this.reject(tag);
        return;
      }
    }
    this.accept(tag);
  }

  private accept(tag: string) {
    this.ownershipError = "";
    localStorage.setItem(clanTagKey, tag);
    this.refreshError();
  }

  private reject(tag: string) {
    this.ownershipError = translateText("username.tag_not_member", { tag });
    localStorage.removeItem(clanTagKey);
    this.refreshError();
  }

  private refreshError() {
    const next = this.formatError || this.ownershipError;
    if (this.validationError !== next) {
      this.validationError = next;
      this.requestUpdate();
    }
  }

  public showValidationFeedback() {
    const message =
      this.validationError || translateText("username.tag_invalid_chars");
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
