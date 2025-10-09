import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { getGamesPlayed } from "./Utils";

const LEFT_FUSE = "gutter-ad-container-left";
const RIGHT_FUSE = "gutter-ad-container-right";
const MARGIN = "10px";

@customElement("gutter-ads")
export class GutterAds extends LitElement {
  @state()
  private isVisible: boolean = false;

  @state()
  private adLoaded: boolean = false;

  // Override createRenderRoot to disable shadow DOM
  createRenderRoot() {
    return this;
  }

  init() {
    if (getGamesPlayed() > 1) {
      console.log("showing front page ads");
    }
  }

  static styles = css``;

  // Called after the component's DOM is first rendered
  firstUpdated() {
    // DOM is guaranteed to be available here
    console.log("GutterAdModal DOM is ready");
  }

  public show(): void {
    console.log("showing GutterAdModal");
    this.isVisible = true;
    this.requestUpdate();

    // Wait for the update to complete, then load ads
    this.updateComplete.then(() => {
      this.loadAds();
    });
  }

  public hide(): void {
    console.log("hiding GutterAdModal");
    this.destroyAds();
    this.adLoaded = false;
    this.requestUpdate();
  }

  private loadAds(): void {
    // Ensure the container elements exist before loading ads
    const leftContainer = this.querySelector(`#${LEFT_FUSE}`);
    const rightContainer = this.querySelector(`#${RIGHT_FUSE}`);

    if (!leftContainer || !rightContainer) {
      console.warn("Ad containers not found in DOM");
      return;
    }

    if (!window.fusetag) {
      console.warn("Fuse tag not available");
      return;
    }

    if (this.adLoaded) {
      console.log("Ads already loaded, skipping");
      return;
    }

    try {
      console.log("registering zones");
      window.fusetag.que.push(() => {
        window.fusetag.registerZone(LEFT_FUSE);
        window.fusetag.registerZone(RIGHT_FUSE);
      });
    } catch (error) {
      console.error("Failed to load fuse ads:", error);
      this.hide();
    }
  }

  private destroyAds(): void {
    this.isVisible = false;

    if (!window.fusetag) {
      return;
    }
    window.fusetag.que.push(() => {
      window.fusetag.destroyZone(LEFT_FUSE);
      window.fusetag.destroyZone(RIGHT_FUSE);
    });
    this.requestUpdate();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.destroyAds();
  }

  private renderLoadingPlaceholder() {
    return html`
      <div
        class="w-full h-full bg-gray-200 border-2 border-gray-300 rounded-lg flex items-center justify-center"
      >
        <div class="text-center text-gray-600 font-semibold text-sm">
          <div class="mb-2">📺</div>
          <div>Loading Ad</div>
        </div>
      </div>
    `;
  }

  render() {
    if (!this.isVisible) {
      return html``;
    }

    return html`
      <div id="${LEFT_FUSE}" data-fuse="lhs_sticky_vrec"></div>
      <div id="${RIGHT_FUSE}" data-fuse="rhs_sticky_vrec"></div>
    `;
  }
}
