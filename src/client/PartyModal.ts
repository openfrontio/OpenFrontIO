import { html, LitElement } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { getServerConfigFromClient } from "../core/configuration/ConfigLoader";
import { generateCryptoRandomUUID, translateText } from "./Utils";
import "./components/baseComponents/Modal";

interface PartyMember {
  persistentID: string;
  username: string;
  joinedAt: number;
}

interface PartyInfo {
  code: string;
  members: PartyMember[];
  leaderPersistentID: string;
}

@customElement("party-modal")
export class PartyModal extends LitElement {
  @state() private party: PartyInfo | null = null;
  @state() private partyCode: string = "";
  @state() private errorMessage: string = "";
  @state() private isLoading: boolean = false;
  @state() private pollInterval: ReturnType<typeof setInterval> | null = null;

  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };

  private persistentID: string;
  private username: string;

  constructor() {
    super();
    this.persistentID = this.getPersistentID();
    this.username = this.getUsername();
  }

  createRenderRoot() {
    return this;
  }

  private getPersistentID(): string {
    const COOKIE_NAME = "player_persistent_id";
    const cookies = document.cookie.split(";");
    for (const cookie of cookies) {
      const [cookieName, cookieValue] = cookie.split("=").map((c) => c.trim());
      if (cookieName === COOKIE_NAME) {
        return cookieValue;
      }
    }
    return generateCryptoRandomUUID();
  }

  private getUsername(): string {
    const usernameInput = document.querySelector("username-input") as any;
    if (
      usernameInput &&
      typeof usernameInput.getCurrentUsername === "function"
    ) {
      return usernameInput.getCurrentUsername();
    }
    // Fallback to localStorage if component not ready
    const storedUsername = localStorage.getItem("username");
    return storedUsername ?? "Player";
  }

  render() {
    return html`
      <o-modal id="party-modal" translationKey="party_modal.title">
        <div class="space-y-4">
          ${this.party ? this.renderPartyView() : this.renderJoinCreate()}
        </div>
      </o-modal>
    `;
  }

  private renderPartyView() {
    return html`
      <div class="bg-gray-800 rounded-lg p-4">
        <div class="flex justify-between items-center mb-4">
          <h3 class="text-xl font-bold text-white">
            ${translateText("party_modal.party_code")}
          </h3>
          <button
            @click=${this.copyPartyCode}
            class="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm"
          >
            ${translateText("party_modal.copy_code")}
          </button>
        </div>
        <div
          class="text-3xl font-mono font-bold text-center text-blue-400 bg-gray-900 rounded p-3 mb-4"
        >
          ${this.party!.code}
        </div>

        <h4 class="text-lg font-semibold text-white mb-2">
          ${translateText("party_modal.members")}
          (${this.party!.members.length}/4)
        </h4>
        <div class="space-y-2">
          ${this.party!.members.map(
            (member) => html`
              <div
                class="flex items-center justify-between bg-gray-700 rounded p-2"
              >
                <span class="text-white">
                  ${member.username}
                  ${member.persistentID === this.party!.leaderPersistentID
                    ? html`<span class="text-yellow-400 ml-2">👑</span>`
                    : ""}
                </span>
              </div>
            `,
          )}
        </div>

        <button
          @click=${this.leaveParty}
          class="w-full mt-4 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded font-semibold"
        >
          ${translateText("party_modal.leave_party")}
        </button>
      </div>
    `;
  }

  private renderJoinCreate() {
    return html`
      <div class="space-y-4">
        <div>
          <label class="block text-white font-semibold mb-2">
            ${translateText("party_modal.join_party")}
          </label>
          <div class="flex gap-2">
            <input
              type="text"
              .value=${this.partyCode}
              @input=${(e: Event) =>
                (this.partyCode = (
                  e.target as HTMLInputElement
                ).value.toUpperCase())}
              placeholder="${translateText("party_modal.enter_code")}"
              maxlength="6"
              class="flex-1 px-3 py-2 bg-gray-700 text-white rounded border border-gray-600 focus:border-blue-500 focus:outline-none uppercase font-mono"
            />
            <button
              @click=${this.joinParty}
              ?disabled=${this.isLoading || this.partyCode.length !== 6}
              class="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white rounded font-semibold"
            >
              ${translateText("party_modal.join_party")}
            </button>
          </div>
        </div>

        <div class="text-center text-gray-400">
          ${translateText("party_modal.or")}
        </div>

        <button
          @click=${this.createParty}
          ?disabled=${this.isLoading}
          class="w-full px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white rounded font-semibold"
        >
          ${translateText("party_modal.create_party")}
        </button>

        ${this.errorMessage
          ? html`<div class="text-red-400 text-sm">${this.errorMessage}</div>`
          : ""}
      </div>
    `;
  }

  private async createParty() {
    this.isLoading = true;
    this.errorMessage = "";
    this.username = this.getUsername();

    try {
      const config = await getServerConfigFromClient();
      const response = await fetch(
        `/${config.workerPath("party")}/api/party/create`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            persistentID: this.persistentID,
            username: this.username,
          }),
        },
      );

      if (!response.ok) {
        throw new Error("Failed to create party");
      }

      const data = await response.json();
      this.party = data;
      this.startPolling();
      this.dispatchPartyEvent();
    } catch (error) {
      this.errorMessage = "Failed to create party. Please try again.";
      console.error("Error creating party:", error);
    } finally {
      this.isLoading = false;
    }
  }

  private async joinParty() {
    this.isLoading = true;
    this.errorMessage = "";
    this.username = this.getUsername();

    try {
      const config = await getServerConfigFromClient();
      const response = await fetch(
        `/${config.workerPath("party")}/api/party/join`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: this.partyCode.toUpperCase(),
            persistentID: this.persistentID,
            username: this.username,
          }),
        },
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error ?? "Failed to join party");
      }

      const data = await response.json();
      this.party = data;
      this.partyCode = "";
      this.startPolling();
      this.dispatchPartyEvent();
    } catch (error: any) {
      this.errorMessage = error.message ?? "Failed to join party.";
      console.error("Error joining party:", error);
    } finally {
      this.isLoading = false;
    }
  }

  private async leaveParty() {
    try {
      const config = await getServerConfigFromClient();
      await fetch(`/${config.workerPath("party")}/api/party/leave`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ persistentID: this.persistentID }),
      });

      this.party = null;
      this.stopPolling();
      this.dispatchPartyEvent();
    } catch (error) {
      console.error("Error leaving party:", error);
    }
  }

  private copyPartyCode() {
    if (this.party) {
      navigator.clipboard.writeText(this.party.code);
    }
  }

  private startPolling() {
    this.stopPolling();
    this.pollInterval = setInterval(() => this.pollParty(), 2000);
  }

  private stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  private async pollParty() {
    if (!this.party) return;

    try {
      const config = await getServerConfigFromClient();
      const response = await fetch(
        `/${config.workerPath("party")}/api/party/${this.party.code}`,
      );

      if (!response.ok) {
        // Party no longer exists
        this.party = null;
        this.stopPolling();
        this.dispatchPartyEvent();
        return;
      }

      const data = await response.json();
      this.party = data;
      this.dispatchPartyEvent();
    } catch (error) {
      console.error("Error polling party:", error);
    }
  }

  private dispatchPartyEvent() {
    this.dispatchEvent(
      new CustomEvent("party-changed", {
        detail: { party: this.party },
        bubbles: true,
        composed: true,
      }),
    );
  }

  public async open() {
    this.username = this.getUsername();
    await this.updateComplete; // Wait for render to complete
    if (!this.modalEl) {
      console.error("Modal element not found!");
      return;
    }
    await this.checkExistingParty();
    this.modalEl.open();
  }

  public close() {
    this.modalEl?.close();
    this.stopPolling();
  }

  private async checkExistingParty() {
    try {
      const config = await getServerConfigFromClient();
      const response = await fetch(
        `/${config.workerPath("party")}/api/party/member/${this.persistentID}`,
      );

      if (response.ok) {
        const data = await response.json();
        if (data.inParty) {
          this.party = data;
          this.startPolling();
        }
      }
    } catch (error) {
      console.error("Error checking existing party:", error);
    }
  }

  public getParty(): PartyInfo | null {
    return this.party;
  }

  public getPartyMemberIDs(): string[] {
    if (!this.party) {
      return [this.persistentID];
    }
    return this.party.members.map((m) => m.persistentID);
  }
}
