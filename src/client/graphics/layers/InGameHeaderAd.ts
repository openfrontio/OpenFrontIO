import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { GameView } from "../../../core/game/GameView";
import { Layer } from "./Layer";

const AD_SHOW_TICKS = 2 * 60 * 10; // 2 minutes
const HEADER_AD_TYPE = "standard_iab_head1";
const HEADER_AD_CONTAINER_ID = "header-ad-container";
const TWO_XL_BREAKPOINT = 1536;

@customElement("in-game-header-ad")
export class InGameHeaderAd extends LitElement implements Layer {
  public game: GameView;

  private isHidden: boolean = false;
  private adLoaded: boolean = false;
  private shouldShow: boolean = false;

  createRenderRoot() {
    return this;
  }

  init() {
    // TODO: move ad and re-enable.
    // this.showHeaderAd();
  }

  private showHeaderAd(): void {
    // Don't show header ad on screens smaller than 2xl
    if (window.innerWidth < TWO_XL_BREAKPOINT) {
      return;
    }
    if (!window.adsEnabled) {
      return;
    }

    this.shouldShow = true;
    this.requestUpdate();

    // Wait for the element to render before loading the ad
    this.updateComplete.then(() => {
      this.loadAd();
    });
  }

  private loadAd(): void {
    if (!window.ramp) {
      console.warn("Playwire RAMP not available for header ad");
      return;
    }

    try {
      window.ramp.que.push(() => {
        try {
          window.ramp.spaAddAds([
            {
              type: HEADER_AD_TYPE,
              selectorId: HEADER_AD_CONTAINER_ID,
            },
          ]);
          this.adLoaded = true;
          console.log("Header ad loaded:", HEADER_AD_TYPE);
        } catch (e) {
          console.error("Failed to add header ad:", e);
        }
      });
    } catch (error) {
      console.error("Failed to load header ad:", error);
    }
  }

  private hideHeaderAd(): void {
    this.shouldShow = false;
    this.adLoaded = false;
    this.requestUpdate();
  }

  public tick() {
    if (this.isHidden) {
      return;
    }

    const gameTicks =
      this.game.ticks() - this.game.config().numSpawnPhaseTurns();
    if (gameTicks > AD_SHOW_TICKS) {
      console.log("destroying header ad and refreshing PageOS");
      this.hideHeaderAd();
      this.isHidden = true;

      if (window.PageOS?.session?.newPageView) {
        window.PageOS.session.newPageView();
      }
      return;
    }
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
        id="${HEADER_AD_CONTAINER_ID}"
        class="hidden 2xl:flex fixed top-0 left-1/2 -translate-x-1/2 z-[100] justify-center items-center pointer-events-auto p-0 -mt-[20px]"
      ></div>
    `;
  }
}
