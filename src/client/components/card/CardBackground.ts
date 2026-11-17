import { assetUrl } from "@openfront/shared/AssetUrls";
import { html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { PlayerCardView } from "./PlayerCardModel";

// A player card's background: the 2800×400 master, cropped like
// `background-size: cover` (centred) to whatever box the card is, over the
// default navy fill, under a dark gradient on the left ~45% that keeps the
// badge and name readable. With no background, or one whose image fails to
// load, only the default fill shows.
//
// Static only for now; animated layers come with the animated backgrounds.
@customElement("card-background")
export class CardBackground extends LitElement {
  @property({ attribute: false })
  background: PlayerCardView["background"] = null;
  // Whether this card may animate. Unused until backgrounds animate.
  @property({ type: Boolean }) animated = false;

  @state() private failedUrl: string | null = null;

  createRenderRoot() {
    return this;
  }

  private onError = (): void => {
    this.failedUrl = this.background?.url ?? null;
  };

  render() {
    const bg = this.background;
    const showImage = bg !== null && bg.url !== this.failedUrl;
    return html`<div
      aria-hidden="true"
      class="pointer-events-none absolute inset-0 overflow-hidden"
    >
      <div
        data-card-bg-default
        class="absolute inset-0 bg-gradient-to-br from-[#0b1424] to-[#132644]"
      ></div>
      ${
        showImage
          ? html`<img
              data-card-bg-base
              class="absolute inset-0 h-full w-full object-cover object-center"
              src=${assetUrl(bg.url)}
              alt=""
              decoding="async"
              @error=${this.onError}
            />`
          : nothing
      }
      <div
        class="absolute inset-0"
        style="background: linear-gradient(90deg, rgba(8,15,30,0.92) 0%, rgba(8,15,30,0.7) 30%, rgba(8,15,30,0) 45%)"
      ></div>
    </div>`;
  }
}
