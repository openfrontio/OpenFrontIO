import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";

@customElement("gutter-ads")
export class GutterAds extends LitElement {
  @state()
  private isVisible: boolean = false;

  @state()
  private adLoaded: boolean = false;

  private adLoadRequested: boolean = false;

  @state()
  private isXlViewport: boolean = false;

  @state()
  private leftAdVisible: boolean = false;

  @state()
  private rightAdVisible: boolean = false;

  @state()
  private isProbingAds: boolean = false;

  private leftAdType: string = "standard_iab_left2";
  private rightAdType: string = "standard_iab_rght1";
  private leftContainerId: string = "gutter-ad-container-left";
  private rightContainerId: string = "gutter-ad-container-right";
  private xlMediaQuery: MediaQueryList | null = null;
  private noContentCheckTimer: number | null = null;
  private noContentCheckCount = 0;
  private adWorkToken = 0;
  private handleUserMeResponse = () => {
    if (window.adsEnabled) {
      console.log("showing gutter ads");
      this.show();
    } else {
      console.log("not showing gutter ads");
    }
  };

  // Override createRenderRoot to disable shadow DOM
  createRenderRoot() {
    return this;
  }

  static styles = css``;

  connectedCallback() {
    super.connectedCallback();
    this.xlMediaQuery = window.matchMedia("(min-width: 1280px)");
    this.isXlViewport = this.xlMediaQuery.matches;
    this.xlMediaQuery.addEventListener("change", this.handleViewportChange);
    document.addEventListener("userMeResponse", this.handleUserMeResponse);
  }

  // Called after the component's DOM is first rendered
  firstUpdated() {
    // DOM is guaranteed to be available here
    console.log("GutterAdModal DOM is ready");
  }

  public show(): void {
    this.adWorkToken += 1;
    this.isVisible = true;
    this.adLoaded = false;
    this.adLoadRequested = false;
    this.leftAdVisible = false;
    this.rightAdVisible = false;
    this.isProbingAds = true;
    this.requestUpdate();

    if (this.isXlViewport) {
      // Wait for the update to complete, then load ads
      this.updateComplete.then(() => {
        this.loadAds();
      });
    }
  }

  public close(): void {
    this.adWorkToken += 1;
    this.isVisible = false;
    this.adLoaded = false;
    this.adLoadRequested = false;
    this.leftAdVisible = false;
    this.rightAdVisible = false;
    this.isProbingAds = false;
    this.stopNoContentCheck();

    try {
      window.ramp.destroyUnits(this.leftAdType);
      window.ramp.destroyUnits(this.rightAdType);
      console.log("successfully destroyed gutter ads");
    } catch (e) {
      console.error("error destroying gutter ads", e);
    }
  }

  private handleViewportChange = (event: MediaQueryListEvent) => {
    this.isXlViewport = event.matches;

    if (!this.isXlViewport && (this.adLoaded || this.isProbingAds)) {
      this.close();
      return;
    }

    if (this.isVisible && this.isXlViewport) {
      this.requestUpdate();
      this.updateComplete.then(() => {
        this.loadAds();
      });
    }
  };

  private loadAds(): void {
    const adWorkToken = this.adWorkToken;
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

    if (this.adLoadRequested || this.adLoaded) {
      console.log("Ads already loaded, skipping");
      return;
    }

    this.adLoadRequested = true;

    try {
      window.ramp.que.push(() => {
        if (adWorkToken !== this.adWorkToken || !this.isVisible) {
          return;
        }

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
          this.startNoContentCheck(adWorkToken);
          console.log(
            "Playwire ads loaded:",
            this.leftAdType,
            this.rightAdType,
          );
        } catch (e) {
          this.adLoadRequested = false;
          console.log(e);
        }
      });
    } catch (error) {
      this.adLoadRequested = false;
      console.error("Failed to load Playwire ads:", error);
    }
  }

  private hasInjectedAdContent(containerId: string): boolean {
    const container = this.querySelector(`#${containerId}`);
    if (!container) return false;

    // Treat common ad payload elements as real content.
    if (
      container.querySelector("iframe, img, video, ins, canvas, object, embed")
    ) {
      return true;
    }

    const root = container.firstElementChild as HTMLElement | null;
    if (!root) return false;
    if (root.childElementCount > 0) return true;

    return Boolean(root.textContent?.trim());
  }

  private startNoContentCheck(adWorkToken: number): void {
    this.stopNoContentCheck();
    this.noContentCheckCount = 0;
    this.isProbingAds = true;

    this.noContentCheckTimer = window.setInterval(() => {
      if (adWorkToken !== this.adWorkToken) {
        this.stopNoContentCheck();
        return;
      }

      this.noContentCheckCount += 1;
      this.leftAdVisible = this.hasInjectedAdContent(this.leftContainerId);
      this.rightAdVisible = this.hasInjectedAdContent(this.rightContainerId);

      if (this.noContentCheckCount >= 10) {
        this.stopNoContentCheck();
        this.isProbingAds = false;
        this.adLoaded = this.leftAdVisible || this.rightAdVisible;
        this.adLoadRequested = this.adLoaded;
        if (!this.adLoaded) {
          this.adLoadRequested = false;
          this.isVisible = false;
        }
      }
    }, 1000);
  }

  private stopNoContentCheck(): void {
    if (this.noContentCheckTimer) {
      window.clearInterval(this.noContentCheckTimer);
      this.noContentCheckTimer = null;
    }
  }

  disconnectedCallback() {
    this.adWorkToken += 1;
    this.xlMediaQuery?.removeEventListener("change", this.handleViewportChange);
    document.removeEventListener("userMeResponse", this.handleUserMeResponse);
    this.xlMediaQuery = null;
    this.stopNoContentCheck();
    super.disconnectedCallback();
  }

  render() {
    if (!this.isVisible || !this.isXlViewport) {
      return html``;
    }

    const leftMounted = this.leftAdVisible || this.isProbingAds;
    const rightMounted = this.rightAdVisible || this.isProbingAds;
    const probeClass =
      "absolute w-px h-px overflow-hidden pointer-events-none opacity-0";
    const visibleClass =
      "fixed flex transform -translate-y-1/2 w-[160px] min-h-[600px] z-[100] pointer-events-auto items-center justify-center";
    const leftClass = this.leftAdVisible ? visibleClass : probeClass;
    const rightClass = this.rightAdVisible ? visibleClass : probeClass;

    return html`
      ${leftMounted
        ? html`
            <!-- Left Gutter Ad -->
            <div
              class="${leftClass}"
              style="left: calc(50% - 10cm - 230px); top: calc(50% + 10px);"
            >
              <div
                id="${this.leftContainerId}"
                class="w-full h-full flex items-center justify-center p-2"
              ></div>
            </div>
          `
        : html``}
      ${rightMounted
        ? html`
            <!-- Right Gutter Ad -->
            <div
              class="${rightClass}"
              style="left: calc(50% + 10cm + 70px); top: calc(50% + 10px);"
            >
              <div
                id="${this.rightContainerId}"
                class="w-full h-full flex items-center justify-center p-2"
              ></div>
            </div>
          `
        : html``}
    `;
  }
}
