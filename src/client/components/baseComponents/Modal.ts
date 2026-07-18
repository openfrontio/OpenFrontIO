import { LitElement, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { translateText } from "../../Utils";
import { documentStylesSheet } from "./SharedStyles";

export type OModalTab = { key: string; label: string };

@customElement("o-modal")
export class OModal extends LitElement {
  static styles = [documentStylesSheet()];
  private static openStack: OModal[] = [];
  private static openRevision = 0;
  private static nextTitleId = 0;

  @state() public isModalOpen = false;

  @query("[data-modal-scroll]") private scrollContainer?: HTMLElement;

  private readonly titleId = `o-modal-title-${++OModal.nextTitleId}`;
  private invokingElement: HTMLElement | null = null;

  static openCount = 0;

  @property({ type: Boolean })
  public inline = false;

  @property({ type: Boolean })
  public alwaysMaximized = false;

  @property({ type: Boolean })
  public hideCloseButton = false;

  @property({ type: String })
  public title = "";

  @property({ type: String })
  public accessibleLabel = "";

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
        this.invokingElement = this.getDeepActiveElement();
        OModal.openStack = OModal.openStack.filter((modal) => modal !== this);
        OModal.openStack.push(this);
        OModal.openRevision += 1;
        window.addEventListener("keydown", this.handleKeyDown);
        OModal.openCount = OModal.openCount + 1;
        if (OModal.openCount === 1) document.body.style.overflow = "hidden";
      }
      this.isModalOpen = true;
      void this.updateComplete.then(() => {
        if (this.isTopmost()) this.focusInitialControl();
      });
    }
  }

  public close() {
    if (this.isModalOpen) {
      const wasTopmost = this.isTopmost();
      const invokingElement = this.takeInvokingElement();
      this.isModalOpen = false;
      OModal.openStack = OModal.openStack.filter((modal) => modal !== this);
      const nextTopmost = OModal.openStack[OModal.openStack.length - 1];
      const openRevisionBeforeOnClose = OModal.openRevision;
      window.removeEventListener("keydown", this.handleKeyDown);
      this.onClose?.();
      if (!this.inline) {
        OModal.openCount = Math.max(0, OModal.openCount - 1);
        if (OModal.openCount === 0) document.body.style.overflow = "";
        const noNewerModalOpened =
          OModal.openRevision === openRevisionBeforeOnClose &&
          OModal.openStack[OModal.openStack.length - 1] === nextTopmost;
        this.restoreInvokingFocus(
          invokingElement,
          wasTopmost && noNewerModalOpened,
        );
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
      const wasTopmost = this.isTopmost();
      const invokingElement = this.takeInvokingElement();
      OModal.openStack = OModal.openStack.filter((modal) => modal !== this);
      window.removeEventListener("keydown", this.handleKeyDown);
      OModal.openCount = Math.max(0, OModal.openCount - 1);
      if (OModal.openCount === 0) document.body.style.overflow = "";
      this.restoreInvokingFocus(invokingElement, wasTopmost);
    }
    super.disconnectedCallback();
  }

  private isTopmost(): boolean {
    return (
      this.isModalOpen && OModal.openStack[OModal.openStack.length - 1] === this
    );
  }

  private getDeepActiveElement(): HTMLElement | null {
    let active: Element | null = document.activeElement;
    while (active instanceof HTMLElement && active.shadowRoot?.activeElement) {
      active = active.shadowRoot.activeElement;
    }
    return active instanceof HTMLElement && active !== document.body
      ? active
      : null;
  }

  private takeInvokingElement(): HTMLElement | null {
    const invokingElement = this.invokingElement;
    this.invokingElement = null;
    return invokingElement;
  }

  private restoreInvokingFocus(
    invokingElement: HTMLElement | null,
    shouldRestore: boolean,
  ): void {
    if (shouldRestore && invokingElement?.isConnected) invokingElement.focus();
  }

  private focusInitialControl(): void {
    const closeButton = this.renderRoot.querySelector<HTMLButtonElement>(
      "button[data-modal-close]",
    );
    const firstFocusable = closeButton ?? this.focusableElements()[0];
    const dialog =
      this.renderRoot.querySelector<HTMLElement>("[data-modal-panel]");
    (firstFocusable ?? dialog)?.focus();
  }

  private focusableElements(): HTMLElement[] {
    const dialog =
      this.renderRoot.querySelector<HTMLElement>("[data-modal-panel]");
    if (!dialog) return [];

    const focusable: HTMLElement[] = [];
    const visit = (element: Element): void => {
      if (
        element instanceof HTMLElement &&
        !element.hidden &&
        element.getAttribute("aria-hidden") !== "true" &&
        !("disabled" in element && element.disabled === true) &&
        element.tabIndex >= 0
      ) {
        focusable.push(element);
      }

      if (element instanceof HTMLSlotElement) {
        const assigned = element.assignedElements({ flatten: true });
        const children = assigned.length > 0 ? assigned : element.children;
        for (const child of children) visit(child);
        return;
      }

      if (element instanceof HTMLElement && element.shadowRoot) {
        for (const child of element.shadowRoot.children) visit(child);
        return;
      }

      for (const child of element.children) visit(child);
    };

    visit(dialog);
    return focusable;
  }

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Tab" || !this.isTopmost()) return;

    const focusable = this.focusableElements();
    const dialog =
      this.renderRoot.querySelector<HTMLElement>("[data-modal-panel]");
    if (focusable.length === 0) {
      event.preventDefault();
      dialog?.focus();
      return;
    }

    const active = this.getDeepActiveElement();
    const currentIndex = active ? focusable.indexOf(active) : -1;
    const lastIndex = focusable.length - 1;
    if (event.shiftKey && currentIndex <= 0) {
      event.preventDefault();
      focusable[lastIndex].focus();
    } else if (
      !event.shiftKey &&
      (currentIndex === -1 || currentIndex >= lastIndex)
    ) {
      event.preventDefault();
      focusable[0].focus();
    }
  };

  private handleTabClick(key: string) {
    this.onTabChange?.(key);
  }

  private renderTabs() {
    return html`
      <div
        role="tablist"
        class="flex justify-center border-b border-white/10 px-4 lg:px-6 gap-1 shrink-0"
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
      : `relative flex flex-col w-full h-full lg:w-[90%] lg:h-auto lg:min-w-[400px] lg:max-w-[900px] lg:m-8 lg:rounded-lg shadow-[0_20px_60px_rgba(0,0,0,0.8)] lg:max-h-[calc(100vh-4rem)] ${
          this.alwaysMaximized ? "h-auto" : ""
        }`;
    const wrapperStyle =
      !this.inline && this.maxWidth ? `max-width: ${this.maxWidth};` : "";

    const hasTabs = this.tabs.length > 0;
    const hasTitle = this.title.trim().length > 0;
    const explicitLabel = this.accessibleLabel.trim();
    const hasExplicitLabel = explicitLabel.length > 0;
    const hasAccessibleName = hasTitle || hasExplicitLabel;
    const sectionClass =
      "relative flex-1 min-h-0 flex flex-col text-white bg-black/70 backdrop-blur-xl lg:rounded-2xl lg:border border-white/10 overflow-hidden";

    return html`
      <aside
        class="${backdropClass}"
        @click=${this.inline ? null : () => this.close()}
      >
        <div
          data-modal-panel
          role=${hasAccessibleName ? "dialog" : nothing}
          aria-modal=${hasAccessibleName && !this.inline ? "true" : nothing}
          aria-labelledby=${hasTitle ? this.titleId : nothing}
          aria-label=${!hasTitle && hasExplicitLabel ? explicitLabel : nothing}
          tabindex="-1"
          @click=${(e: Event) => e.stopPropagation()}
          class="${wrapperClass}"
          style="${wrapperStyle}"
        >
          ${this.inline || this.hideCloseButton
            ? html``
            : html`<button
                type="button"
                data-modal-close
                aria-label=${translateText("common.close")}
                title=${translateText("common.close")}
                class="absolute top-5 right-5 z-10 text-white cursor-pointer"
                @click=${() => this.close()}
              >
                ✕
              </button>`}
          ${!this.hideHeader && this.title
            ? html`<div
                id=${this.titleId}
                class="px-[1.4rem] py-[1rem] text-2xl font-bold text-white"
              >
                ${this.title}
              </div>`
            : this.title
              ? html`<span id=${this.titleId} class="sr-only"
                  >${this.title}</span
                >`
              : html``}
          <section class="${sectionClass}">
            <slot name="header"></slot>
            ${hasTabs ? this.renderTabs() : html``}
            <div data-modal-scroll class="flex-1 min-h-0 overflow-y-auto">
              <slot></slot>
            </div>
          </section>
        </div>
      </aside>
    `;
  }
}
