import { LitElement, nothing } from "lit";
import { customElement } from "lit/decorators.js";
import { GameView } from "../../../core/game/GameView";
import { Layer } from "./Layer";

const AD_SHOW_TICKS = 10 * 60 * 10; // 2 minutes
const FOOTER_AD_TYPE = "bottom_rail";
const AD_HEIGHT_PX = 95;

@customElement("in-game-footer-ad")
export class InGameFooterAd extends LitElement implements Layer {
  public game: GameView;

  private isHidden: boolean = false;

  createRenderRoot() {
    return this;
  }

  init() {
    if (!window.adsEnabled) {
      console.log("InGameFooterAd: adsEnabled is false, skipping");
      return;
    }
    if (typeof window.ramp?.spaAddAds !== "function") {
      console.log(
        "InGameFooterAd: ramp.spaAddAds not a function (adblock?), ramp=",
        window.ramp,
      );
      return;
    }
    this.loadAd();
  }

  private loadAd(): void {
    try {
      window.ramp.que.push(() => {
        try {
          window.ramp.spaAddAds([{ type: FOOTER_AD_TYPE }]);
          this.waitForAdSlot();
        } catch (e) {
          console.error("Failed to add in-game footer ad:", e);
        }
      });
    } catch (error) {
      console.error("Failed to load in-game footer ad:", error);
    }
  }

  private waitForAdSlot(): void {
    const start = Date.now();
    const check = () => {
      const slots = window.ramp?.settings?.slots;
      console.log("InGameFooterAd: checking slots=", slots);
      const filled =
        slots &&
        Object.values(slots).some(
          (slot: any) =>
            slot?.type === FOOTER_AD_TYPE && slot?.element?.offsetHeight > 0,
        );
      if (filled) {
        const hud = document.getElementById("bottom-hud");
        if (hud) hud.style.paddingBottom = `${AD_HEIGHT_PX}px`;
        console.log("In-game footer ad slot filled");
        return;
      }
      if (Date.now() - start < 5000) {
        setTimeout(check, 200);
      } else {
        console.log("In-game footer ad did not fill after 5s, slots=", slots);
      }
    };
    setTimeout(check, 200);
  }

  private hideFooterAd(): void {
    const hud = document.getElementById("bottom-hud");
    if (hud) hud.style.paddingBottom = "";
    try {
      window.ramp.destroyUnits(FOOTER_AD_TYPE);
      console.log("successfully destroyed in-game footer ad");
    } catch (e) {
      console.error("error destroying in-game footer ad", e);
    }
  }

  public tick() {
    if (this.isHidden) {
      return;
    }

    const gameTicks =
      this.game.ticks() - this.game.config().numSpawnPhaseTurns();
    if (gameTicks > AD_SHOW_TICKS) {
      console.log("destroying in-game footer ad and refreshing PageOS");
      this.hideFooterAd();
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
    return nothing;
  }
}
