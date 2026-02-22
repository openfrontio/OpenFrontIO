import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { v4 as uuidv4 } from "uuid";
import { translateText } from "../client/Utils";
import { sanitizeClanTag } from "../core/Util";
import {
  MAX_CLAN_TAG_LENGTH,
  MAX_USERNAME_LENGTH,
  MIN_CLAN_TAG_LENGTH,
  validateClanTag,
  validateUsername,
} from "../core/validations/username";
import { crazyGamesSDK } from "./CrazyGamesSDK";

const usernameKey: string = "username";
const clanTagKey: string = "clanTag";

@customElement("username-input")
export class UsernameInput extends LitElement {
  @state() private baseUsername: string = "";
  @state() private clanTag: string = "";

  @property({ type: String }) validationError: string = "";
  private _isValid: boolean = true;

  // Remove static styles since we're using Tailwind

  createRenderRoot() {
    // Disable shadow DOM to allow Tailwind classes to work
    return this;
  }

  public getUsername(): string {
    return this.baseUsername.trim();
  }

  public getClanTag(): string | null {
    return this.clanTag.length >= MIN_CLAN_TAG_LENGTH &&
      this.clanTag.length <= MAX_CLAN_TAG_LENGTH
      ? this.clanTag
      : null;
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

  private loadStoredUsername() {
    const storedUsername = localStorage.getItem(usernameKey);
    if (storedUsername) {
      this.clanTag = localStorage.getItem(clanTagKey) ?? "";
      this.baseUsername = storedUsername;
      this.validateAndStore();
    } else {
      this.baseUsername = genAnonUsername();
      this.validateAndStore();
    }
  }

  render() {
    return html`
      <div class="flex items-center w-full h-full gap-2">
        <input
          type="text"
          .value=${this.clanTag}
          @input=${this.handleClanTagChange}
          placeholder="${translateText("username.tag")}"
          maxlength="${MAX_CLAN_TAG_LENGTH}"
          class="w-[6rem] text-xl font-bold text-center uppercase shrink-0 bg-transparent text-white placeholder-white/70 focus:placeholder-transparent border-0 border-b border-white/40 focus:outline-none focus:border-white/60"
        />
        <input
          type="text"
          .value=${this.baseUsername}
          @input=${this.handleUsernameChange}
          placeholder="${translateText("username.enter_username")}"
          maxlength="${MAX_USERNAME_LENGTH}"
          class="flex-1 min-w-0 border-0 text-2xl font-bold text-left text-white placeholder-white/70 focus:outline-none focus:ring-0 overflow-x-auto whitespace-nowrap text-ellipsis pr-2 bg-transparent"
        />
      </div>
      ${this.validationError
        ? html`<div
            id="username-validation-error"
            class="absolute top-full left-0 z-50 w-full mt-1 px-3 py-2 text-sm font-medium border border-red-500/50 rounded-lg bg-red-900/90 text-red-200 backdrop-blur-md shadow-lg"
          >
            ${this.validationError}
          </div>`
        : null}
    `;
  }

  private handleClanTagChange(e: Event) {
    const input = e.target as HTMLInputElement;
    const originalValue = input.value;
    const val = sanitizeClanTag(originalValue);
    // Only show toast if characters were actually removed (not just uppercased)
    if (originalValue.toUpperCase() !== val) {
      input.value = val;
      // Show toast when invalid characters are removed
      window.dispatchEvent(
        new CustomEvent("show-message", {
          detail: {
            message: translateText("username.tag_invalid_chars"),
            color: "red",
            duration: 2000,
          },
        }),
      );
    } else if (originalValue !== val) {
      // Just update the input without toast if only case changed
      input.value = val;
    }
    this.clanTag = val;
    this.validateAndStore();
  }

  private handleUsernameChange(e: Event) {
    const input = e.target as HTMLInputElement;
    const originalValue = input.value;
    const val = originalValue.replace(/[[\]]/g, "");
    if (originalValue !== val) {
      input.value = val;
      // Show toast when brackets are removed
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

    const clanTagResult = validateClanTag(this.clanTag);
    if (!clanTagResult.isValid) {
      this._isValid = false;
      this.validationError = clanTagResult.error ?? "";
      return;
    }

    const result = validateUsername(trimmedBase);
    this._isValid = result.isValid;
    if (result.isValid) {
      localStorage.setItem(usernameKey, trimmedBase);
      localStorage.setItem(clanTagKey, this.getClanTag() ?? "");
      this.validationError = "";
    } else {
      this.validationError = result.error ?? "";
    }
  }

  public isValid(): boolean {
    return this._isValid;
  }
}

export function genAnonUsername(): string {
  const uuid = uuidv4();
  const cleanUuid = uuid.replace(/-/g, "").toLowerCase();
  const decimal = BigInt(`0x${cleanUuid}`);
  const threeDigits = decimal % 1000n;
  return "Anon" + threeDigits.toString().padStart(3, "0");
}
