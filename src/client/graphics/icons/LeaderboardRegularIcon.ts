import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("leaderboard-regular-icon")
export class LeaderboardRegularIcon extends LitElement {
  @property({ type: String }) size = "24"; // Accepts "24", "32", etc.
  @property({ type: String }) color = "currentColor";

  static styles = css`
    :host {
      display: inline-block;
      vertical-align: middle;
    }
    svg {
      display: block;
    }
  `;

  render() {
    return html`
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="${this.size}"
        height="${this.size}"
        viewBox="0 0 24 24"
        fill="${this.color}"
      >
        <path
          fill="currentColor"
          d="M4 19h4v-8H4zm6 0h4V5h-4zm6 0h4v-6h-4zM2 21V9h6V3h8v8h6v10z"
        />
      </svg>
    `;
  }
}
