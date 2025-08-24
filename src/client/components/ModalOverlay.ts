import { css, html, LitElement } from "lit";
import { customElement, property } from "lit/decorators";

@customElement("modal-overlay")
export class ModalOverlay extends LitElement {
  @property({ reflect: true }) public visible = false;

  static styles = css`
    .overlay {
      position: absolute;
      left: 0px;
      top: 0px;
      width: 100%;
      height: 100%;
    }
  `;

  render() {
    return html`
      <div
        class="overlay ${this.visible ? "" : "hidden"}"
        @click=${() => (this.visible = false)}
      ></div>
    `;
  }
}
