import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { crazyGamesSDK } from "src/client/CrazyGamesSDK";
import { getGamesPlayed } from "src/client/Utils";
import { GameType } from "src/core/game/Game";
import { GameView } from "../../../core/game/GameView";
import "../../components/VideoPromo";
import { Layer } from "./Layer";

@customElement("spawn-video-ad")
export class SpawnVideoAd extends LitElement implements Layer {
  public game: GameView;

  @state() private shouldShow = false;
  @state() private adComplete = false;

  createRenderRoot() {
    return this;
  }

  init() {
    if (
      !window.adsEnabled ||
      window.innerWidth < 768 ||
      crazyGamesSDK.isOnCrazyGames() ||
      this.game.config().gameConfig().gameType === GameType.Singleplayer ||
      getGamesPlayed() < 3 // Don't show to new players
    ) {
      return;
    }
    this.shouldShow = true;
  }

  tick() {
    if (this.adComplete) return;
    // Hide when spawn phase ends
    if (this.shouldShow && !this.game.inSpawnPhase()) {
      this.shouldShow = false;
      this.requestUpdate();
    }
  }

  private handleComplete = () => {
    this.adComplete = true;
    this.shouldShow = false;
  };

  shouldTransform(): boolean {
    return false;
  }

  render() {
    if (!this.shouldShow || this.adComplete) {
      return html``;
    }

    return html`
      <div class="fixed bottom-0 left-0 z-[9999] pointer-events-auto">
        <video-ad
          style="width: 400px; max-width: 400px; height: 225px; aspect-ratio: auto;"
          .onComplete="${this.handleComplete}"
        ></video-ad>
      </div>
    `;
  }
}
