import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";

@customElement("gutter-ads")
export class GutterAds extends LitElement {
  @state()
  private isVisible: boolean = false;

  @state()
  private adLoaded: boolean = false;

  private leftAdType: string = "standard_iab_left2";
  private rightAdType: string = "standard_iab_rght1";
  private leftContainerId: string = "gutter-ad-container-left";
  private rightContainerId: string = "gutter-ad-container-right";

  // Override createRenderRoot to disable shadow DOM
  createRenderRoot() {
    return this;
  }

  static styles = css``;

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener("userMeResponse", () => {
      if (window.adsEnabled) {
        console.log("showing gutter ads");
        this.show();
      } else {
        console.log("not showing gutter ads");
      }
    });
  }

  // Called after the component's DOM is first rendered
  firstUpdated() {
    // DOM is guaranteed to be available here
    console.log("GutterAdModal DOM is ready");
  }

  public show(): void {
    this.isVisible = true;
    this.requestUpdate();

    // Wait for the update to complete, then load ads
    this.updateComplete.then(() => {
      this.loadAds();
    });
  }

  public close(): void {
    try {
      window.ramp.destroyUnits(this.leftAdType);
      window.ramp.destroyUnits(this.rightAdType);
      console.log("successfully destroyed gutter ads");
    } catch (e) {
      console.error("error destroying gutter ads", e);
    }
  }

  private loadAds(): void {
    console.log("loading ramp ads");
    // Ensure the container elements exist before loading ads
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
            {
              type: this.leftAdType,
              selectorId: this.leftContainerId,
            },
            {
              type: this.rightAdType,
              selectorId: this.rightContainerId,
            },
          ]);
          this.adLoaded = true;
          console.log(
            "Playwire ads loaded:",
            this.leftAdType,
            this.rightAdType,
          );
        } catch (e) {
          console.log(e);
        }
      });
    } catch (error) {
      console.error("Failed to load Playwire ads:", error);
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
  }

  render() {
    if (!this.isVisible) {
      return html``;
    }

    return html`
      <!-- Left Gutter Ad -->
      <div
        class="hidden xl:flex fixed transform -translate-y-1/2 w-[160px] min-h-[600px] z-[100] pointer-events-auto items-center justify-center"
        style="left: calc(50% - 10cm - 230px); top: calc(50% + 10px);"
      >
        <div
          id="${this.leftContainerId}"
          class="w-full h-full flex items-center justify-center p-2"
        ></div>
      </div>

      <!-- Right Gutter Ad -->
      <div
        class="hidden xl:flex fixed transform -translate-y-1/2 w-[160px] min-h-[600px] z-[100] pointer-events-auto items-center justify-center"
        style="left: calc(50% + 10cm + 70px); top: calc(50% + 10px);"
      >
        <div
          id="${this.rightContainerId}"
          class="w-full h-full flex items-center justify-center p-2"
        ></div>
      </div>
    `;
  }
}
