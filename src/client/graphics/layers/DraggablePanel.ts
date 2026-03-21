import { html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { translateText } from "../../Utils";
import { DraggableController } from "../DraggableController";

/**
 * Non-wrapper element: place inside a panel and it renders a lock/reset
 * toolbar on the outside edge. Drag behaviour is applied to the nearest
 * ancestor with a matching `data-draggable` attribute.
 */
@customElement("draggable-panel")
export class DraggablePanel extends LitElement {
  @property({ type: String }) key = "panel";
  @property({ type: Boolean }) visible = true;

  @state() private _locked = false;

  private ctrl: DraggableController | null = null;
  private _observer: MutationObserver | null = null;

  createRenderRoot() {
    return this;
  }

  connectedCallback(): void {
    super.connectedCallback();
    if (document.body.classList.contains("in-game")) {
      this.initController();
    } else {
      this._observer = new MutationObserver(() => {
        if (document.body.classList.contains("in-game")) {
          this.initController();
          this._observer?.disconnect();
          this._observer = null;
        }
      });
      this._observer.observe(document.body, {
        attributes: true,
        attributeFilter: ["class"],
      });
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.ctrl?.detach();
    this._observer?.disconnect();
  }

  private initController(): void {
    if (this.ctrl) return;
    const target = this.closest(`[data-draggable="${this.key}"]`);
    if (!target) {
      console.error(
        `draggable-panel: no ancestor [data-draggable="${this.key}"] found`,
      );
      return;
    }

    this.ctrl = new DraggableController(target as HTMLElement, this.key);
    this._locked = this.ctrl.locked;
    this.ctrl.onMoved = () => this.requestUpdate();
    this.ctrl.onResize = () => this.requestUpdate();
    this.ctrl.attach();
    this.requestUpdate();
  }

  private toggleLock(): void {
    if (!this.ctrl) return;
    this._locked = !this._locked;
    this.ctrl.locked = this._locked;
    this.requestUpdate();
  }

  private resetPosition(): void {
    this.ctrl?.resetPosition();
    this.requestUpdate();
  }

  render() {
    if (!this.ctrl || !this.visible) return nothing;
    if (this.ctrl.getElement().getBoundingClientRect().height < 10)
      return nothing;
    const right = !this.ctrl.isOnRightSide();
    return html`
      <div
        class="flex items-center absolute top-1/2 -translate-y-1/2 z-[12]
               pointer-events-auto rounded-md bg-gray-800/95 backdrop-blur-sm
               border border-white/15 px-0.5 py-1
               ${this._locked ? "opacity-40 hover:opacity-100" : ""}
               ${right
          ? "right-0 translate-x-full rounded-l-none border-l-0"
          : "left-0 -translate-x-full rounded-r-none border-r-0"}"
      >
        ${this._locked
          ? nothing
          : html`<button
              class="flex items-center justify-center size-4
                     text-gray-400 hover:text-white cursor-pointer transition-colors"
              @pointerdown=${(e: Event) => e.stopPropagation()}
              @click=${(e: Event) => {
                e.stopPropagation();
                this.resetPosition();
              }}
              title=${translateText("draggable_panel.reset_position")}
            >
              ${DraggablePanel.resetSvg}
            </button>`}
        <button
          class="flex items-center justify-center size-4
                 ${this._locked
            ? "text-gray-400"
            : "text-yellow-400"} hover:text-white cursor-pointer transition-colors"
          @pointerdown=${(e: Event) => e.stopPropagation()}
          @click=${(e: Event) => {
            e.stopPropagation();
            this.toggleLock();
          }}
          title=${this._locked
            ? translateText("draggable_panel.unlock_to_move")
            : translateText("draggable_panel.lock_position")}
        >
          ${this._locked ? DraggablePanel.lockSvg : DraggablePanel.unlockSvg}
        </button>
      </div>
    `;
  }

  private static lockSvg = html`<svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    class="size-3"
  >
    <path
      fill-rule="evenodd"
      d="M12 1.5a5.25 5.25 0 0 0-5.25 5.25v3a3 3 0 0 0-3 3v6.75a3 3 0 0 0 3 3h10.5a3 3 0 0 0 3-3v-6.75a3 3 0 0 0-3-3v-3A5.25 5.25 0 0 0 12 1.5Zm3.75 8.25v-3a3.75 3.75 0 1 0-7.5 0v3h7.5Z"
      clip-rule="evenodd"
    />
  </svg>`;

  private static unlockSvg = html`<svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    class="size-3.5"
  >
    <path
      d="M18 1.5c2.9 0 5.25 2.35 5.25 5.25v3.75a.75.75 0 0 1-1.5 0V6.75a3.75 3.75 0 1 0-7.5 0v3h1.5a3 3 0 0 1 3 3v6.75a3 3 0 0 1-3 3H5.25a3 3 0 0 1-3-3v-6.75a3 3 0 0 1 3-3h7.5v-3A5.25 5.25 0 0 1 18 1.5Z"
    />
  </svg>`;

  private static resetSvg = html`<svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    class="size-3.5"
  >
    <path
      fill-rule="evenodd"
      d="M4.755 10.059a7.5 7.5 0 0 1 12.548-3.364l1.903 1.903H14.25a.75.75 0 0 0 0 1.5h6a.75.75 0 0 0 .75-.75v-6a.75.75 0 0 0-1.5 0v4.956l-1.903-1.903A9 9 0 0 0 3.306 9.67a.75.75 0 1 0 1.45.388Zm14.49 3.882a7.5 7.5 0 0 1-12.548 3.364l-1.903-1.903H9.75a.75.75 0 0 0 0-1.5h-6a.75.75 0 0 0-.75.75v6a.75.75 0 0 0 1.5 0v-4.956l1.903 1.903A9 9 0 0 0 20.694 14.33a.75.75 0 1 0-1.45-.388Z"
      clip-rule="evenodd"
    />
  </svg>`;
}
