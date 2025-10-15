import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { GameMapType } from "../core/game/Game";
import { GameID, GameInfo } from "../core/Schemas";
import { generateID } from "../core/Util";
import "./components/LobbyCard";
import { JoinLobbyEvent } from "./Main";
import { terrainMapFileLoader } from "./TerrainMapFileLoader";

@customElement("public-lobby")
export class PublicLobby extends LitElement {
  @state() private lobbies: GameInfo[] = [];
  @state() public isLobbyHighlighted: boolean = false;
  @state() private isButtonDebounced: boolean = false;
  @state() private mapImages: Map<GameID, string> = new Map();
  private lobbiesInterval: number | null = null;
  private currLobby: GameInfo | null = null;
  private debounceDelay: number = 750;
  private lobbyIDToStart = new Map<GameID, number>();
  private lobbyIDToCurrentMap = new Map<GameID, string>();

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.fetchAndUpdateLobbies();
    this.lobbiesInterval = window.setInterval(
      () => this.fetchAndUpdateLobbies(),
      1000,
    );
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
      this.lobbies = await this.fetchLobbies();
      this.lobbies.forEach((l) => {
        // Store the start time on first fetch because endpoint is cached, causing
        // the time to appear irregular.
        if (!this.lobbyIDToStart.has(l.gameID)) {
          const msUntilStart = l.msUntilStart ?? 0;
          this.lobbyIDToStart.set(l.gameID, msUntilStart + Date.now());
        }

        // Load map image if not already loaded or if map has changed
        if (l.gameConfig) {
          const currentMap = this.lobbyIDToCurrentMap.get(l.gameID);
          if (currentMap !== l.gameConfig.gameMap) {
            // Map has changed or not loaded yet, reload the image
            this.loadMapImage(l.gameID, l.gameConfig.gameMap);
            this.lobbyIDToCurrentMap.set(l.gameID, l.gameConfig.gameMap);
          }
        }
      });
    } catch (error) {
      console.error("Error fetching lobbies:", error);
    }
  }

  private async loadMapImage(gameID: GameID, gameMap: string) {
    try {
      // Convert string to GameMapType enum value
      const mapType = gameMap as GameMapType;
      const data = terrainMapFileLoader.getMapData(mapType);
      this.mapImages.set(gameID, await data.webpPath());
      this.requestUpdate();
    } catch (error) {
      console.error("Failed to load map image:", error);
    }
  }

  async fetchLobbies(): Promise<GameInfo[]> {
    try {
      const response = await fetch(`/api/public_lobbies`);
      if (!response.ok)
        throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();
      return data.lobbies;
    } catch (error) {
      console.error("Error fetching lobbies:", error);
      throw error;
    }
  }

  public stop() {
    if (this.lobbiesInterval !== null) {
      this.isLobbyHighlighted = false;
      clearInterval(this.lobbiesInterval);
      this.lobbiesInterval = null;
    }
  }

  render() {
    if (this.lobbies.length === 0) return html``;

    const lobby = this.lobbies[0];
    if (!lobby?.gameConfig) {
      return;
    }
    const start = this.lobbyIDToStart.get(lobby.gameID) ?? 0;
    const timeRemaining = Math.max(0, Math.floor((start - Date.now()) / 1000));

    const mapImageSrc = this.mapImages.get(lobby.gameID);

    return html`
      <lobby-card
        .gameConfig=${lobby.gameConfig}
        .mapImageSrc=${mapImageSrc}
        .highlighted=${this.isLobbyHighlighted}
        .interactive=${true}
        .showCta=${true}
        .showPlayerCount=${true}
        .showTimer=${true}
        .showDifficulty=${false}
        .numClients=${lobby.numClients}
        .maxPlayers=${lobby.gameConfig.maxPlayers}
        .timeRemaining=${timeRemaining}
        .debounced=${this.isButtonDebounced}
        @card-click=${() => this.lobbyClicked(lobby)}
      ></lobby-card>
    `;
  }

  leaveLobby() {
    this.isLobbyHighlighted = false;
    this.currLobby = null;
  }

  private lobbyClicked(lobby: GameInfo) {
    if (this.isButtonDebounced) {
      return;
    }

    // Set debounce state
    this.isButtonDebounced = true;

    // Reset debounce after delay
    setTimeout(() => {
      this.isButtonDebounced = false;
    }, this.debounceDelay);

    if (this.currLobby === null) {
      this.isLobbyHighlighted = true;
      this.currLobby = lobby;
      this.dispatchEvent(
        new CustomEvent("join-lobby", {
          detail: {
            gameID: lobby.gameID,
            clientID: generateID(),
          } as JoinLobbyEvent,
          bubbles: true,
          composed: true,
        }),
      );
    } else {
      this.dispatchEvent(
        new CustomEvent("leave-lobby", {
          detail: { lobby: this.currLobby },
          bubbles: true,
          composed: true,
        }),
      );
      this.leaveLobby();
    }
  }
}
