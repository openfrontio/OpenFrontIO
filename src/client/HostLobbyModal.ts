import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { Difficulty, GameMap, GameType } from '../core/game/Game';
import { Lobby } from '../core/Schemas';
import { consolex } from '../core/Consolex';

@customElement('host-lobby-modal')
export class HostLobbyModal extends LitElement {
  @state() private isModalOpen = false;
  @state() private selectedMap: GameMap = GameMap.World;
  @state() private selectedDiffculty: Difficulty = Difficulty.Medium;
  @state() private lobbyId = '';
  @state() private copySuccess = false;
  @state() private players: string[] = []

  private playersInterval = null

  static styles = css`
    .modal-overlay {
      display: none;
      position: fixed;
      z-index: 1000;
      left: 0;
      top: 0;
      width: 100%;
      height: 100%;
      background-color: rgba(0, 0, 0, 0.5);
    }

    .modal-content {
      background-color: white;
      margin: 15% auto;
      padding: 20px;
      border-radius: 8px;
      width: 80%;
      max-width: 500px;
      text-align: center;
    }

    .close {
      color: #aaa;
      float: right;
      font-size: 28px;
      font-weight: bold;
      cursor: pointer;
    }

    .close:hover,
    .close:focus {
      color: black;
      text-decoration: none;
      cursor: pointer;
    }

    button {
      padding: 10px 20px;
      font-size: 16px;
      cursor: pointer;
      background-color: #007bff;
      color: white;
      border: none;
      border-radius: 4px;
      transition: background-color 0.3s;
      display: inline-block;
      margin-top: 20px;
    }

    button:hover {
      background-color: #0056b3;
    }

    select {
      padding: 8px;
      font-size: 16px;
      margin-top: 10px;
      width: 200px;
    }

    .lobby-id-container {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
    }

    .clipboard-icon {
      cursor: pointer;
      transition: opacity 0.3s;
    }

    .clipboard-icon:hover {
      opacity: 0.7;
    }

    .copy-success {
      color: green;
      font-size: 14px;
      margin-top: 5px;
    }
  `;

  render() {
    return html`
      <div class="modal-overlay" style="display: ${this.isModalOpen ? 'block' : 'none'}">
        <div class="modal-content">
          <span class="close" @click=${this.close}>&times;</span>
          <h2>Private Lobby</h2>
          <div class="lobby-id-container">
            <h3>Lobby ID: ${this.lobbyId}</h3>
            <svg @click=${this.copyToClipboard} class="clipboard-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
              <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
            </svg>
          </div>
          ${this.copySuccess ? html`<p class="copy-success">Copied to clipboard!</p>` : ''}
          <div>
            <label for="map-select">Map: </label>
            <select id="map-select" @change=${this.handleMapChange}>
              ${Object.entries(GameMap)
        .filter(([key]) => isNaN(Number(key)))
        .map(([key, value]) => html`
                  <option value=${value} ?selected=${this.selectedMap === value}>
                    ${key}
                  </option>
                `)}
            </select>
          </div>
          <div>
            <label for="map-select">Difficulty: </label>
            <select id="map-select" @change=${this.handleDifficultyChange}>
              ${Object.entries(Difficulty)
        .filter(([key]) => isNaN(Number(key)))
        .map(([key, value]) => html`
                  <option value=${value} ?selected=${this.selectedDiffculty === value}>
                    ${key}
                  </option>
                `)}
            </select>
          </div>
          <button @click=${this.startGame}>Start Game</button>
        <div>
        <p>Players: ${this.players.join(", ")}<p>
        </div>
        </div>
      </div>
    `;
  }

  public open() {
    createLobby().then((lobby) => {
      this.lobbyId = lobby.id
      // join lobby
    }).then(() => {
      this.dispatchEvent(new CustomEvent('join-lobby', {
        detail: {
          gameType: GameType.Private,
          lobby: {
            id: this.lobbyId,
          },
          map: this.selectedMap,
          difficulty: this.selectedDiffculty,
        },
        bubbles: true,
        composed: true
      }));

    })
    this.isModalOpen = true;
    this.playersInterval = setInterval(() => this.pollPlayers(), 1000)
  }

  public close() {
    this.isModalOpen = false;
    this.copySuccess = false;
    if (this.playersInterval) {
      clearInterval(this.playersInterval)
      this.playersInterval = null
    }
  }

  private async handleMapChange(e: Event) {
    this.selectedMap = String((e.target as HTMLSelectElement).value) as GameMap;
    consolex.log(`updating map to ${this.selectedMap}`)
    this.putGameConfig()
  }

  private async handleDifficultyChange(e: Event) {
    this.selectedDiffculty = String((e.target as HTMLSelectElement).value) as Difficulty;
    consolex.log(`updating difficulty to ${this.selectedDiffculty}`)
    this.putGameConfig()
  }

  private async putGameConfig() {
    const response = await fetch(`/private_lobby/${this.lobbyId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ gameMap: this.selectedMap, difficulty: this.selectedDiffculty })
    });
  }

  private async startGame() {
    consolex.log(`Starting private game with map: ${GameMap[this.selectedMap]}`);
    this.close();
    const response = await fetch(`/start_private_lobby/${this.lobbyId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      }
    });
  }

  private async copyToClipboard() {
    try {
      await navigator.clipboard.writeText(this.lobbyId);
      this.copySuccess = true;
      setTimeout(() => {
        this.copySuccess = false;
      }, 2000);
    } catch (err) {
      consolex.error('Failed to copy text: ', err);
    }
  }

  private async pollPlayers() {
    fetch(`/lobby/${this.lobbyId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      }
    }).then(response => response.json())
      .then(data => {
        console.log(`got response: ${data}`)
        this.players = data.players.map(p => p.username)
      })
  }
}


async function createLobby(): Promise<Lobby> {
  try {
    const response = await fetch('/private_lobby', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      // body: JSON.stringify(data), // Include this if you need to send data
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    consolex.log('Success:', data);

    // Assuming the server returns an object with an 'id' property
    const lobby: Lobby = {
      id: data.id,
      // Add other properties as needed
    };

    return lobby;
  } catch (error) {
    consolex.error('Error creating lobby:', error);
    throw error; // Re-throw the error so the caller can handle it
  }
}