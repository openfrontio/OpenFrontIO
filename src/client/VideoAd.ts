import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";

const VIDEO_AD_UNIT_TYPE = "precontent_ad_video";

@customElement("video-ad")
export class VideoAd extends LitElement {
  @state()
  private isVisible: boolean = false;

  @state()
  private adStatus: string = "initializing";

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    // Start video ad on page load for testing
    this.showVideoAd();
  }

  public showVideoAd(): void {
    console.log("[VideoAd] Starting video ad");
    this.isVisible = true;
    this.adStatus = "loading";
    this.requestUpdate();

    this.updateComplete.then(() => {
      this.loadVideoAd();
    });
  }

  private loadVideoAd(): void {
    if (!window.ramp) {
      console.warn("[VideoAd] Playwire RAMP not available");
      this.adStatus = "ramp not available";
      return;
    }

    console.log("[VideoAd] ramp object:", window.ramp);
    console.log("[VideoAd] Bolt object:", window.Bolt);

    // Add and display the video ad unit
    window.ramp.que.push(() => {
      console.log("[VideoAd] Inside ramp queue");

      // Set up event listeners when player is ready
      window.ramp.onPlayerReady = () => {
        console.log("[VideoAd] Player ready, setting up event listeners");
        console.log("[VideoAd] Bolt available:", !!window.Bolt);

        if (!window.Bolt) {
          console.error("[VideoAd] Bolt not available");
          return;
        }

        window.Bolt.on(
          VIDEO_AD_UNIT_TYPE,
          window.Bolt.BOLT_AD_REQUEST_START,
          () => {
            console.log("[VideoAd] Ad request started");
            this.adStatus = "requesting ad";
            this.requestUpdate();
          },
        );

        window.Bolt.on(VIDEO_AD_UNIT_TYPE, window.Bolt.BOLT_AD_STARTED, () => {
          console.log("[VideoAd] Ad started playing");
          this.adStatus = "playing";
          this.requestUpdate();
        });

        window.Bolt.on(VIDEO_AD_UNIT_TYPE, window.Bolt.BOLT_AD_COMPLETE, () => {
          console.log("[VideoAd] Ad completed");
          this.adStatus = "completed";
          this.hideVideoAd();
        });

        window.Bolt.on(VIDEO_AD_UNIT_TYPE, window.Bolt.BOLT_AD_ERROR, () => {
          console.log("[VideoAd] Ad error");
          this.adStatus = "error";
          this.hideVideoAd();
        });

        window.Bolt.on(VIDEO_AD_UNIT_TYPE, "showHiddenContainer", () => {
          console.log("[VideoAd] showHiddenContainer - ad finished or no fill");
          this.hideVideoAd();
        });
      };

      try {
        console.log("[VideoAd] Adding video ad unit:", VIDEO_AD_UNIT_TYPE);
        this.adStatus = "adding units";
        this.requestUpdate();

        window.ramp
          .addUnits([{ type: VIDEO_AD_UNIT_TYPE }])
          .then(() => {
            console.log("[VideoAd] Units added, now displaying");
            this.adStatus = "displaying";
            this.requestUpdate();
            window.ramp.displayUnits();
          })
          .catch((err: Error) => {
            console.error("[VideoAd] Failed to add units:", err);
            this.adStatus = "failed: " + err.message;
            this.requestUpdate();
          });
      } catch (e) {
        console.error("[VideoAd] Error loading video ad:", e);
        this.adStatus = "error: " + String(e);
        this.requestUpdate();
      }
    });

    console.log(
      "[VideoAd] Queued video ad load, queue length:",
      window.ramp.que.length,
    );
  }

  private hideVideoAd(): void {
    console.log("[VideoAd] Hiding video ad overlay");
    this.isVisible = false;
    this.requestUpdate();
  }

  render() {
    if (!this.isVisible) {
      return html``;
    }

    return html`
      <div
        id="video-ad-overlay"
        class="fixed inset-0 z-[99999] bg-black flex items-center justify-center"
      >
        <div class="text-white text-center">
          <p class="text-lg mb-4">Video Ad - Status: ${this.adStatus}</p>
          <div id="video-ad-container" class="w-full max-w-2xl"></div>
        </div>
      </div>
    `;
  }
}
