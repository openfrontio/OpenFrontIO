import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";

export interface RankedMatchModalOptions {
  matchId: string;
  ticketId: string;
  acceptToken: string;
  acceptDeadline: number;
  accepted: boolean;
  acceptedCount: number;
  totalPlayers: number;
}

export interface RankedMatchAcceptDetail {
  matchId: string;
  ticketId: string;
  acceptToken: string;
}

export interface RankedMatchDeclineDetail {
  matchId: string;
  ticketId: string;
}

@customElement("ranked-match-modal")
export class RankedMatchModal extends LitElement {
  @state() private isOpen = false;
  @state() private secondsRemaining = 0;
  @state() private accepted = false;
  @state() private acceptedCount = 0;
  @state() private totalPlayers = 0;

  private matchId = "";
  private ticketId = "";
  private acceptToken = "";
  private deadline = 0;
  private countdownHandle: number | null = null;

  createRenderRoot() {
    return this;
  }

  disconnectedCallback(): void {
    this.clearCountdown();
    super.disconnectedCallback();
  }

  showMatch(options: RankedMatchModalOptions): void {
    if (
      this.isOpen &&
      this.matchId === options.matchId &&
      this.ticketId === options.ticketId &&
      this.acceptToken === options.acceptToken
    ) {
      this.deadline = options.acceptDeadline;
      this.accepted = options.accepted;
      this.acceptedCount = options.acceptedCount;
      this.totalPlayers = options.totalPlayers;
      this.tickCountdown();
      return;
    }

    this.matchId = options.matchId;
    this.ticketId = options.ticketId;
    this.acceptToken = options.acceptToken;
    this.deadline = options.acceptDeadline;
    this.accepted = options.accepted;
    this.acceptedCount = options.acceptedCount;
    this.totalPlayers = options.totalPlayers;
    this.isOpen = true;
    this.startCountdown();
  }

  markAccepted(): void {
    if (!this.isOpen) {
      return;
    }
    this.accepted = true;
    this.requestUpdate();
  }

  close(): void {
    if (!this.isOpen) {
      return;
    }
    this.isOpen = false;
    this.matchId = "";
    this.ticketId = "";
    this.acceptToken = "";
    this.accepted = false;
    this.acceptedCount = 0;
    this.totalPlayers = 0;
    this.clearCountdown();
    this.requestUpdate();
  }

  private startCountdown(): void {
    this.clearCountdown();
    this.tickCountdown();
    this.countdownHandle = window.setInterval(() => this.tickCountdown(), 1000);
  }

  private clearCountdown(): void {
    if (this.countdownHandle !== null) {
      window.clearInterval(this.countdownHandle);
      this.countdownHandle = null;
    }
  }

  private tickCountdown(): void {
    const remainingMs = this.deadline - Date.now();
    this.secondsRemaining = Math.max(0, Math.ceil(remainingMs / 1000));
    if (this.secondsRemaining === 0) {
      this.clearCountdown();
    }
    this.requestUpdate();
  }

  private handleAccept(): void {
    if (this.accepted || !this.isOpen) {
      return;
    }
    const detail: RankedMatchAcceptDetail = {
      matchId: this.matchId,
      ticketId: this.ticketId,
      acceptToken: this.acceptToken,
    };
    this.dispatchEvent(
      new CustomEvent<RankedMatchAcceptDetail>("ranked-match-accept", {
        detail,
        bubbles: true,
        composed: true,
      }),
    );
  }

  private handleDecline(): void {
    if (!this.isOpen) {
      return;
    }
    const detail: RankedMatchDeclineDetail = {
      matchId: this.matchId,
      ticketId: this.ticketId,
    };
    this.dispatchEvent(
      new CustomEvent<RankedMatchDeclineDetail>("ranked-match-decline", {
        detail,
        bubbles: true,
        composed: true,
      }),
    );
  }

  render() {
    if (!this.isOpen) {
      return html``;
    }

    return html`
      <div
        class="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      >
        <div
          class="w-[90%] max-w-sm rounded-xl bg-slate-900 p-6 text-white shadow-xl"
        >
          <h2 class="mb-4 text-2xl font-semibold text-center">
            Ranked Match Found
          </h2>
          <p class="mb-2 text-center">
            ${this.accepted
              ? "Waiting for other players to accept..."
              : "Accept the match to begin the game."}
          </p>
          <p class="mb-2 text-center text-sm text-slate-300">
            Accepted: ${this.acceptedCount}/${this.totalPlayers}
          </p>
          <p class="mb-4 text-center text-sm text-slate-300">
            Time remaining:
            <span class="font-semibold">${this.secondsRemaining}s</span>
          </p>
          <div class="flex flex-col gap-3 sm:flex-row">
            <button
              class="flex-1 rounded-lg border border-red-500 px-3 py-2 text-red-300 transition-colors hover:bg-red-500/10"
              @click=${this.handleDecline}
            >
              Decline
            </button>
            <button
              class="flex-1 rounded-lg border border-emerald-500 px-3 py-2 text-emerald-200 transition-colors hover:bg-emerald-500/10 disabled:opacity-60"
              @click=${this.handleAccept}
              ?disabled=${this.accepted || !this.acceptToken}
            >
              ${this.accepted ? "Accepted" : "Accept"}
            </button>
          </div>
        </div>
      </div>
    `;
  }
}
