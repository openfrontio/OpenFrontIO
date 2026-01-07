import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { v4 as uuidv4 } from "uuid";
import { translateText } from "../client/Utils";
import { getClanTagOriginalCase, sanitizeClanTag } from "../core/Util";
import {
  MAX_USERNAME_LENGTH,
  validateUsername,
} from "../core/validations/username";

const usernameKey: string = "username";

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

  public getCurrentUsername(): string {
    return this.constructFullUsername();
  }

  private constructFullUsername(): string {
    if (this.clanTag.length >= 2) {
      return `[${this.clanTag}] ${this.baseUsername}`;
    }
    return this.baseUsername;
  }

  connectedCallback() {
    super.connectedCallback();
    const stored = this.getStoredUsername();
    this.parseAndSetUsername(stored);
  }

  private parseAndSetUsername(fullUsername: string) {
    const tag = getClanTagOriginalCase(fullUsername);
    if (tag) {
      this.clanTag = tag;
      this.baseUsername = fullUsername.replace(`[${tag}]`, "").trim();
    } else {
      this.clanTag = "";
      this.baseUsername = fullUsername;
    }
  }

  render() {
    return html`
      <div class="flex items-center w-full h-full gap-2 px-4">
        <input
          type="text"
          .value=${this.clanTag}
          @input=${this.handleClanTagChange}
          placeholder="${translateText("username.tag")}"
          maxlength="5"
          class="w-20 bg-transparent border-b border-white/20 text-white placeholder-white/30 text-xl font-bold text-center focus:outline-none focus:border-white/50 transition-colors uppercase"
        />
        <input
          type="text"
          .value=${this.baseUsername}
          @input=${this.handleUsernameChange}
          placeholder="${translateText("username.enter_username")}"
          maxlength="${MAX_USERNAME_LENGTH}"
          class="flex-1 bg-transparent border-0 text-white placeholder-white/30 text-2xl font-bold text-left focus:outline-none focus:ring-0 focus:bg-white/5 transition-colors"
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
    const val = sanitizeClanTag(input.value);
    if (input.value !== val) {
      input.value = val;
    }
    this.clanTag = val;
    this.validateAndStore();
  }

  private handleUsernameChange(e: Event) {
    const input = e.target as HTMLInputElement;
    this.baseUsername = input.value;
    this.baseUsername = input.value;
    this.validateAndStore();
  }

  private validateAndStore() {
    const full = this.constructFullUsername();
    const trimmedFull = full.trim();

    const result = validateUsername(trimmedFull);
    this._isValid = result.isValid;
    if (result.isValid) {
      this.storeUsername(trimmedFull);
      this.validationError = "";
    } else {
      this.validationError = result.error ?? "";
    }
  }

  private getStoredUsername(): string {
    const storedUsername = localStorage.getItem(usernameKey);
    if (storedUsername) {
      return storedUsername;
    }
    return this.generateNewUsername();
  }

  private storeUsername(username: string) {
    if (username) {
      localStorage.setItem(usernameKey, username);
    }
  }

  private generateNewUsername(): string {
    const newUsername = "Anon" + this.uuidToThreeDigits();
    this.storeUsername(newUsername);
    return newUsername;
  }

  private uuidToThreeDigits(): string {
    const uuid = uuidv4();
    const cleanUuid = uuid.replace(/-/g, "").toLowerCase();
    const decimal = BigInt(`0x${cleanUuid}`);
    const threeDigits = decimal % 1000n;
    return threeDigits.toString().padStart(3, "0");
  }

  public isValid(): boolean {
    return this._isValid;
  }
}
