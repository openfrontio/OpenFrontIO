import { html, LitElement } from "lit";
import { customElement, query } from "lit/decorators.js";
import { getServerConfigFromClient } from "../core/configuration/ConfigLoader";
import "./components/Difficulties";
import "./components/PatternButton";
import { translateText } from "./Utils";

@customElement("matchmaking-modal")
export class MatchmakingModal extends LitElement {
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
        title="${translateText("matchmaking_modal.title") || "Matchmaking"}"
      >
        ${this.renderInner()}
      </o-modal>
    `;
  }

  private renderInner() {
    return html``;
  }

  public async open() {
    this.modalEl?.open();
    this.requestUpdate();
    this.connect();
  }

  private async connect() {
    const config = await getServerConfigFromClient();

    // Add userId and username as query params
    const userId = "your-user-id"; // Get this from your auth/user context
    const username = "your-username"; // Get this from your auth/user context

    const url = `${config.jwtIssuer() + "/lobby/join"}?userId=${encodeURIComponent(userId)}&username=${encodeURIComponent(username)}`;

    const socket = new WebSocket(url);
    socket.onopen = () => {
      console.log("Connected to matchmaking server");
    };
    socket.onmessage = (event) => {
      console.log(event.data);
    };
  }

  public close() {
    this.modalEl?.close();
  }
}

@customElement("matchmaking-button")
export class MatchmakingButton extends LitElement {
  private isVisible = true;

  @query("matchmaking-modal") private matchmakingModal: MatchmakingModal;

  constructor() {
    super();
  }

  createRenderRoot() {
    return this;
  }

  render() {
    if (!this.isVisible) {
      return html``;
    }

    return html`
      <div class="z-[9999]">
        <button
          @click="${this.open}"
          class="w-12 h-12 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-2xl hover:shadow-3xl transition-all duration-200 flex items-center justify-center text-xl focus:outline-none focus:ring-4 focus:ring-blue-500 focus:ring-offset-4"
          title="Test"
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
    this.isVisible = false;
    this.matchmakingModal?.close();
    this.requestUpdate();
  }
}
