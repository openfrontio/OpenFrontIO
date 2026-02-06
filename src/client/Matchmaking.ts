import { html, LitElement } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { getServerConfigFromClient } from "../core/configuration/ConfigLoader";
import { generateID } from "../core/Util";
import "./components/Difficulties";
import "./components/PatternButton";
import { getPlayToken, JoinLobbyEvent } from "./Main";
import { translateText } from "./Utils";

@customElement("matchmaking-modal")
export class MatchmakingModal extends LitElement {
  private gameCheckInterval: ReturnType<typeof setInterval> | null = null;
  private connected = false;
  @state() private socket: WebSocket | null = null;

  @state() private gameID: string | null = null;
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };

  constructor() {
    super();
  }

  createRenderRoot() {
    return this;
  }

  render() {
    return html`
      <o-modal
        id="matchmaking-modal"
        title="${translateText("matchmaking_modal.title")}"
      >
        ${this.renderInner()}
      </o-modal>
    `;
  }

  private renderInner() {
    if (!this.connected) {
      return html`${translateText("matchmaking_modal.connecting")}`;
    }
    if (this.gameID === null) {
      return html`${translateText("matchmaking_modal.searching")}`;
    } else {
      return html`${translateText("matchmaking_modal.waiting_for_game")}`;
    }
  }

  private async connect() {
    const config = await getServerConfigFromClient();

    this.socket = new WebSocket(`${config.jwtIssuer()}/matchmaking/join`);
    this.socket.onopen = () => {
      console.log("Connected to matchmaking server");
      setTimeout(() => {
        // Set a delay so the user can see the "connecting" message,
        // otherwise the "searching" message will be shown immediately.
        this.connected = true;
        this.requestUpdate();
      }, 1000);

      // Get party info if in a party
      const partyModal = document.querySelector("party-modal") as any;
      const party = partyModal?.getParty();

      // Notify server that party leader is queueing
      if (party) {
        this.notifyPartyQueueStart();
      }

      this.socket?.send(
        JSON.stringify({
          type: "auth",
          playToken: getPlayToken(),
          partyCode: party?.code,
        }),
      );
    };
    this.socket.onmessage = (event) => {
      console.log(event.data);
      const data = JSON.parse(event.data);
      if (data.type === "match-assignment") {
        this.socket?.close();
        console.log(`matchmaking: got game ID: ${data.gameId}`);
        this.gameID = data.gameId;
      }
    };
    this.socket.onerror = (event: ErrorEvent) => {
      console.error("WebSocket error occurred:", event);
    };
    this.socket.onclose = (event) => {
      console.log("Matchmaking server closed connection");
    };
  }

  public close() {
    this.connected = false;
    this.socket?.close();
    this.modalEl?.close();
    if (this.gameCheckInterval) {
      clearInterval(this.gameCheckInterval);
      this.gameCheckInterval = null;
    }

    // Notify server that party stopped queueing
    this.notifyPartyQueueStop();
  }

  private async notifyPartyQueueStart() {
    try {
      const config = await getServerConfigFromClient();
      const persistentID = this.getPersistentID();

      await fetch(`/${config.workerPath("0")}/api/party/queue/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ persistentID }),
      });
    } catch (error) {
      console.error("Error notifying party queue start:", error);
    }
  }

  private async notifyPartyQueueStop() {
    try {
      const config = await getServerConfigFromClient();
      const persistentID = this.getPersistentID();

      await fetch(`/${config.workerPath("0")}/api/party/queue/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ persistentID }),
      });
    } catch (error) {
      console.error("Error notifying party queue stop:", error);
    }
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
    return "";
  }

  public async open() {
    this.modalEl?.open();
    this.requestUpdate();
    this.connect();
    this.gameCheckInterval = setInterval(() => this.checkGame(), 3000);
  }

  private async checkGame() {
    if (this.gameID === null) {
      return;
    }
    const config = await getServerConfigFromClient();
    const url = `/${config.workerPath(this.gameID)}/api/game/${this.gameID}/exists`;

    const response = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    const gameInfo = await response.json();

    if (response.status !== 200) {
      console.error(`Error checking game ${this.gameID}: ${response.status}`);
      return;
    }

    if (!gameInfo.exists) {
      console.info(`Game ${this.gameID} does not exist or hasn't started yet`);
      return;
    }

    if (this.gameCheckInterval) {
      clearInterval(this.gameCheckInterval);
      this.gameCheckInterval = null;
    }

    this.dispatchEvent(
      new CustomEvent("join-lobby", {
        detail: {
          gameID: this.gameID,
          clientID: generateID(),
        } as JoinLobbyEvent,
        bubbles: true,
        composed: true,
      }),
    );
  }
}

@customElement("matchmaking-button")
export class MatchmakingButton extends LitElement {
  @query("matchmaking-modal") private matchmakingModal: MatchmakingModal;
  @state() private matchmakingEnabled = false;

  constructor() {
    super();
  }

  async connectedCallback() {
    super.connectedCallback();
    const config = await getServerConfigFromClient();
    this.matchmakingEnabled = config.enableMatchmaking();
  }

  createRenderRoot() {
    return this;
  }

  render() {
    if (!this.matchmakingEnabled) {
      return html``;
    }

    return html`
      <div class="z-[9999]">
        <button
          @click="${this.open}"
          class="w-full h-16 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-2xl hover:shadow-3xl transition-all duration-200 flex items-center justify-center text-xl focus:outline-none focus:ring-4 focus:ring-blue-500 focus:ring-offset-4"
          title="${translateText("matchmaking_modal.title")}"
        >
          Matchmaking
        </button>
      </div>
      <matchmaking-modal></matchmaking-modal>
    `;
  }

  private open() {
    this.matchmakingModal?.open();
  }

  public close() {
    this.matchmakingModal?.close();
    this.requestUpdate();
  }
}
