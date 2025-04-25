import { Colord } from "colord";
import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { GameMode, Team } from "../../../core/game/Game";
import { GameView } from "../../../core/game/GameView";
import { ClientID } from "../../../core/Schemas";
import { Layer } from "./Layer";

@customElement("player-team-label")
export class PlayerTeamLabel extends LitElement implements Layer {
  public game: GameView;
  public eventBus: EventBus;
  public clientID: ClientID;

  @state()
  private isTeamsGameMode: boolean = true;

  private isVisible = false;

  private playerTeam: Team | null = null;

  private playerColor: Colord | null = null;

  createRenderRoot() {
    return this;
  }

  init() {
    this.isTeamsGameMode =
      this.game.config().gameConfig().gameMode == GameMode.Team;

    if (this.isTeamsGameMode) {
      this.isVisible = true;
      this.requestUpdate();
    }
  }

  tick() {
    if (!this.playerTeam) {
      this.playerTeam = this.game.myPlayer()?.team();
      this.playerColor = this.game.config().theme().teamColor(this.playerTeam);
      this.requestUpdate();
    }

    if (!this.game.inSpawnPhase() && this.isVisible) {
      this.isVisible = false;
      this.requestUpdate();
    }
  }

  render() {
    if (!this.isVisible) {
      return html``;
    }

    return html`
      <div
        class="top-0 lg:top-4 left-0 lg:left-4  bg-opacity-60 bg-gray-900 p-1 lg:p-2 rounded-es-sm lg:rounded-lg backdrop-blur-md text-white"
        @contextmenu=${(e) => e.preventDefault()}
      >
        Your team:
        <span style="color: ${this.playerColor?.toRgbString()}"
          >${this.playerTeam} &#10687;</span
        >
      </div>
    `;
  }
}
