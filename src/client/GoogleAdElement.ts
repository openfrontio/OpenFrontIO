import { LitElement, html, css } from "lit";

declare global {
  interface Window {
    adsbygoogle: any[];
  }
}
import { customElement, property } from "lit/decorators.js";

/**
 * Google AdSense integration component
 *
 * This component creates a configurable container for Google AdSense ads
 * and properly initializes them after the component is rendered.
 */
@customElement("google-ad")
export class GoogleAdElement extends LitElement {
  // Configurable properties
  @property({ type: String }) adClient = "ca-pub-7035513310742290";
  @property({ type: String }) adSlot = "5220834834";
  @property({ type: String }) adFormat = "auto";
  @property({ type: Boolean }) fullWidthResponsive = true;
  @property({ type: String }) adTest = "off"; // "on" for testing, remove or set to "off" for production
  @property({ type: String }) backgroundColor = "rgba(255, 255, 255, 0.1)";
  @property({ type: String }) darkBackgroundColor = "rgba(0, 0, 0, 0.2)";

  // Disable shadow DOM so AdSense can access the elements
  createRenderRoot() {
    return this;
  }

  static styles = css`
    .google-ad-container {
      margin-top: 1rem;
      border-radius: 0.5rem;
      padding: 0.5rem;
      width: 100%;
      overflow: hidden;
      transition:
        opacity 0.3s ease,
        height 0.3s ease;
    }
    .google-ad-container.hidden {
      opacity: 0;
      height: 0;
      padding: 0;
      margin: 0;
      overflow: hidden;
    }
  `;

  render() {
    // Apply background color dynamically
    const containerStyle = `
      background-color: ${this.backgroundColor};
    `;

    return html`
      <div class="google-ad-container" style="${containerStyle}">
        <ins
          class="adsbygoogle"
          style="display:block"
          data-ad-client="${this.adClient}"
          data-ad-slot="${this.adSlot}"
          data-ad-format="${this.adFormat}"
          data-full-width-responsive="${this.fullWidthResponsive}"
          data-adtest="${this.adTest}"
        ></ins>
      </div>
    `;
  }

  connectedCallback() {
    super.connectedCallback();

    // Wait for the component to be fully rendered
    setTimeout(() => {
      try {
        // Initialize this specific ad
        (window.adsbygoogle = window.adsbygoogle || []).push({});
        console.log("Ad initialized for slot:", this.adSlot);
      } catch (e) {
        console.error("AdSense initialization error for slot:", this.adSlot, e);
      }
    }, 100);
  }
}
export default GoogleAdElement;
