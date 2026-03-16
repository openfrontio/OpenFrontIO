import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { GameView } from "../../../core/game/GameView";
import { Layer } from "./Layer";

const AD_TYPE = "standard_iab_left1";
const AD_CONTAINER_ID = "in-game-bottom-left-ad";

@customElement("in-game-promo")
export class InGamePromo extends LitElement implements Layer {
  public game: GameView;

  private shouldShow: boolean = false;

  createRenderRoot() {
    return this;
  }

  init() {
    this.showAd();
  }

  private showAd(): void {
    if (!window.adsEnabled) return;
    if (window.innerWidth < 1100) return;
    if (window.innerHeight < 750) return;

    this.shouldShow = true;
    this.requestUpdate();

    this.updateComplete.then(() => {
      this.loadAd();
    });
  }

  private loadAd(): void {
    if (!window.ramp) {
      console.warn("Playwire RAMP not available for in-game ad");
      return;
    }

    try {
      window.ramp.que.push(() => {
        try {
          window.ramp.spaAddAds([
            {
              type: AD_TYPE,
              selectorId: AD_CONTAINER_ID,
            },
          ]);
          console.log("In-game bottom-left ad loaded:", AD_TYPE);
        } catch (e) {
          console.error("Failed to add in-game ad:", e);
        }
      });
    } catch (error) {
      console.error("Failed to load in-game ad:", error);
    }
  }

  public hideAd(): void {
    if (!window.ramp) {
      console.warn("Playwire RAMP not available for in-game ad");
      return;
    }
    this.shouldShow = false;
    try {
      window.ramp.destroyUnits(AD_TYPE);
      console.log("successfully destroyed in-game bottom-left ad");
    } catch (e) {
      console.error("error destroying in-game ad:", e);
    }
    this.requestUpdate();
  }

  shouldTransform(): boolean {
    return false;
  }

  render() {
    if (!this.shouldShow) {
      return html``;
    }

    return html`
      <div
        id="${AD_CONTAINER_ID}"
        class="fixed left-0 z-[100] pointer-events-auto"
        style="bottom: -0.7cm"
      ></div>
    `;
  }
}
