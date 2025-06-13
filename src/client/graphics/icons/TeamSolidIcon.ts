import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("team-solid-icon")
export class TeamSolidIcon extends LitElement {
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
          d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3s1.34 3 3 3m-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5S5 6.34 5 8s1.34 3 3 3m0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5m8 0c-.29 0-.62.02-.97.05c1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5"
        />
      </svg>
    `;
  }
}
