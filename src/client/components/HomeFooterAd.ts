import { LitElement, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";

export const FOOTER_AD_MIN_HEIGHT = 880;
const FOOTER_AD_TYPE = "standard_iab_head2";
const FOOTER_AD_CONTAINER_ID = "home-footer-ad-container";

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
