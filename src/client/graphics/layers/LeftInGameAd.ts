import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { GameView } from "../../../core/game/GameView";
import { Layer } from "./Layer";

declare global {
  interface Window {
    aiptag: {
      cmd: {
        display: {
          push: (callback: () => void) => void;
        };
      };
    };
    aipDisplayTag: {
      display: (id: string) => void;
    };
  }
}

const BREAKPOINT = {
  width: 1000,
  height: 800,
};

const AD_SIZE = "openfront-io_300x250_ingame";

@customElement("left-in-game-ad")
export class LeftInGameAd extends LitElement implements Layer {
  public g: GameView;

  @state()
  private isVisible: boolean = false;

  // Override createRenderRoot to disable shadow DOM
  createRenderRoot() {
    return this;
  }

  static styles = css`
    .ad-container {
      position: fixed;
      left: 0;
      top: 50%;
      transform: translateY(-50%);
      z-index: 9000;
      pointer-events: auto;
    }
  `;

  constructor() {
    super();
  }

  public show(): void {
    this.isVisible = true;
    this.requestUpdate();
    // Refresh the ad when showing
    setTimeout(() => this.refreshAd(), 100);
  }

  public hide(): void {
    this.isVisible = false;
    this.requestUpdate();
  }

  public async tick() {
    if (!this.isVisible && !this.g.inSpawnPhase() && this.screenLargeEnough()) {
      console.log("showing left in game ad");
      this.show();
    }
    if (this.isVisible && !this.screenLargeEnough()) {
      console.log("hiding left in game ad");
      this.hide();
    }
  }

  private screenLargeEnough(): boolean {
    return (
      window.innerWidth > BREAKPOINT.width &&
      window.innerHeight > BREAKPOINT.height
    );
  }

  private refreshAd(): void {
    if (window.aiptag && window.aiptag.cmd && window.aiptag.cmd.display) {
      window.aiptag.cmd.display.push(
        function () {
          if (window.aipDisplayTag) {
            window.aipDisplayTag.display(AD_SIZE);
          }
        }.bind(this),
      );
    }
  }

  render() {
    if (!this.isVisible) {
      return html``;
    }

    return html`
      <div
        class="ad-container"
        style="position: fixed; left: 0; top: 50%; transform: translateY(-50%); z-index: 9999;"
      >
        <div id="${AD_SIZE}"></div>
      </div>
    `;
  }
}
