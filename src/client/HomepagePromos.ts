import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";

export const FOOTER_AD_MIN_HEIGHT = 880;

const FOOTER_AD_TYPE = "standard_iab_head2";
const FOOTER_AD_CONTAINER_ID = "home-footer-ad-container";

// ─── Gutter Ads ──────────────────────────────────────────────────────────────

@customElement("homepage-promos")
export class HomepagePromos extends LitElement {
  @state() private isVisible: boolean = false;
  @state() private adLoaded: boolean = false;
  private cornerAdLoaded: boolean = false;
  @state() private hasFooterAd: boolean = false;

  private onResize = () => {
    const isDesktop = window.innerWidth >= 640;
    this.hasFooterAd = isDesktop && window.innerHeight >= FOOTER_AD_MIN_HEIGHT;
  };

  private onUserMeResponse = () => {
    if (window.adsEnabled) {
      console.log("showing homepage ads");
      this.show();
      this.loadCornerAdVideo();
    } else {
      console.log("not showing homepage ads");
    }
  };

  private leftAdType: string = "standard_iab_left2";
  private rightAdType: string = "standard_iab_rght1";
  private leftContainerId: string = "gutter-ad-container-left";
  private rightContainerId: string = "gutter-ad-container-right";

  createRenderRoot() {
    return this;
  }

  static styles = css``;

  connectedCallback() {
    super.connectedCallback();
    this.onResize();
    window.addEventListener("resize", this.onResize);
    document.addEventListener("userMeResponse", this.onUserMeResponse);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("resize", this.onResize);
    document.removeEventListener("userMeResponse", this.onUserMeResponse);
  }

  public show(): void {
    this.isVisible = true;
    this.requestUpdate();
    this.updateComplete.then(() => {
      this.loadGutterAds();
    });
  }

  public close(): void {
    try {
      // Keep corner video ad alive.
      window.ramp.destroyUnits(this.leftAdType);
      window.ramp.destroyUnits(this.rightAdType);
      console.log("successfully destroyed gutter ads");
    } catch (e) {
      console.error("error destroying gutter ads", e);
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
        style="left: calc(50% - var(--half-content) - 208px); top: calc(50% + 10px${this
          .hasFooterAd
          ? " - 1.2cm"
          : ""});"
      >
        <div
          id="${this.leftContainerId}"
          class="w-full h-full flex items-center justify-center p-2"
        ></div>
      </div>

      <!-- Right Gutter Ad -->
      <div
        class="hidden xl:flex fixed transform -translate-y-1/2 w-[160px] min-h-[600px] z-40 pointer-events-auto items-center justify-center xl:[--half-content:10.5cm] 2xl:[--half-content:12.5cm]"
        style="left: calc(50% + var(--half-content) + 48px); top: calc(50% + 10px${this
          .hasFooterAd
          ? " - 1.2cm"
          : ""});"
      >
        <div
          id="${this.rightContainerId}"
          class="w-full h-full flex items-center justify-center p-2"
        ></div>
      </div>
    `;
  }
}

// ─── Footer Ad ───────────────────────────────────────────────────────────────

@customElement("home-footer-ad")
export class HomeFooterAd extends LitElement {
  @state() private shouldShow: boolean = false;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.style.display = "contents";
    document.addEventListener("userMeResponse", this.onUserMeResponse);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener("userMeResponse", this.onUserMeResponse);
    this.destroyAd();
  }

  private onUserMeResponse = () => {
    const isDesktop = window.innerWidth >= 640;
    if (
      !window.adsEnabled ||
      (isDesktop && window.innerHeight < FOOTER_AD_MIN_HEIGHT)
    ) {
      return;
    }
    this.shouldShow = true;
    this.updateComplete.then(() => {
      this.loadAd();
    });
  };

  private loadAd(): void {
    if (!window.ramp) {
      console.warn("Playwire RAMP not available for footer ad");
      return;
    }
    try {
      window.ramp.que.push(() => {
        try {
          window.ramp.spaAddAds([
            { type: FOOTER_AD_TYPE, selectorId: FOOTER_AD_CONTAINER_ID },
          ]);
          console.log("Footer ad loaded:", FOOTER_AD_TYPE);
        } catch (e) {
          console.error("Failed to add footer ad:", e);
        }
      });
    } catch (error) {
      console.error("Failed to load footer ad:", error);
    }
  }

  private destroyAd(): void {
    try {
      window.ramp.destroyUnits(FOOTER_AD_TYPE);
      console.log("successfully destroyed footer ad");
    } catch (e) {
      console.error("error destroying footer ad", e);
    }
  }

  render() {
    if (!this.shouldShow) {
      return nothing;
    }

    return html`
      <div
        id="${FOOTER_AD_CONTAINER_ID}"
        class="flex justify-center items-center w-full pointer-events-auto [&_*]:!m-0 [&_*]:!p-0"
        style="margin: 0; padding: 0; line-height: 0;"
      ></div>
    `;
  }
}
