import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { translateText } from "../../Utils";

export const OFSTATS_HOW_IT_WORKS_URL =
  "https://ofstats.io/leaderboard/how-it-works";

/** "Rating by OFstats" link, shown wherever an FFA rating appears. */
@customElement("ofstats-credit")
export class OfstatsCredit extends LitElement {
  createRenderRoot() {
    return this;
  }

  render() {
    return html`<a
      data-ofstats-credit
      href=${OFSTATS_HOW_IT_WORKS_URL}
      target="_blank"
      rel="noopener noreferrer"
      class="text-xs font-medium text-malibu-blue no-underline transition-colors duration-200 hover:text-aquarius"
      >${translateText("ffa_rating.credit")}</a
    >`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "ofstats-credit": OfstatsCredit;
  }
}
