import { html, LitElement, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { steamSDK } from "../SteamSDK";
import { translateText } from "../Utils";

const STEAM_APP_ID = "3560670";

/** Nominal size of Steam's store widget, as published in its embed snippet. */
const WIDGET_WIDTH = 646;
const WIDGET_HEIGHT = 190;

/**
 * Narrowest the iframe may be laid out at. Steam's widget stylesheet has a
 * `max-width: 500px` breakpoint that stacks the capsule above the description
 * and overflows the card's fixed height. Media queries inside an iframe match
 * against the iframe's own width, so staying just above the breakpoint keeps
 * the wide layout — which itself wraps down to ~340px without clipping.
 */
const WIDGET_MIN_WIDTH = 501;

/**
 * Steam's store widget for OpenFront.
 *
 * UTM parameters are forwarded by Steam into every link the widget renders
 * (store page, "Wishlist on Steam" button), so `campaign` is what shows up in
 * the Steamworks UTM analytics dashboard. Steam requires at least one of
 * utm_source / utm_campaign for a click to be attributed.
 *
 * See https://partner.steamgames.com/doc/marketing/utm_analytics
 */
export function steamWidgetUrl(campaign: string): string {
  return steamUrl(`widget/${STEAM_APP_ID}/`, "widget", campaign);
}

/** Store page for OpenFront, tagged for the same UTM dashboard. */
export function steamStoreUrl(campaign: string): string {
  return steamUrl(`app/${STEAM_APP_ID}/OpenFront/`, "link", campaign);
}

function steamUrl(path: string, medium: string, campaign: string): string {
  const params = new URLSearchParams({
    utm_source: "openfront",
    utm_medium: medium,
    utm_campaign: campaign,
  });
  return `https://store.steampowered.com/${path}?${params}`;
}

/**
 * Embeds the Steam store widget so players can wishlist without leaving the
 * game. Self-hides inside the Steam desktop build — those players arrived via
 * Steam already.
 *
 * The iframe is laid out between {@link WIDGET_MIN_WIDTH} and the widget's
 * native 646px and only downscaled once the container is narrower than that
 * floor, so text stays full size on everything but phones.
 */
@customElement("steam-wishlist")
export class SteamWishlist extends LitElement {
  /** UTM campaign identifying the placement, e.g. "homepage" or "winmodal". */
  @property({ type: String }) campaign = "";

  /**
   * Set false to keep the iframe unloaded. Placements that stay in the DOM
   * while hidden (the win modal) use this so Steam is only contacted once the
   * widget is actually on screen.
   */
  @property({ type: Boolean }) active = true;

  @state() private containerWidth = WIDGET_WIDTH;

  @query(".steam-wishlist-frame") private frame?: HTMLElement;

  private resizeObserver?: ResizeObserver;

  createRenderRoot() {
    return this;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
  }

  protected updated() {
    if (this.frame === undefined) {
      // Hidden on Steam — nothing rendered to measure.
      this.resizeObserver?.disconnect();
      this.resizeObserver = undefined;
      return;
    }
    if (this.resizeObserver === undefined) {
      this.resizeObserver = new ResizeObserver((entries) => {
        const width = entries[0]?.contentRect.width ?? 0;
        // Width is unaffected by the height we set from it, so this settles
        // after one pass.
        if (width > 0) this.containerWidth = width;
      });
      this.resizeObserver.observe(this.frame);
    }
  }

  render() {
    if (steamSDK.isOnSteam()) return nothing;

    const frameWidth = Math.min(
      WIDGET_WIDTH,
      Math.max(WIDGET_MIN_WIDTH, this.containerWidth),
    );
    const scale = Math.min(1, this.containerWidth / frameWidth);

    return html`
      <div
        class="steam-wishlist-frame w-full mx-auto overflow-hidden"
        style="max-width: ${WIDGET_WIDTH}px; height: ${WIDGET_HEIGHT * scale}px"
      >
        <iframe
          class="block border-0 origin-top-left"
          width=${frameWidth}
          height=${WIDGET_HEIGHT}
          style="transform: scale(${scale})"
          src=${this.active ? steamWidgetUrl(this.campaign) : ""}
          title=${translateText("steam_wishlist.title")}
          loading="lazy"
          scrolling="no"
        ></iframe>
      </div>
    `;
  }
}
