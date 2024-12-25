import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { Lobby } from "../core/Schemas";
import { Difficulty, GameMap, GameType } from '../core/game/Game';
import { consolex } from '../core/Consolex';

@customElement('public-lobby')
export class PublicLobby extends LitElement {
    @state() private lobbies: Lobby[] = [];
    @state() private isLobbyHighlighted: boolean = false;
    private lobbiesInterval: number | null = null;

    private currLobby: Lobby = null

    static styles = css`
    /* Add your styles here, based on your existing CSS */
    .lobby-button {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      width: 100%;
      max-width: 20rem;
      margin: 0 auto;
      padding: 1.5rem 2rem;
      background-color: #2563eb;
      color: white;
      font-weight: bold;
      border-radius: 0.5rem;
      transition: background-color 0.3s ease-in-out;
    }

    .lobby-button:hover {
      background-color: #1d4ed8;
    }

    .lobby-button.highlighted {
      background-color: #16a34a;
    }

    .lobby-button.highlighted:hover {
      background-color: #15803d;
    }

    .lobby-name { font-size: 1.5rem; }
    .lobby-timer { font-size: 1.25rem; }
    .player-count { font-size: 1rem; }
  `;

    connectedCallback() {
        super.connectedCallback();
        this.fetchAndUpdateLobbies(); // Fetch immediately on start
        this.lobbiesInterval = window.setInterval(() => this.fetchAndUpdateLobbies(), 1000);
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        if (this.lobbiesInterval !== null) {
            clearInterval(this.lobbiesInterval);
            this.lobbiesInterval = null;
        }
    }

    private async fetchAndUpdateLobbies(): Promise<void> {
        try {
            const lobbies = await this.fetchLobbies();
            this.lobbies = lobbies;
        } catch (error) {
            consolex.error('Error fetching and updating lobbies:', error);
        }
    }

    async fetchLobbies(): Promise<Lobby[]> {
        const url = '/lobbies';
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            return data.lobbies;
        } catch (error) {
            consolex.error('Error fetching lobbies:', error);
            throw error;
        }
    }

    render() {
        if (this.lobbies.length === 0) {
            return html``;
        }

        const lobby = this.lobbies[0];
        const timeRemaining = Math.max(0, Math.floor(lobby.msUntilStart / 1000));

        return html`
      <button
        @click=${() => this.lobbyClicked(lobby)}
        class="lobby-button ${this.isLobbyHighlighted ? 'highlighted' : ''}"
      >
        <div class="lobby-name">Game ${lobby.id}</div>
        <div class="lobby-timer">Starts in: ${timeRemaining}s</div>
        <div class="player-count">Players: ${lobby.numClients}</div>
      </button>
    `;
    }
    highlightLobby() {
        this.isLobbyHighlighted = !this.isLobbyHighlighted;
        this.requestUpdate();
    }


    private lobbyClicked(lobby: Lobby) {
        if (this.currLobby == null) {
            this.currLobby = lobby
            this.dispatchEvent(new CustomEvent('join-lobby', {
                detail: {
                    lobby: lobby,
                    gameType: GameType.Public,
                    map: GameMap.World,
                    difficulty: Difficulty.Medium,
                },
                bubbles: true,
                composed: true
            }));
        } else {
            this.dispatchEvent(new CustomEvent('leave-lobby', {
                detail: { lobby: this.currLobby },
                bubbles: true,
                composed: true
            }));
            this.currLobby = null
        }
    }
}
