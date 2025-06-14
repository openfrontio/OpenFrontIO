import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("leaderboard-solid-icon")
export class LeaderboardSolidIcon extends LitElement {
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
          d="M2 21V9h5.5v12zm7.25 0V3h5.5v18zm7.25 0V11H22v10z"
        />
      </svg>
    `;
  }
}
