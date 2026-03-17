import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { GameView } from "../../../core/game/GameView";
import { Layer } from "./Layer";

const AD_TYPE = "standard_iab_left1";
const AD_CONTAINER_ID = "in-game-bottom-left-ad";

const GUTTER_LEFT_AD_TYPE = "standard_iab_left2";
const GUTTER_RIGHT_AD_TYPE = "standard_iab_rght1";
const GUTTER_LEFT_CONTAINER_ID = "in-game-gutter-left";
const GUTTER_RIGHT_CONTAINER_ID = "in-game-gutter-right";

const FOOTER_AD_TYPE = "standard_iab_head2";
const FOOTER_AD_CONTAINER_ID = "in-game-footer-ad";

@customElement("in-game-promo")
export class InGamePromo extends LitElement implements Layer {
  public game: GameView;

  private shouldShow: boolean = false;
  private bottomLeftEligible: boolean = false;
  private bottomLeftAdShown: boolean = false;

  @state()
  private showGutterAds: boolean = false;

  @state()
  private showFooterAd: boolean = false;

  private gutterAdsLoaded: boolean = false;
  private footerAdLoaded: boolean = false;

  createRenderRoot() {
    return this;
  }

  init() {
    this.checkBottomLeftEligibility();
    this.initGutterAds();
    this.initFooterAd();
  }

  tick() {
    if (!this.game.inSpawnPhase()) {
      if (this.showGutterAds) {
        this.hideGutterAds();
      }
      if (this.showFooterAd) {
        this.hideFooterAd();
      }
      if (this.bottomLeftEligible && !this.bottomLeftAdShown) {
        this.bottomLeftAdShown = true;
        this.showAd();
      }
    }
  }

  private checkBottomLeftEligibility(): void {
    if (!window.adsEnabled) return;
    if (window.innerWidth < 1100) return;
    if (window.innerHeight < 750) return;
    this.bottomLeftEligible = true;
  }

  private showAd(): void {
    this.shouldShow = true;
    this.requestUpdate();

    this.updateComplete.then(() => {
      this.loadAd();
    });
  }

  private initGutterAds(): void {
    if (!window.adsEnabled) return;
    if (window.innerWidth <= 1700) return;

    this.showGutterAds = true;
    this.requestUpdate();

    this.updateComplete.then(() => {
      this.loadGutterAds();
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

  private loadGutterAds(): void {
    if (!window.ramp) {
      console.warn("Playwire RAMP not available for gutter ads");
      return;
    }

    if (this.gutterAdsLoaded) return;

    try {
      window.ramp.que.push(() => {
        try {
          window.ramp.spaAddAds([
            {
              type: GUTTER_LEFT_AD_TYPE,
              selectorId: GUTTER_LEFT_CONTAINER_ID,
            },
            {
              type: GUTTER_RIGHT_AD_TYPE,
              selectorId: GUTTER_RIGHT_CONTAINER_ID,
            },
          ]);
          this.gutterAdsLoaded = true;
          console.log("In-game gutter ads loaded");
        } catch (e) {
          console.error("Failed to add gutter ads:", e);
        }
      });
    } catch (error) {
      console.error("Failed to load gutter ads:", error);
    }
  }

  private initFooterAd(): void {
    if (!window.adsEnabled) return;

    this.showFooterAd = true;
    this.requestUpdate();

    this.updateComplete.then(() => {
      this.loadFooterAd();
    });
  }

  private loadFooterAd(): void {
    if (!window.ramp) {
      console.warn("Playwire RAMP not available for footer ad");
      return;
    }

    if (this.footerAdLoaded) return;

    try {
      window.ramp.que.push(() => {
        try {
          window.ramp.spaAddAds([
            { type: FOOTER_AD_TYPE, selectorId: FOOTER_AD_CONTAINER_ID },
          ]);
          this.footerAdLoaded = true;
          console.log("In-game footer ad loaded");
        } catch (e) {
          console.error("Failed to add footer ad:", e);
        }
      });
    } catch (error) {
      console.error("Failed to load footer ad:", error);
    }
  }

  private hideFooterAd(): void {
    this.showFooterAd = false;
    if (this.footerAdLoaded && window.ramp) {
      try {
        window.ramp.destroyUnits(FOOTER_AD_TYPE);
        console.log("Successfully destroyed in-game footer ad");
      } catch (e) {
        console.error("Error destroying footer ad:", e);
      }
    }
    this.requestUpdate();
  }

  private hideGutterAds(): void {
    this.showGutterAds = false;
    if (this.gutterAdsLoaded && window.ramp) {
      try {
        window.ramp.destroyUnits(GUTTER_LEFT_AD_TYPE);
        window.ramp.destroyUnits(GUTTER_RIGHT_AD_TYPE);
        console.log("Successfully destroyed in-game gutter ads");
      } catch (e) {
        console.error("Error destroying gutter ads:", e);
      }
    }
    this.requestUpdate();
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
    return html`
      ${this.shouldShow
        ? html`
            <div
              id="${AD_CONTAINER_ID}"
              class="fixed left-0 z-[100] pointer-events-auto"
              style="bottom: -0.7cm"
            ></div>
          `
        : html``}
      ${this.showGutterAds
        ? html`
            <!-- Left Gutter Ad -->
            <div
              class="fixed left-0 z-40 pointer-events-auto"
              style="bottom: -0.5cm"
            >
              <div id="${GUTTER_LEFT_CONTAINER_ID}"></div>
            </div>

            <!-- Right Gutter Ad -->
            <div
              class="fixed right-0 z-40 pointer-events-auto"
              style="bottom: -0.5cm"
            >
              <div id="${GUTTER_RIGHT_CONTAINER_ID}"></div>
            </div>
          `
        : html``}
      ${this.showFooterAd
        ? html`
            <div
              id="${FOOTER_AD_CONTAINER_ID}"
              class="fixed bottom-0 left-0 right-0 z-40 pointer-events-auto flex justify-center"
            ></div>
          `
        : html``}
    `;
  }
}
