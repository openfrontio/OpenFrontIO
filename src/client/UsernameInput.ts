import {LitElement, html, css} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {v4 as uuidv4} from 'uuid';
import {MAX_USERNAME_LENGTH} from "../core/Util";

const usernameKey: string = 'username';

@customElement('username-input')
export class UsernameInput extends LitElement {
    @state() private username: string = '';
    @property({ type: String }) validationError: string = '';

    static styles = css`
        input {
            width: 100%;
            padding: 0.75rem;
            background-color: white;
            border: 1px solid #d1d5db;
            border-radius: 0.375rem;
            box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
            font-size: 1rem;
            line-height: 1.5;
            color: #111827;
        }

        input:focus {
            outline: none;
            ring: 2px;
            ring-color: #3b82f6;
            border-color: #3b82f6;
        }

        .error {
            color: #dc2626;
            background-color: #fff;
            padding: 4px;
            font-size: 0.875rem;
            border: 1px solid #dc2626;
            margin-top: 0.5rem;
        }
    `;

    public getCurrentUsername(): string {
        return this.username;
    }

    connectedCallback() {
        super.connectedCallback();
        this.username = this.getStoredUsername();
        this.dispatchUsernameEvent()
    }

    render() {
        return html`
        <input 
          type="text" 
          .value=${this.username}
          @input=${this.handleInput}
          placeholder="Enter your username"
          maxlength="123"
        >
        ${this.validationError
            ? html`<div class="error">${this.validationError}</div>`
            : null}
    `;
    }

    private handleInput(e: Event) {
        const input = e.target as HTMLInputElement;
        this.username = input.value.trim();
        this.storeUsername(this.username);
        this.validationError = '';
        this.dispatchUsernameEvent();
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
        this.dispatchEvent(new CustomEvent('username-change', {
            detail: {username: this.username},
            bubbles: true,
            composed: true
        }));
    }

    private generateNewUsername(): string {
        const newUsername = "Anon" + this.uuidToThreeDigits();
        this.storeUsername(newUsername);
        return newUsername;
    }

    private uuidToThreeDigits(): string {
        const uuid = uuidv4();
        const cleanUuid = uuid.replace(/-/g, '').toLowerCase();
        const decimal = BigInt(`0x${cleanUuid}`);
        const threeDigits = decimal % 1000n;
        return threeDigits.toString().padStart(3, '0');
    }
}
