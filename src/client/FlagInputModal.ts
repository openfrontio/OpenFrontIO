import { LitElement, html } from "lit";
import { customElement, query } from "lit/decorators.js";

@customElement("flag-input-modal")
export class FlagInputModal extends LitElement {
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };

  createRenderRoot() {
    return this;
  }

  render() {
    return html`
      <o-modal title="Flag Selector Modal">
        <div class="text-center text-2xl font-bold my-4">
          Flag Selector Modal
        </div>
      </o-modal>
    `;
  }

  public open() {
    this.modalEl?.open();
  }

  public close() {
    this.modalEl?.close();
  }
}
