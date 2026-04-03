import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { GameView } from "../../../core/game/GameView";
import { crazyGamesSDK } from "../../CrazyGamesSDK";
import { Layer } from "./Layer";

const AD_TYPE = "standard_iab_left1";
const AD_CONTAINER_ID = "in-game-bottom-left-ad";
const BOTTOM_RAIL_TYPE = "bottom_rail";

@customElement("in-game-promo")
export class InGamePromo extends LitElement implements Layer {
  public game: GameView;

  private shouldShow: boolean = false;
  private bottomRailActive: boolean = false;
  private cornerAdShown: boolean = false;

  createRenderRoot() {
    return this;
  }

  init() {
    this.showBottomRail();
  }

  tick() {
    if (!this.game.inSpawnPhase()) {
      if (this.bottomRailActive) {
        this.destroyBottomRail();
      }
      if (!this.cornerAdShown) {
        this.cornerAdShown = true;
        console.log("[InGamePromo] Spawn phase ended, triggering showAd");
        this.showAd();
      }
    }
  }

  private showBottomRail(): void {
    if (!window.adsEnabled) return;
    if (!this.game.inSpawnPhase()) return;
    if (!window.ramp) {
      console.warn("Playwire RAMP not available for bottom_rail ad");
      return;
    }

    this.bottomRailActive = true;
    try {
      window.ramp.que.push(() => {
        try {
          window.ramp.spaAddAds([{ type: BOTTOM_RAIL_TYPE }]);
          console.log("Bottom rail ad loaded during spawn phase");
        } catch (e) {
          console.error("Failed to add bottom_rail ad:", e);
        }
      });
    } catch (error) {
      console.error("Failed to load bottom_rail ad:", error);
    }
  }

  private destroyBottomRail(): void {
    if (!this.bottomRailActive) return;
    this.bottomRailActive = false;

    if (!window.ramp) return;

    try {
      window.ramp.spaAds({ ads: [], countPageview: false });
      console.log("Bottom rail ad destroyed via spaAds after spawn phase");
    } catch (e) {
      console.error("Error destroying bottom_rail ad:", e);
    }
  }

  private showAd(): void {
    console.log(
      `[InGamePromo] showAd called, isOnCrazyGames=${crazyGamesSDK.isOnCrazyGames()}`,
    );
    if (window.innerWidth < 1100) return;
    if (window.innerHeight < 750) return;

    if (crazyGamesSDK.isOnCrazyGames()) {
      this.showCrazyGamesAd();
      return;
    }

    if (!window.adsEnabled) return;

    this.shouldShow = true;
    this.requestUpdate();

    this.updateComplete.then(() => {
      this.loadAd();
    });
  }

  private showCrazyGamesAd(): void {
    console.log(
      `[InGamePromo] showCrazyGamesAd called, isReady=${crazyGamesSDK.isReady()}, width=${window.innerWidth}, height=${window.innerHeight}`,
    );
    if (!crazyGamesSDK.isReady()) {
      console.log(
        "[InGamePromo] CrazyGames SDK not ready, skipping in-game ad",
      );
      return;
    }

    this.requestUpdate();

    this.updateComplete.then(() => {
      console.log("[InGamePromo] DOM updated, calling createBottomLeftAd");
      crazyGamesSDK.createBottomLeftAd();
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
    this.destroyBottomRail();

    if (crazyGamesSDK.isOnCrazyGames()) {
      crazyGamesSDK.clearBottomLeftAd();
      this.shouldShow = false;
      this.requestUpdate();
      return;
    }

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
