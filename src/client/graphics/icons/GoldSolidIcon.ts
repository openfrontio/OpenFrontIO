import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("gold-solid-icon")
export class GoldSolidIcon extends LitElement {
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
          d="m1 22l1.5-5h7l1.5 5zm12 0l1.5-5h7l1.5 5zm-7-7l1.5-5h7l1.5 5zm17-8.95l-3.86 1.09L18.05 11l-1.09-3.86l-3.86-1.09l3.86-1.09l1.09-3.86l1.09 3.86z"
        />
      </svg>
    `;
  }
}
