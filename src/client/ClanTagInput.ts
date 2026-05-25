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
  private currentCheck: Promise<void> = Promise.resolve();
  private resolveDebounce: (() => void) | null = null;
  private lastTranslatedLang: string | null = null;

  createRenderRoot() {
    return this;
  }

  public isValid(): boolean {
    return this.formatError === "" && this.ownershipError === "";
  }

  public getValue(): string | null {
    return this.isValid() &&
      this.clanTag.length >= MIN_CLAN_TAG_LENGTH &&
      this.clanTag.length <= MAX_CLAN_TAG_LENGTH &&
      validateClanTag(this.clanTag).isValid
      ? this.clanTag
      : null;
  }

  connectedCallback() {
    super.connectedCallback();
    this.clanTag = localStorage.getItem(clanTagKey) ?? "";
    // No user input to coalesce on initial mount — fire the ownership check
    // immediately instead of paying the debounce delay.
    this.validate({ immediate: true });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.checkTimer !== null) {
      clearTimeout(this.checkTimer);
      this.checkTimer = null;
    }
    this.checkCounter++; // cancel any in-flight async check
    if (this.resolveDebounce) this.resolveDebounce();
    this.resolveDebounce = null;
    this.currentCheck = Promise.resolve();
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

  private validate(options: { immediate?: boolean } = {}) {
    const tag = this.clanTag;
    const result = validateClanTag(tag);
    this.formatError = result.isValid ? "" : (result.error ?? "");

    // Cancel any pending/in-flight ownership check. checkCounter++ marks
    // any in-flight async work obsolete (stillCurrent() in checkOwnership
    // returns false). Resolve the prior debounce so awaitValidation()
    // callers don't hang on the cancelled chain.
    if (this.checkTimer !== null) clearTimeout(this.checkTimer);
    this.checkTimer = null;
    this.checkCounter++;
    if (this.resolveDebounce) this.resolveDebounce();
    this.resolveDebounce = null;

    if (!result.isValid || tag.length === 0) {
      // Nothing to ask the server about — clear any old ownership error
      // and wipe the stored tag so a reload doesn't restore a stale value
      // that no longer matches the current (invalid/empty) input.
      this.ownershipError = "";
      localStorage.setItem(clanTagKey, "");
      this.currentCheck = Promise.resolve();
    } else if (options.immediate) {
      // Initial mount / non-typing trigger — no input to coalesce, run now.
      this.currentCheck = this.checkOwnership(tag);
    } else {
      const debounce = new Promise<void>((resolve) => {
        this.resolveDebounce = resolve;
      });
      this.checkTimer = setTimeout(() => {
        this.checkTimer = null;
        const resolve = this.resolveDebounce;
        this.resolveDebounce = null;
        resolve?.();
      }, CLAN_OWNERSHIP_DEBOUNCE_MS);
      this.currentCheck = debounce.then(() => this.checkOwnership(tag));
    }

    this.refreshError();
  }

  // Resolves once the latest validate() chain finishes — either the debounce
  // timer + ownership check, or immediately if the input is invalid/empty.
  public async awaitValidation(): Promise<void> {
    let last: Promise<void> | undefined;
    while (this.currentCheck !== last) {
      last = this.currentCheck;
      await last;
    }
  }

  // Are you a member? If not, only accept when the API confirms the clan
  // doesn't exist (fictional). Inconclusive results (null/timeout) reject so
  // the client matches the server's fail-closed enforcement — otherwise the
  // client would let the modal open with a tag the server later drops.
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
      if (exists !== false) {
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
