import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";

/**
 * A reusable icon component with error handling and styling support.
 * @attr {String} src - Path to the icon (e.g., 'icons/users.svg').
 * @attr {String} size - Size of the icon ('small', 'medium', 'large' or custom CSS value).
 * @attr {String} color - Color of the icon (CSS color value or CSS custom property).
 */
@customElement("o-icon")
export class OIcon extends LitElement {
  @property({ type: String, reflect: true }) src = "";
  @property({ type: String, reflect: true }) size = "medium";
  @property({ type: String, reflect: true }) color = "var(--text-color-light)";

  // State for icon loading status
  @state() private iconError = false;
  @state() private svgContent = "";

  static styles = css`
    :host {
      display: inline-block;
      width: var(--icon-size, 18px);
      height: var(--icon-size, 18px);
    }

    :host([size="small"]) {
      --icon-size: 14px;
    }

    :host([size="medium"]) {
      --icon-size: 18px;
    }

    :host([size="large"]) {
      --icon-size: 24px;
    }

    :host([size="extra-large"]) {
      --icon-size: 36px;
    }

    .c-icon {
      width: 100%;
      height: 100%;
      display: inline-block;
    }

    .c-icon svg {
      width: 100%;
      height: 100%;
      fill: none;
      stroke: var(--icon-color, var(--text-color-light));
      stroke-width: 2;
    }

    /* Hide when there's an error or no content */
    :host([hidden]) {
      display: none !important;
    }
  `;

  // Load SVG content
  private async _loadSVG(iconPath: string): Promise<void> {
    try {
      const response = await fetch(iconPath);
      if (!response.ok) {
        throw new Error(`Failed to load icon: ${response.status}`);
      }
      const svgText = await response.text();

      if (!svgText.trim().startsWith("<svg")) {
        throw new Error("Invalid SVG content");
      }

      this.svgContent = svgText;
      this.iconError = false;
      this.removeAttribute("hidden");
    } catch (error) {
      console.warn(`Failed to load icon: ${iconPath}`, error);
      this.iconError = true;
      this.svgContent = "";
      this.setAttribute("hidden", "");
    }
  }

  // Watch for property changes
  async updated(changedProperties: Map<string | number | symbol, unknown>) {
    if (changedProperties.has("src")) {
      if (this.src) {
        this.iconError = false;
        this.svgContent = "";
        this.removeAttribute("hidden");
        await this._loadSVG(this.src);
      } else {
        this.iconError = false;
        this.svgContent = "";
        this.setAttribute("hidden", "");
      }
    }

    if (changedProperties.has("color")) {
      this.style.setProperty("--icon-color", this.color);
    }

    if (changedProperties.has("size")) {
      if (!["small", "medium", "large", "extra-large"].includes(this.size)) {
        this.style.setProperty("--icon-size", this.size);
      }
    }
  }

  render() {
    if (!this.src || this.iconError || !this.svgContent) {
      return html``;
    }

    return html` <span class="c-icon"> ${unsafeHTML(this.svgContent)} </span> `;
  }
}
