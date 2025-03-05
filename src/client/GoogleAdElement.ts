import { LitElement, css, html } from "lit";
import { customElement } from "lit/decorators.js";

@customElement("google-ad")
export class GoogleAdElement extends LitElement {
  createRenderRoot() {
    return this;
  }

  static styles = css`
    .google-ad-container {
      margin-top: 1rem;
      background-color: rgba(255, 255, 255, 0.1);
      border-radius: 0.5rem;
      padding: 0.5rem;
      width: 100%;
      overflow: hidden;
    }

    .dark .google-ad-container {
      background-color: rgba(0, 0, 0, 0.2);
    }
  `;

  render() {
    return html`
      <div class="google-ad-container">
        <ins
          class="adsbygoogle"
          style="display:block"
          data-ad-client="ca-pub-7035513310742290"
          data-ad-slot="rightsidebar"
          data-ad-format="auto"
          data-full-width-responsive="true"
        ></ins>
        <script>
          (adsbygoogle = window.adsbygoogle || []).push({});
        </script>
      </div>
    `;
  }
}
