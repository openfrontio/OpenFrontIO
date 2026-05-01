import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { GameView } from "../../../core/game/GameView";
import { crazyGamesSDK } from "../../CrazyGamesSDK";
import { Layer } from "./Layer";

const AD_TYPES = [
  { type: "standard_iab_left1", selectorId: "in-game-bottom-left-ad" },
  { type: "standard_iab_left3", selectorId: "in-game-bottom-left-ad3" },
  { type: "standard_iab_left4", selectorId: "in-game-bottom-left-ad4" },
];

@customElement("in-game-promo")
export class InGamePromo extends LitElement implements Layer {
  public game: GameView;

  private shouldShow: boolean = false;
  private adsVisible: boolean = false;
  private bottomRailDestroyed: boolean = false;
  private cornerAdShown: boolean = false;
  private adCheckInterval: ReturnType<typeof setTimeout> | null = null;

  createRenderRoot() {
    return this;
  }

  init() {}

  tick() {
    if (!this.game.inSpawnPhase()) {
      if (!this.bottomRailDestroyed) {
        this.bottomRailDestroyed = true;
        this.destroyBottomRail();
      }
      if (!this.cornerAdShown) {
        this.cornerAdShown = true;
        console.log("[InGamePromo] Spawn phase ended, triggering showAd");
        this.showAd();
      }
    }
  }

  private destroyBottomRail(): void {
    if (!window.ramp) return;

    try {
      window.ramp.destroyUnits("pw-oop-bottom_rail");
      console.log("Bottom rail ad destroyed after spawn phase");
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
      this.checkForAds();
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

  private checkForAds(): void {
    if (this.adCheckInterval) {
      clearInterval(this.adCheckInterval);
    }
    this.adCheckInterval = setInterval(() => {
      const hasAds = AD_TYPES.some(({ selectorId }) => {
        const el = document.getElementById(selectorId);
        return el && el.clientHeight > 50;
      });
      if (hasAds) {
        this.adsVisible = true;
        this.requestUpdate();
        if (this.adCheckInterval) {
          clearInterval(this.adCheckInterval);
          this.adCheckInterval = null;
        }
      }
    }, 1000);
  }

  private loadAd(): void {
    if (!window.ramp) {
      console.warn("Playwire RAMP not available for in-game ad");
      return;
    }

    try {
      window.ramp.que.push(() => {
        try {
          window.ramp.spaAddAds(
            AD_TYPES.map(({ type, selectorId }) => ({ type, selectorId })),
          );
          console.log(
            "In-game bottom-left ads loaded:",
            AD_TYPES.map((a) => a.type),
          );
        } catch (e) {
          console.error("Failed to add in-game ads:", e);
        }
      });
    } catch (error) {
      console.error("Failed to load in-game ads:", error);
    }
  }

  public hideAd(): void {
    if (this.adCheckInterval) {
      clearInterval(this.adCheckInterval);
      this.adCheckInterval = null;
    }
    this.adsVisible = false;
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
      for (const { type } of AD_TYPES) {
        window.ramp.destroyUnits(type);
      }
      console.log("successfully destroyed in-game bottom-left ads");
    } catch (e) {
      console.error("error destroying in-game ads:", e);
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
        id="in-game-promo-container"
        class="fixed left-0 z-[100] pointer-events-auto flex flex-col-reverse ${this
          .adsVisible
          ? "bg-gray-800 rounded-tr-lg p-1"
          : ""}"
        style="bottom: -0.7cm"
      >
        ${AD_TYPES.map(
          ({ selectorId }) =>
            html`<div id="${selectorId}" style="margin:0;padding:0"></div>`,
        )}
      </div>
    `;
  }
}
