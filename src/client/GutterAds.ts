import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { UserMeResponse } from "../core/ApiSchemas";
import { isInIframe } from "./Utils";

const LEFT_FUSE = "gutter-ad-container-left";
const RIGHT_FUSE = "gutter-ad-container-right";
// Minimum screen width to show ads (larger than typical Chromebook)
const MIN_SCREEN_WIDTH = 1400;

@customElement("gutter-ads")
export class GutterAds extends LitElement {
  @state()
  private isVisible: boolean = false;

  // Override createRenderRoot to disable shadow DOM
  createRenderRoot() {
    return this;
  }

  private readonly boundUserMeHandler = (event: Event) =>
    this.onUserMe((event as CustomEvent<UserMeResponse | false>).detail);

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener(
      "userMeResponse",
      this.boundUserMeHandler as EventListener,
    );
  }

  private onUserMe(userMeResponse: UserMeResponse | false): void {
    const flares =
      userMeResponse === false ? [] : (userMeResponse.player.flares ?? []);
    const hasFlare = flares.some((flare) => flare.startsWith("pattern:"));
    if (hasFlare) {
      console.log("No ads because you have patterns");
      window.enableAds = false;
    } else {
      console.log("No flares, showing ads");
      this.show();
      window.enableAds = true;
    }
  }

  private isScreenLargeEnough(): boolean {
    return window.innerWidth >= MIN_SCREEN_WIDTH;
  }

  // Called after the component's DOM is first rendered
  firstUpdated() {
    // DOM is guaranteed to be available here
    console.log("GutterAd DOM is ready");
  }

  public show(): void {
    if (!this.isScreenLargeEnough()) {
      console.log("Screen too small for gutter ads, skipping");
      return;
    }

    if (isInIframe()) {
      console.log("In iframe, showing gutter ads");
      return;
    }

    console.log("showing GutterAds");
    this.isVisible = true;
    this.requestUpdate();

    // Wait for the update to complete, then load ads
    this.updateComplete.then(() => {
      this.loadAds();
    });
  }

  public hide(): void {
    this.isVisible = false;
    console.log("hiding GutterAds");
    this.destroyAds();
    document.removeEventListener(
      "userMeResponse",
      this.boundUserMeHandler as EventListener,
    );
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
    this.hide();
  }

  render() {
    if (!this.isVisible) {
      return html``;
    }

    return html`
      <div class="fixed left-0 top-1/2 -translate-y-1/2 z-10">
        <div id="${LEFT_FUSE}" data-fuse="lhs_sticky_vrec"></div>
      </div>
      <div class="fixed right-0 top-1/2 -translate-y-1/2 z-10">
        <div id="${RIGHT_FUSE}" data-fuse="rhs_sticky_vrec"></div>
      </div>
    `;
  }
}
