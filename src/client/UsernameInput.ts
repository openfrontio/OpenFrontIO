import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { generateCryptoRandomUUID, translateText } from "../client/Utils";
import {
  MAX_USERNAME_LENGTH,
  MIN_USERNAME_LENGTH,
} from "../core/validations/username";
import { crazyGamesSDK } from "./CrazyGamesSDK";
import { IdentityReadyController } from "./identity/IdentityReadyController";
import {
  getUsernameForSubmit,
  initIdentityFromStorage,
  revalidateIdentityTranslations,
  setUsername,
} from "./identity/IdentityStore";

interface LangSelectorLike {
  currentLang?: string;
  translations?: Record<string, string>;
  defaultTranslations?: Record<string, string>;
}

@customElement("username-input")
export class UsernameInput extends LitElement {
  private identity = new IdentityReadyController(this);
  private lastTranslatedLang: string | null = null;

  createRenderRoot() {
    return this;
  }

  public getUsername(): string {
    return getUsernameForSubmit();
  }

  public isValid(): boolean {
    return this.identity.state.username.valid;
  }

  connectedCallback() {
    super.connectedCallback();
    initIdentityFromStorage();
    // Fall back to an anonymous handle the first time a user shows up with
    // nothing in storage, so the field isn't empty (which would fail
    // validation immediately and block play).
    if (getUsernameForSubmit().length === 0) {
      setUsername(genAnonUsername());
    }
    crazyGamesSDK.getUsername().then((username) => {
      if (username) setUsername(username);
    });
    crazyGamesSDK.addAuthListener((user) => {
      if (user) setUsername(user.username);
    });
  }

  protected updated(): void {
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
    const { value, error } = this.identity.state.username;
    return html`
      <div class="relative w-full h-full">
        <input
          type="text"
          .value=${value}
          @input=${this.handleInput}
          placeholder="${translateText("username.enter_username")}"
          minlength="${MIN_USERNAME_LENGTH}"
          maxlength="${MAX_USERNAME_LENGTH}"
          aria-invalid=${error ? "true" : "false"}
          class="w-full h-full border-0 text-2xl font-medium tracking-wider text-left text-white placeholder-white/70 focus:outline-none focus:ring-0 overflow-x-auto whitespace-nowrap text-ellipsis pr-2 bg-transparent"
        />
        ${error
          ? html`<div
              id="username-validation-error"
              class="absolute top-full left-0 z-50 w-full mt-1 px-3 py-2 text-sm font-medium border border-red-500/50 rounded-lg bg-red-900/90 text-red-200 backdrop-blur-md shadow-lg"
            >
              ${error}
            </div>`
          : null}
      </div>
    `;
  }

  private handleInput(e: Event) {
    const input = e.target as HTMLInputElement;
    const originalValue = input.value;
    const stripped = originalValue.replace(/[[\]]/g, "");
    if (originalValue !== stripped) {
      input.value = stripped;
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
    setUsername(stripped);
  }

  public showValidationFeedback(): void {
    const message =
      this.identity.state.username.error ||
      translateText("username.invalid_chars");
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
    if (this.isValid()) return true;
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
