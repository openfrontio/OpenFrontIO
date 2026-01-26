import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";

const VIDEO_AD_UNIT_TYPE = "precontent_ad_video";

@customElement("video-ad")
export class VideoAd extends LitElement {
  @state()
  private isVisible: boolean = true;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.showVideoAd();
  }

  public showVideoAd(): void {
    if (!window.ramp) {
      // Wait for ramp to be available
      const checkRamp = setInterval(() => {
        if (window.ramp && window.ramp.que) {
          clearInterval(checkRamp);
          this.loadVideoAd();
        }
      }, 100);
      return;
    }

    this.loadVideoAd();
  }

  private loadVideoAd(): void {
    // Set up event listeners when player is ready
    window.ramp.onPlayerReady = () => {
      if (window.Bolt) {
        window.Bolt.on(VIDEO_AD_UNIT_TYPE, window.Bolt.BOLT_AD_COMPLETE, () => {
          console.log("[VideoAd] Ad completed");
          this.isVisible = false;
        });

        window.Bolt.on(VIDEO_AD_UNIT_TYPE, window.Bolt.BOLT_AD_ERROR, () => {
          console.log("[VideoAd] Ad error/no fill");
          this.isVisible = false;
        });

        window.Bolt.on(
          VIDEO_AD_UNIT_TYPE,
          window.Bolt.SHOW_HIDDEN_CONTAINER ?? "showHiddenContainer",
          () => {
            console.log("[VideoAd] Ad finished");
            this.isVisible = false;
          },
        );
      }
    };

    // Queue the video ad initialization
    window.ramp.que.push(() => {
      const pwUnits = [{ type: VIDEO_AD_UNIT_TYPE }];

      window.ramp
        .addUnits(pwUnits)
        .then(() => {
          window.ramp.displayUnits();
        })
        .catch((e: Error) => {
          console.error("[VideoAd] Error adding units:", e);
          window.ramp.displayUnits();
        });
    });
  }

  render() {
    if (!this.isVisible) {
      return html``;
    }

    // Provide a container for the Playwire video player to render into
    return html`
      <div
        id="precontent-video-location"
        class="fixed inset-0 z-[99999] flex items-center justify-center"
        style="background: rgba(0,0,0,0.9);"
      ></div>
    `;
  }
}
