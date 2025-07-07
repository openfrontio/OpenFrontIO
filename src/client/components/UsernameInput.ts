import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { v4 as uuidv4 } from "uuid";
import { UserSettings } from "../../core/game/UserSettings";
import {
  MAX_USERNAME_LENGTH,
  validateUsername,
} from "../../core/validations/username";
import { translateText } from "../Utils";

const usernameKey: string = "username";

@customElement("username-input")
export class UsernameInput extends LitElement {
  @state() private username: string = "";
  @property({ type: String }) validationError: string = "";
  private _isValid: boolean = true;
  private userSettings: UserSettings = new UserSettings();

  createRenderRoot() {
    return this;
  }

  public getCurrentUsername(): string {
    return this.username;
  }

  connectedCallback() {
    super.connectedCallback();
    this.username = this.getStoredUsername();
    this.dispatchUsernameEvent();
  }

  render() {
    return html`
      <div class="relative w-full">
        ${this.validationError
          ? html`<div
              id="username-validation-error"
              class="background-panel absolute !z-50 w-full mb-2 px-3 py-1 text-small border border-red text-red font-title"
              style="bottom: 100%;"
            >
              ${this.validationError}
            </div>`
          : null}
        <input
          type="text"
          .value=${this.username}
          @input=${this.handleChange}
          @change=${this.handleChange}
          placeholder="${translateText("username.enter_username")}"
          maxlength="${MAX_USERNAME_LENGTH}"
          class="w-full px-4 py-3 bg-backgroundDarkLighter border-2 border-borderBase font-title text-textLight placeholder-textGrey focus:outline-none focus:border-primary"
          style="caret-color: var(--primary-color);"
        />
      </div>
    `;
  }
  private handleChange(e: Event) {
    const input = e.target as HTMLInputElement;
    this.username = input.value.trim();
    const result = validateUsername(this.username);
    this._isValid = result.isValid;
    if (result.isValid) {
      this.storeUsername(this.username);
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

  private dispatchUsernameEvent() {
    this.dispatchEvent(
      new CustomEvent("username-change", {
        detail: { username: this.username },
        bubbles: true,
        composed: true,
      }),
    );
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
