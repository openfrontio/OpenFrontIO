import { assetUrl } from "@openfront/shared/AssetUrls";
import { html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  CardFx,
  cardSurface,
  onReducedMotionChange,
  playableAnimation,
} from "./CardFx";
import type { PlayerCardView } from "./PlayerCardModel";

// A player card's background: the 2800×400 master, cropped like
// `background-size: cover` (centred) to whatever box the card is, over the
// default navy fill, under a dark gradient on the left ~45% that keeps the
// badge and name readable. With no background, or one whose image fails to
// load, only the default fill shows.
//
// When `animated` is set and the background has effect layers, they load
// once the base image has and move over it (CardFx). Only the end-screen
// card, the Account header and the Inventory's large preview set it; every
// other card is still.
@customElement("card-background")
export class CardBackground extends LitElement {
  @property({ attribute: false })
  background: PlayerCardView["background"] = null;
  // Whether this card may animate.
  @property({ type: Boolean }) animated = false;

  @state() private failedUrl: string | null = null;
  @state() private loadedUrl: string | null = null;

  private fx: CardFx | null = null;
  // What the running fx was made for: name, url and animation.
  private fxKey: string | null = null;
  private unsubscribeMotion: (() => void) | null = null;

  createRenderRoot() {
    return this;
  }

  connectedCallback(): void {
    super.connectedCallback();
    // Reduced motion turned on stops this card; turned off, it starts again.
    this.unsubscribeMotion ??= onReducedMotionChange(() => this.syncFx());
    if (this.hasUpdated) this.syncFx();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubscribeMotion?.();
    this.unsubscribeMotion = null;
    this.stopFx();
  }

  protected updated(): void {
    this.syncFx();
  }

  private onError = (): void => {
    this.failedUrl = this.background?.url ?? null;
  };

  private onLoad = (): void => {
    this.loadedUrl = this.background?.url ?? null;
  };

  private stopFx(): void {
    this.fx?.destroy();
    this.fx = null;
    this.fxKey = null;
  }

  private syncFx(): void {
    const bg = this.background;
    const animation =
      bg !== null && this.isConnected
        ? playableAnimation(this.animated, bg.animation, cardSurface(this))
        : null;
    const key =
      bg === null
        ? null
        : `${bg.name}\n${bg.url}\n${JSON.stringify(bg.animation)}`;
    if (
      animation === null ||
      bg === null ||
      bg.url === this.failedUrl ||
      bg.url !== this.loadedUrl
    ) {
      this.stopFx();
      return;
    }
    if (this.fx !== null && this.fxKey === key) return;
    this.stopFx();
    const container = this.querySelector<HTMLElement>("[data-card-fx]");
    if (container === null) return;
    this.fx = new CardFx(
      this,
      container,
      animation,
      bg.name,
      cardSurface(this),
    );
    this.fxKey = key;
    this.fx.start();
  }

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
              @load=${this.onLoad}
              @error=${this.onError}
            />`
          : nothing
      }
      <div data-card-fx class="absolute inset-0"></div>
      <div
        class="absolute inset-0"
        style="background: linear-gradient(90deg, rgba(8,15,30,0.92) 0%, rgba(8,15,30,0.7) 30%, rgba(8,15,30,0) 45%)"
      ></div>
    </div>`;
  }
}
