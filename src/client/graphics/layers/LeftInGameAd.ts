import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { GameView } from "../../../core/game/GameView";
import { Layer } from "./Layer";

const BREAKPOINT = {
  width: 1000,
  height: 800,
};

const AD_TYPE = "standard_iab_modl2"; // 320x50/320x100 - better for bottom positioning
const AD_CONTAINER_ID = "bottom-left-ad-container";

@customElement("left-in-game-ad")
export class LeftInGameAd extends LitElement implements Layer {
  public g: GameView;

  @state()
  private isVisible: boolean = false;

  @state()
  private adLoaded: boolean = false;

  // Override createRenderRoot to disable shadow DOM
  createRenderRoot() {
    return this;
  }

  static styles = css``;

  constructor() {
    super();
  }

  public show(): void {
    this.isVisible = true;
    this.requestUpdate();
    // Load the ad when showing (with small delay to ensure DOM is ready)
    setTimeout(() => this.loadAd(), 100);
  }

  public hide(): void {
    this.isVisible = false;
    this.adLoaded = false;
    this.requestUpdate();
    // Destroy the ad when hiding
    this.destroyAd();
  }

  public async tick() {
    if (!this.isVisible && !this.g.inSpawnPhase() && this.screenLargeEnough()) {
      // TODO: uncomment to enable in-game ads
      // console.log("showing bottom left ad");
      // this.show();
    }
    if (this.isVisible && !this.screenLargeEnough()) {
      console.log("hiding bottom left ad");
      this.hide();
    }
  }

  private screenLargeEnough(): boolean {
    return (
      window.innerWidth > BREAKPOINT.width &&
      window.innerHeight > BREAKPOINT.height
    );
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
            type: AD_TYPE,
            selectorId: AD_CONTAINER_ID,
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
        window.ramp.destroyUnits(AD_TYPE);
        console.log("Playwire ad destroyed:", AD_TYPE);
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
        class="w-[320px] min-h-[100px] bg-gray-900 border border-gray-600 flex items-center justify-center"
      >
        <div
          id="${AD_CONTAINER_ID}"
          class="w-full h-full flex items-center justify-center"
        >
          ${!this.adLoaded
            ? html`<span class="text-white text-sm">Loading ad...</span>`
            : ""}
        </div>
      </div>
    `;
  }
}
