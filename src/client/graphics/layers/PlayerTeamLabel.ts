import { Colord } from "colord";
import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { GameMode } from "../../../core/game/Game";
import { GameView } from "../../../core/game/GameView";
import { Layer } from "./Layer";

@customElement("player-team-label")
export class PlayerTeamLabel extends LitElement implements Layer {
  public game: GameView;

  @state()
  private isTeamsGameMode: boolean = false;

  private isVisible = false;

  private playerTeam: string | null = null;

  private playerColor: Colord = new Colord("#FFFFFF");

  createRenderRoot() {
    return this;
  }

  init() {
    this.isTeamsGameMode =
      this.game.config().gameConfig().gameMode === GameMode.Team;

    if (this.isTeamsGameMode) {
      this.isVisible = true;
      this.requestUpdate();
    }
  }

  tick() {
    if (
      this.isTeamsGameMode &&
      !this.playerTeam &&
      this.game.myPlayer()?.team()
    ) {
      this.playerTeam = this.game.myPlayer()!.team();
      if (this.playerTeam) {
        this.playerColor = this.game
          .config()
          .theme()
          .teamColor(this.playerTeam);
        this.requestUpdate();
      }
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
        class="flex items-center w-full justify-evenly h-8 lg:h-10 top-0 lg:top-4 left-0 lg:left-4 bg-opacity-60 bg-gray-900 rounded-es-sm lg:rounded-lg backdrop-blur-md text-white py-1 lg:p-2"
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
