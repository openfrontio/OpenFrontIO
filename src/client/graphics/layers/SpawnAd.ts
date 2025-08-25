import { css, html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { translateText } from "../../../client/Utils";
import { GameView } from "../../../core/game/GameView";
import { getGamesPlayed } from "../../Utils";
import { Layer } from "./Layer";

const AD_TYPE = "bottom_rail";
const AD_CONTAINER_ID = "bottom-rail-ad-container";

@customElement("spawn-ad")
export class SpawnAd extends LitElement implements Layer {
  public g: GameView | undefined;

  @state()
  private isVisible = false;

  @state()
  private adLoaded = false;

  private gamesPlayed = 0;

  // Override createRenderRoot to disable shadow DOM
  createRenderRoot() {
    return this;
  }

  static styles = css``;

  constructor() {
    super();
  }

  init() {
    this.gamesPlayed = getGamesPlayed();
  }

  public show(): void {
    this.isVisible = true;
    this.loadAd();
    this.requestUpdate();
  }

  public hide(): void {
    // Destroy the ad when hiding
    this.destroyAd();
    this.isVisible = false;
    this.adLoaded = false;
    this.requestUpdate();
  }

  public async tick() {
    if (!this.g) return;
    if (
      !this.isVisible &&
      this.g.inSpawnPhase() &&
      this.g.ticks() > 10 &&
      this.gamesPlayed > 5
    ) {
      console.log("not showing spawn ad");
      // this.show();
    }
    if (this.isVisible && !this.g.inSpawnPhase()) {
      console.log("hiding bottom left ad");
      this.hide();
    }
  }

  private loadAd(): void {
    if (!window.ramp) {
      console.warn("Playwire RAMP not available");
      return;
    }
    if (this.adLoaded) {
      console.log("Ad already loaded, skipping");
      return;
    }
    try {
      window.ramp.que.push(() => {
        window.ramp.spaAddAds([
          {
            selectorId: AD_CONTAINER_ID,
            type: AD_TYPE,
          },
        ]);
        this.adLoaded = true;
        console.log("Playwire ad loaded:", AD_TYPE);
      });
    } catch (error) {
      console.error("Failed to load Playwire ad:", error);
    }
  }

  private destroyAd(): void {
    if (!window.ramp || !this.adLoaded) {
      return;
    }
    try {
      window.ramp.que.push(() => {
        window.ramp.destroyUnits("all");
        console.log("Playwire spawn ad destroyed");
      });
    } catch (error) {
      console.error("Failed to destroy Playwire ad:", error);
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    // Clean up ad when component is removed
    this.destroyAd();
  }

  render() {
    if (!this.isVisible) {
      return html``;
    }

    return html`
      <div
        class="fixed bottom-0 left-0 w-full min-h-[100px] bg-gray-900 border
        border-gray-600 flex items-center justify-center z-50"
      >
        <div
          id="${AD_CONTAINER_ID}"
          class="w-full h-full flex items-center justify-center"
        >
          ${
            !this.adLoaded
              ? html`<span class="text-white text-sm"
                >${translateText("spawn_ad.loading")}</span
              >`
              : ""
          }
        </div>
      </div>
    `;
  }
}
