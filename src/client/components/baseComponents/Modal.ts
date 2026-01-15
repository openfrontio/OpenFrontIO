import { LitElement, html, unsafeCSS } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import tailwindStyles from "../../styles.css?inline";

@customElement("o-modal")
export class OModal extends LitElement {
  static styles = [unsafeCSS(tailwindStyles)];

  @state() public isModalOpen = false;

  static openCount = 0;

  @property({ type: Boolean })
  public inline = false;

  @property({ type: Boolean })
  public alwaysMaximized = false;

  @property({ type: Boolean })
  public hideCloseButton = false;

  @property({ type: String })
  public title = "";

  @property({ type: Boolean })
  public hideHeader = false;

  @property({ type: String })
  public maxWidth = "";

  public onClose?: () => void;

  public open() {
    if (!this.isModalOpen) {
      if (!this.inline) {
        OModal.openCount = OModal.openCount + 1;
        if (OModal.openCount === 1) document.body.style.overflow = "hidden";
      }
      this.isModalOpen = true;
    }
  }

  public close() {
    if (this.isModalOpen) {
      this.isModalOpen = false;
      this.onClose?.();
      if (!this.inline) {
        OModal.openCount = Math.max(0, OModal.openCount - 1);
        if (OModal.openCount === 0) document.body.style.overflow = "";
      }
    }
  }

  disconnectedCallback() {
    // Ensure global counter is decremented if this modal is removed while open.
    if (this.isModalOpen && !this.inline) {
      OModal.openCount = Math.max(0, OModal.openCount - 1);
      if (OModal.openCount === 0) document.body.style.overflow = "";
    }
    super.disconnectedCallback();
  }

  render() {
    const backdropClass = this.inline
      ? "relative z-10 w-full h-full flex items-stretch bg-transparent"
      : "fixed inset-0 z-[9999] bg-black/70 flex items-center justify-center overflow-hidden";

    const wrapperClass = this.inline
      ? "relative flex flex-col w-full h-full m-0 max-w-full max-h-none shadow-none"
      : `relative flex flex-col w-[90%] min-w-[400px] max-w-[900px] m-8 rounded-lg shadow-[0_20px_60px_rgba(0,0,0,0.8)] max-h-[calc(100vh-4rem)] ${
          this.alwaysMaximized ? "h-auto" : ""
        }`;
    const wrapperStyle =
      !this.inline && this.maxWidth ? `max-width: ${this.maxWidth};` : "";

    return html`
      ${this.isModalOpen
        ? html`
            <aside
              class="${backdropClass}"
              @click=${this.inline ? null : () => this.close()}
            >
              <div
                @click=${(e: Event) => e.stopPropagation()}
                class="${wrapperClass}"
                style="${wrapperStyle}"
              >
                ${this.inline || this.hideCloseButton
                  ? html``
                  : html`<div
                      class="absolute top-5 right-5 z-10 text-white cursor-pointer"
                      @click=${() => this.close()}
                    >
                      ✕
                    </div>`}
                ${!this.hideHeader && this.title
                  ? html`<div
                      class="px-[1.4rem] py-[1rem] pt-0 text-2xl font-bold text-white"
                    >
                      ${this.title}
                    </div>`
                  : html``}
                <section
                  class="relative flex-1 min-h-0 p-[1.4rem] text-white bg-[#23232382] backdrop-blur-md rounded-lg overflow-y-auto"
                >
                  <slot></slot>
                </section>
              </div>
            </aside>
          `
        : html``}
    `;
  }
}
