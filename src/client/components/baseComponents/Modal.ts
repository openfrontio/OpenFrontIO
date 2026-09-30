import { LitElement, css, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { documentStylesSheet } from "./SharedStyles";

export type OModalTab = { key: string; label: string };

@customElement("o-modal")
export class OModal extends LitElement {
  static styles = [
    documentStylesSheet(),
    css`
      .compact-backdrop {
        background: transparent;
      }
      .compact-wrapper {
        width: min(680px, calc(100% - 24px));
        min-width: 0;
        height: auto;
        margin: 12px;
        max-height: min(560px, calc(100dvh - 32px));
        border-radius: 16px;
        overflow: hidden;
        background: rgb(15 23 35 / var(--modal-background-opacity, 0.8));
        border: 1px solid rgb(255 255 255 / 0.16);
        box-shadow: 0 12px 40px rgb(0 0 0 / 0.3);
        backdrop-filter: blur(8px);
      }
      .compact-header {
        padding-inline-end: 60px;
        font-size: 1.125rem;
      }
      .compact-section {
        background: transparent;
        backdrop-filter: none;
        border: 0;
      }
      .compact-close {
        position: absolute;
        inset-inline-end: 12px;
        top: 12px;
        z-index: 10;
        width: 36px;
        height: 36px;
        border-radius: 8px;
        color: white;
        cursor: pointer;
      }
      .compact-close:hover,
      .compact-close:focus-visible {
        background: rgb(255 255 255 / 0.12);
      }
    `,
  ];

  @property({ type: Boolean })
  public compact = false;

  @property({ type: String })
  public closeLabel = "";

  @state() public isModalOpen = false;

  @query("[data-modal-scroll]") private scrollContainer?: HTMLElement;

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

  @property({ type: Array })
  public tabs: OModalTab[] = [];

  @property({ type: String })
  public activeTab = "";

  @property({ attribute: false })
  public onTabChange?: (key: string) => void;

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

  public getScrollTop(): number {
    return this.scrollContainer?.scrollTop ?? 0;
  }

  public setScrollTop(scrollTop: number): void {
    if (this.scrollContainer) {
      this.scrollContainer.scrollTop = scrollTop;
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

  private handleTabClick(key: string) {
    this.onTabChange?.(key);
  }

  private renderTabs() {
    return html`
      <div
        role="tablist"
        class="flex flex-wrap justify-center border-b border-white/10 px-4 lg:px-6 gap-1 shrink-0"
      >
        ${this.tabs.map((tab) => {
          const active = this.activeTab === tab.key;
          return html`
            <button
              type="button"
              role="tab"
              data-key=${tab.key}
              aria-selected=${active}
              class="px-4 py-3 text-sm font-bold uppercase tracking-wider transition-all relative cursor-pointer ${active
                ? "text-aquarius"
                : "text-white/40 hover:text-white/70"}"
              @click=${() => this.handleTabClick(tab.key)}
            >
              ${tab.label}
              ${active
                ? html`<div
                    class="absolute bottom-0 left-0 right-0 h-0.5 bg-malibu-blue"
                  ></div>`
                : ""}
            </button>
          `;
        })}
      </div>
    `;
  }

  render() {
    const shouldRender = this.isModalOpen || this.inline;
    if (!shouldRender) {
      return html``;
    }

    const backdropClass = this.inline
      ? "relative z-10 w-full h-full flex items-stretch bg-transparent"
      : "fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center overflow-hidden";

    const wrapperClass = this.inline
      ? "relative flex flex-col w-full h-full m-0 max-w-full max-h-none shadow-none"
      : `relative flex flex-col w-full h-full lg:w-[90%] lg:h-auto lg:min-w-[400px] lg:max-w-[900px] lg:m-8 lg:rounded-lg lg:max-h-[calc(100vh-4rem)] ${
          this.alwaysMaximized ? "h-auto" : ""
        }`;
    const wrapperStyle =
      !this.inline && this.maxWidth ? `max-width: ${this.maxWidth};` : "";

    const hasTabs = this.tabs.length > 0;
    const sectionClass =
      "relative flex-1 min-h-0 flex flex-col text-white bg-black/70 backdrop-blur-xl lg:rounded-2xl lg:border border-white/10 overflow-hidden";

    return html`
      <aside
        class="${backdropClass} ${this.compact ? "compact-backdrop" : ""}"
        @click=${this.inline ? null : () => this.close()}
      >
        <div
          @click=${(e: Event) => e.stopPropagation()}
          class="${wrapperClass} ${this.compact ? "compact-wrapper" : ""}"
          style="${wrapperStyle}"
          role=${this.compact ? "dialog" : nothing}
          aria-label=${this.compact ? this.title : nothing}
        >
          ${this.compact && !this.inline && !this.hideCloseButton
            ? html`<button
                class="compact-close"
                type="button"
                aria-label=${this.closeLabel}
                @click=${() => this.close()}
              >
                ✕
              </button>`
            : this.inline || this.hideCloseButton
              ? html``
              : html`<div
                  class="absolute top-5 right-5 z-10 text-white cursor-pointer"
                  @click=${() => this.close()}
                >
                  ✕
                </div>`}
          ${!this.hideHeader && this.title
            ? html`<div
                class="px-[1.4rem] py-[1rem] text-2xl font-bold text-white ${this
                  .compact
                  ? "compact-header"
                  : ""}"
              >
                ${this.title}
              </div>`
            : html``}
          <section
            class="${sectionClass} ${this.compact ? "compact-section" : ""}"
          >
            <slot name="header"></slot>
            ${hasTabs ? this.renderTabs() : html``}
            <div data-modal-scroll class="flex-1 min-h-0 overflow-y-auto">
              <slot></slot>
            </div>
            <slot name="footer"></slot>
          </section>
        </div>
      </aside>
    `;
  }
}
