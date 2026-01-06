import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators";

@customElement("modal-overlay")
export class ModalOverlay extends LitElement {
  @property({ reflect: true }) public visible: boolean = false;

  createRenderRoot() {
    return this;
  }

  render() {
    return html`
      <div
        class="absolute left-0 top-0 w-full h-full ${this.visible
          ? ""
          : "hidden"}"
        @click=${() => (this.visible = false)}
      ></div>
    `;
  }
}
