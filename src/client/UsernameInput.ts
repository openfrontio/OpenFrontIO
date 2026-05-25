import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { generateCryptoRandomUUID, translateText } from "../client/Utils";
import {
  MAX_USERNAME_LENGTH,
  MIN_USERNAME_LENGTH,
  validateUsername,
} from "../core/validations/username";
import { crazyGamesSDK } from "./CrazyGamesSDK";

interface LangSelectorLike {
  currentLang?: string;
  translations?: Record<string, string>;
  defaultTranslations?: Record<string, string>;
}

const usernameKey: string = "username";

@customElement("username-input")
export class UsernameInput extends LitElement {
  @state() private baseUsername: string = "";

  @property({ type: String }) validationError: string = "";
  private _isValid: boolean = true;
  private _lastValidatedLang: string | null = null;

  createRenderRoot() {
    // Disable shadow DOM to allow Tailwind classes to work
    return this;
  }

  public getUsername(): string {
    return this.baseUsername.trim();
  }

  connectedCallback() {
    super.connectedCallback();
    this.loadStoredUsername();
    crazyGamesSDK.getUsername().then((username) => {
      if (username) {
        this.baseUsername = username;
        this.validateAndStore();
      }
    });
    crazyGamesSDK.addAuthListener((user) => {
      if (user) {
        this.baseUsername = user.username;
        this.validateAndStore();
      }
    });
  }

  protected updated(): void {
    // Re-validate when translations become available or language changes,
    // since initial validation may run before translations are loaded.
    if (this.validationError) {
      const langSelector = document.querySelector<LangSelectorLike & Element>(
        "lang-selector",
      );
      const lang = langSelector?.currentLang;
      const hasTranslations =
        langSelector?.translations ?? langSelector?.defaultTranslations;
      if (hasTranslations && lang && lang !== this._lastValidatedLang) {
        this._lastValidatedLang = lang;
        this.validateAndStore();
      }
    }
  }

  private loadStoredUsername() {
    const storedUsername = localStorage.getItem(usernameKey);
    if (storedUsername) {
      this.baseUsername = storedUsername;
      this.validateAndStore();
    } else {
      this.baseUsername = genAnonUsername();
      this.validateAndStore();
    }
  }

  render() {
    return html`
      <div class="relative w-full h-full">
        <input
          type="text"
          .value=${this.baseUsername}
          @input=${this.handleUsernameChange}
          placeholder="${translateText("username.enter_username")}"
          minlength="${MIN_USERNAME_LENGTH}"
          maxlength="${MAX_USERNAME_LENGTH}"
          class="w-full h-full border-0 text-2xl font-medium tracking-wider text-left text-white placeholder-white/70 focus:outline-none focus:ring-0 overflow-x-auto whitespace-nowrap text-ellipsis pr-2 bg-transparent"
        />
        ${this.validationError
          ? html`<div
              id="username-validation-error"
              class="absolute top-full left-0 z-50 w-full mt-1 px-3 py-2 text-sm font-medium border border-red-500/50 rounded-lg bg-red-900/90 text-red-200 backdrop-blur-md shadow-lg"
            >
              ${this.validationError}
            </div>`
          : null}
      </div>
    `;
  }

  private handleUsernameChange(e: Event) {
    const input = e.target as HTMLInputElement;
    const originalValue = input.value;
    const val = originalValue.replace(/[[\]]/g, "");
    if (originalValue !== val) {
      input.value = val;
      window.dispatchEvent(
        new CustomEvent("show-message", {
          detail: {
            message: translateText("username.invalid_chars"),
            color: "red",
            duration: 2000,
          },
        }),
      );
    }
    this.baseUsername = val;
    this.validateAndStore();
  }

  private validateAndStore() {
    const trimmedBase = this.getUsername();
    const result = validateUsername(trimmedBase);
    this._isValid = result.isValid;
    if (result.isValid) {
      localStorage.setItem(usernameKey, trimmedBase);
      this.validationError = "";
    } else {
      this.validationError = result.error ?? "";
    }
  }

  public isValid(): boolean {
    return this._isValid;
  }

  public showValidationFeedback(): void {
    const message =
      this.validationError || translateText("username.invalid_chars");
    window.dispatchEvent(
      new CustomEvent("show-message", {
        detail: {
          message,
          color: "red",
          duration: 2500,
        },
      }),
    );
  }

  public validateOrShowError(): boolean {
    if (this.isValid()) {
      return true;
    }
    this.showValidationFeedback();
    return false;
  }
}

export function genAnonUsername(): string {
  const uuid = generateCryptoRandomUUID();
  const cleanUuid = uuid.replace(/-/g, "").toLowerCase();
  const decimal = BigInt(`0x${cleanUuid}`);
  const threeDigits = decimal % 1000n;
  return "Anon" + threeDigits.toString().padStart(3, "0");
}
