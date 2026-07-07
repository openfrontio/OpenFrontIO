import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { translateText } from "../../../client/Utils";
import { EventBus } from "../../../core/EventBus";
import { ClientEnv } from "../../ClientEnv";
import { Controller } from "../../Controller";
import { NewLobbyEvent } from "../../Transport";
import { GameView } from "../../view";

// Shown to non-host players when the host reuses the private lobby for another
// game. It reacts to NewLobbyEvent (fired when the server broadcasts the
// successor's id) so it works even after the win modal has been dismissed and
// the player is spectating. The host is sent straight to the host view instead.
@customElement("new-lobby-prompt")
export class NewLobbyPrompt extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;

  @state()
  private isVisible = false;

  private gameID: string | null = null;

  // Override to prevent shadow DOM creation (so Tailwind classes apply).
  createRenderRoot() {
    return this;
  }

  init() {
    this.eventBus.on(NewLobbyEvent, (e) => this.onNewLobby(e));
  }

  private onNewLobby(event: NewLobbyEvent) {
    this.gameID = event.gameID;
    // The host asked for this lobby, so send them back to the host view. The
    // ?host flag routes them there instead of the join flow on reload.
    if (this.game?.myPlayer()?.isLobbyCreator()) {
      window.location.href = this.lobbyUrl(true);
      return;
    }
    this.isVisible = true;
    this.requestUpdate();
  }

  private lobbyUrl(asHost: boolean): string {
    const id = this.gameID ?? "";
    const url = `${window.location.origin}/${ClientEnv.workerPath(id)}/game/${id}`;
    return asHost ? `${url}?host` : url;
  }

  private _handleJoin() {
    if (this.gameID === null) {
      return;
    }
    window.location.href = this.lobbyUrl(false);
  }

  private _handleDismiss() {
    this.isVisible = false;
    this.requestUpdate();
  }

  render() {
    if (!this.isVisible) {
      return html``;
    }
    return html`
      <div
        class="fixed top-4 left-1/2 -translate-x-1/2 z-[10010] flex items-center gap-3 bg-gray-800/90 text-white px-4 py-3 rounded-lg shadow-2xl backdrop-blur-xs max-w-[90%]"
      >
        <span>${translateText("new_lobby_prompt.message")}</span>
        <o-button
          variant="primary"
          translationKey="new_lobby_prompt.join"
          @click=${this._handleJoin}
        ></o-button>
        <button
          class="text-white/70 hover:text-white text-xl leading-none px-1"
          aria-label=${translateText("new_lobby_prompt.dismiss")}
          @click=${this._handleDismiss}
        >
          ✕
        </button>
      </div>
    `;
  }
}
