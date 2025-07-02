// src/components/icons/IconUsers.ts
import { LitElement, css, html } from "lit";
import { customElement } from "lit/decorators.js";

@customElement("my-icon-users")
export class IconUsers extends LitElement {
  static styles = css`
    :host {
      display: inline-block;
    }
    svg {
      width: 1em;
      height: 1em;
      fill: currentColor;
    }
  `;

  render() {
    return html`
      <svg
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path
          d="M12 12c2.7 0 5-2.3 5-5s-2.3-5-5-5-5 2.3-5 5 2.3 5 5 5zm0 2c-3.3 0-10 1.7-10 5v3h20v-3c0-3.3-6.7-5-10-5z"
        />
      </svg>
    `;
  }
}
