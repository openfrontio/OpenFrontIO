import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";

// ─── Gutter Ads ──────────────────────────────────────────────────────────────

@customElement("homepage-promos")
export class HomepagePromos extends LitElement {
  @state() private isVisible: boolean = false;
  @state() private adLoaded: boolean = false;
  private cornerAdLoaded: boolean = false;

  private onUserMeResponse = () => {
    if (window.adsEnabled) {
      console.log("showing homepage ads");
      this.show();
      this.loadCornerAdVideo();
    } else {
      console.log("not showing homepage ads");
    }
  };

  private onJoinLobby = () => {
    this.loadBottomRail();
  };

  private onLeaveLobby = () => {
    this.destroyBottomRail();
  };

  private bottomRailActive: boolean = false;

  private leftAdType: string = "standard_iab_left2";
  private rightAdType: string = "standard_iab_rght1";
  private leftContainerId: string = "gutter-ad-container-left";
  private rightContainerId: string = "gutter-ad-container-right";

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener("userMeResponse", this.onUserMeResponse);
    document.addEventListener("join-lobby", this.onJoinLobby);
    document.addEventListener("leave-lobby", this.onLeaveLobby);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener("userMeResponse", this.onUserMeResponse);
    document.removeEventListener("join-lobby", this.onJoinLobby);
    document.removeEventListener("leave-lobby", this.onLeaveLobby);
  }

  public show(): void {
    this.isVisible = true;
    this.requestUpdate();
    this.updateComplete.then(() => {
      this.loadGutterAds();
    });
  }

  public close(): void {
    this.isVisible = false;
    this.adLoaded = false;
    try {
      // Only destroy gutter ads; bottom_rail persists into spawn phase.
      window.ramp.destroyUnits(this.leftAdType);
      window.ramp.destroyUnits(this.rightAdType);
      console.log("successfully destroyed gutter ads");
    } catch (e) {
      console.error("error destroying gutter ads", e);
    }
  }

  public loadBottomRail(): void {
    if (!window.adsEnabled) return;
    if (this.bottomRailActive) return;
    if (!window.ramp) {
      console.warn("Playwire RAMP not available for bottom_rail ad");
      return;
    }

    this.bottomRailActive = true;
    try {
      window.ramp.que.push(() => {
        try {
          window.ramp.spaAddAds([{ type: "bottom_rail" }]);
          console.log("Bottom rail ad loaded");
        } catch (e) {
          console.error("Failed to add bottom_rail ad:", e);
        }
      });
    } catch (error) {
      console.error("Failed to load bottom_rail ad:", error);
    }
  }

  public destroyBottomRail(): void {
    if (!this.bottomRailActive) return;
    this.bottomRailActive = false;

    if (!window.ramp) return;

    try {
      window.ramp.destroyUnits("pw-oop-bottom_rail");
      console.log("Bottom rail ad destroyed");
    } catch (e) {
      console.error("Error destroying bottom_rail ad:", e);
    }
  }

  private loadGutterAds(): void {
    console.log("loading ramp gutter ads");
    const leftContainer = this.querySelector(`#${this.leftContainerId}`);
    const rightContainer = this.querySelector(`#${this.rightContainerId}`);

    if (!leftContainer || !rightContainer) {
      console.warn("Ad containers not found in DOM");
      return;
    }

    if (!window.ramp) {
      console.warn("Playwire RAMP not available");
      return;
    }

    if (this.adLoaded) {
      console.log("Ads already loaded, skipping");
      return;
    }

    try {
      window.ramp.que.push(() => {
        try {
          window.ramp.spaAddAds([
            { type: this.leftAdType, selectorId: this.leftContainerId },
            { type: this.rightAdType, selectorId: this.rightContainerId },
          ]);
          this.adLoaded = true;
          console.log("Gutter ads loaded:", this.leftAdType, this.rightAdType);
        } catch (e) {
          console.log(e);
        }
      });
    } catch (error) {
      console.error("Failed to load gutter ads:", error);
    }
  }

  private loadCornerAdVideo(): void {
    if (this.cornerAdLoaded) return;
    if (window.innerWidth < 1280) return;
    if (!window.ramp) {
      console.warn("Playwire RAMP not available for corner_ad_video");
      return;
    }
    try {
      window.ramp.que.push(() => {
        try {
          window.ramp
            .addUnits([{ type: "corner_ad_video" }])
            .then(() => {
              this.cornerAdLoaded = true;
              window.ramp.displayUnits();
              console.log("corner_ad_video loaded");
            })
            .catch((e: unknown) => {
              console.error("Failed to display corner_ad_video:", e);
            });
        } catch (e) {
          console.error("Failed to add corner_ad_video:", e);
        }
      });
    } catch (error) {
      console.error("Failed to load corner_ad_video:", error);
    }
  }

  render() {
    if (!this.isVisible) {
      return html``;
    }

    return html`
      <!-- Left Gutter Ad -->
      <div
        class="hidden xl:flex fixed transform -translate-y-1/2 w-[160px] min-h-[600px] z-40 pointer-events-auto items-center justify-center xl:[--half-content:10.5cm] 2xl:[--half-content:12.5cm]"
        style="left: calc(50% - var(--half-content) - 208px); top: calc(50% + 10px);"
      >
        <div
          id="${this.leftContainerId}"
          class="w-full h-full flex items-center justify-center p-2"
        ></div>
      </div>

      <!-- Right Gutter Ad -->
      <div
        class="hidden xl:flex fixed transform -translate-y-1/2 w-[160px] min-h-[600px] z-40 pointer-events-auto items-center justify-center xl:[--half-content:10.5cm] 2xl:[--half-content:12.5cm]"
        style="left: calc(50% + var(--half-content) + 48px); top: calc(50% + 10px);"
      >
        <div
          id="${this.rightContainerId}"
          class="w-full h-full flex items-center justify-center p-2"
        ></div>
      </div>
    `;
  }
}
