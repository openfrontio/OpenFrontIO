import { html, LitElement, TemplateResult } from "lit";
import { property, query, state } from "lit/decorators.js";
import { modalRouter } from "../ModalRouter";
import "./baseComponents/Modal";
import type { OModalTab } from "./baseComponents/Modal";

/**
 * Static-ish configuration for the <o-modal> shell.
 * Subclasses return a fresh object from modalConfig(); avoid heavy work — it's
 * read on every render() and during open()/setActiveTab().
 */
export interface ModalConfig {
  title?: string;
  tabs?: OModalTab[];
  hideHeader?: boolean;
  hideCloseButton?: boolean;
  alwaysMaximized?: boolean;
  maxWidth?: string;
}

/**
 * Base class for modal components.
 *
 * BaseModal renders the <o-modal> shell itself — subclasses provide content
 * via renderContent() (or renderTab() for tabbed modals) and declare
 * configuration via modalConfig().
 *
 * Lifecycle:
 *   open(args?)  → onOpen(args) hook → shell visible
 *   close(args?) → onClose(args) hook → shell hidden
 *
 * Tabs (optional):
 *   Return a non-empty tabs[] from modalConfig(). BaseModal owns activeTab
 *   state and dispatches rendering to renderTab(key). Subclasses can opt in
 *   to onTabEnter(key) for per-tab lifecycle (e.g. lazy load).
 */
export abstract class BaseModal extends LitElement {
  @state() protected isModalOpen = false;
  @state() protected activeTab = "";
  @property({ type: Boolean }) inline = false;

  // Re-entrancy guard: showPage() (for inline modals) re-invokes .open()
  // with no args after we call it. We must not re-run onOpen(undefined)
  // from that nested call, which would clobber state set by the outer call.
  private opening = false;

  @query("o-modal") protected modalEl?: HTMLElement & {
    open: () => void;
    close: () => void;
    onClose?: () => void;
  };

  // ---- Subclass configuration ----
  // Override modalConfig() to configure the rendered <o-modal>. Defaults match
  // the most common shape (custom in-content header, no built-in close button).

  protected modalConfig(): ModalConfig {
    return {};
  }

  /**
   * Optional router name. When set, BaseModal syncs URL state on open/close/
   * tab change as `#modal=<routerName>&tab=<key>&...`. Modals that own their
   * own URL state (e.g. lobby modals) should leave this undefined.
   */
  protected routerName?: string;

  /** Render slot="header" content. Default: no header slot. */
  protected renderHeaderSlot(): TemplateResult | null {
    return null;
  }

  /**
   * Render the modal body. For tabbed modals, switch on `tab` to render the
   * appropriate panel. Modals without tabs can ignore the argument.
   */
  protected renderBody(_tab: string): TemplateResult {
    return html``;
  }

  // ---- Lifecycle hooks ----

  /** Called when the modal opens. Receives router args / direct-caller args. */
  protected onOpen(_args?: Record<string, unknown>): void {}

  /** Called when the modal closes. */
  protected onClose(_args?: Record<string, unknown>): void {}

  /** Called when the active tab changes (including initial set on open). */
  protected onTabEnter(_key: string): void {}

  /**
   * Guard called before closing via Escape key or click-outside.
   * Return false to prevent the modal from closing.
   */
  public confirmBeforeClose(): boolean {
    return true;
  }

  // ---- Rendering ----

  createRenderRoot() {
    return this;
  }

  protected willUpdate(): void {
    // Default the active tab so the highlight is correct on first render,
    // before open() runs (matters for inline modals rendered on page mount).
    const tabs = this.modalConfig().tabs ?? [];
    if (tabs.length && this.activeTab === "") {
      this.activeTab = tabs[0].key;
    }
  }

  render(): TemplateResult {
    const cfg = this.modalConfig();
    const tabs = cfg.tabs ?? [];
    const body = this.renderBody(this.activeTab);
    const headerSlot = this.renderHeaderSlot();

    return html`
      <o-modal
        title=${cfg.title ?? ""}
        ?inline=${this.inline}
        ?hideHeader=${cfg.hideHeader ?? true}
        ?hideCloseButton=${cfg.hideCloseButton ?? true}
        ?alwaysMaximized=${cfg.alwaysMaximized ?? false}
        maxWidth=${cfg.maxWidth ?? ""}
        .tabs=${tabs}
        .activeTab=${this.activeTab}
        .onTabChange=${(key: string) => this.setActiveTab(key)}
      >
        ${headerSlot ? html`<div slot="header">${headerSlot}</div>` : null}
        ${body}
      </o-modal>
    `;
  }

  // ---- Open / close ----

  public isOpen(): boolean {
    return this.isModalOpen;
  }

  /**
   * Open the modal. `args` is a loose bag forwarded to onOpen(). The router
   * passes parsed URL params; direct callers can pass whatever they want.
   *
   * Recognized keys:
   *   - tab: string — sets active tab (validated against modalTabs)
   */
  public open(args?: Record<string, unknown>): void {
    if (this.opening) return;
    this.opening = true;
    try {
      const tabs = this.modalConfig().tabs ?? [];
      if (tabs.length && this.activeTab === "") {
        this.activeTab = tabs[0].key;
      }
      const requestedTab =
        typeof args?.tab === "string" && tabs.some((t) => t.key === args.tab)
          ? args.tab
          : null;

      const wasOpen = this.isModalOpen;
      if (!wasOpen) {
        if (requestedTab) this.activeTab = requestedTab;
        this.registerEscapeHandler();
        this.onOpen(args);
        if (this.activeTab) this.onTabEnter(this.activeTab);
      } else {
        this.onOpen(args);
        // Already open: route tab changes through setActiveTab so URL syncs.
        if (requestedTab && requestedTab !== this.activeTab) {
          this.setActiveTab(requestedTab);
        }
      }

      if (wasOpen) return;

      if (this.inline) {
        const needsShow =
          this.classList.contains("hidden") || this.style.display === "none";
        if (needsShow && window.showPage) {
          const pageId = this.id || this.tagName.toLowerCase();
          window.showPage?.(pageId);
        }
        this.style.pointerEvents = "auto";
      } else {
        this.modalEl?.open();
      }

      if (this.routerName) {
        modalRouter.syncOpened(this.routerName, args);
      }
    } finally {
      this.opening = false;
    }
  }

  public close(args?: Record<string, unknown>): void {
    this.unregisterEscapeHandler();
    this.onClose(args);

    if (this.inline) {
      this.style.pointerEvents = "none";
      if (window.showPage) {
        window.showPage?.("page-play");
      }
    } else {
      this.modalEl?.close();
    }

    if (this.routerName) {
      modalRouter.syncClosed(this.routerName);
    }
  }

  // ---- Tab management ----

  /** Programmatically change the active tab. Triggers onTabEnter. */
  public setActiveTab(key: string): void {
    const tabs = this.modalConfig().tabs ?? [];
    if (!tabs.some((t) => t.key === key)) return;
    if (this.activeTab === key) return;
    this.activeTab = key;
    this.onTabEnter(key);
    if (this.routerName) {
      modalRouter.syncTab(this.routerName, key);
    }
  }

  // ---- Internals ----

  protected firstUpdated(): void {
    if (this.modalEl) {
      this.modalEl.onClose = () => {
        if (this.isModalOpen) {
          if (!this.confirmBeforeClose()) {
            // Re-open the underlying o-modal since it already closed itself
            this.modalEl?.open();
            return;
          }
          this.close();
        }
      };
    }
  }

  disconnectedCallback() {
    this.unregisterEscapeHandler();
    super.disconnectedCallback();
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && this.isModalOpen) {
      e.preventDefault();
      if (!this.confirmBeforeClose()) {
        return;
      }
      this.close();
    }
  };

  protected registerEscapeHandler() {
    this.isModalOpen = true;
    window.addEventListener("keydown", this.handleKeyDown);
  }

  protected unregisterEscapeHandler() {
    this.isModalOpen = false;
    window.removeEventListener("keydown", this.handleKeyDown);
  }

  protected renderLoadingSpinner(
    message?: string,
    spinnerColor: "blue" | "green" | "yellow" | "white" = "blue",
  ): TemplateResult {
    return renderLoadingSpinner(message, spinnerColor);
  }
}

const spinnerColorClasses: Record<string, string> = {
  blue: "border-blue-500/30 border-t-blue-500",
  green: "border-green-500/30 border-t-green-500",
  yellow: "border-yellow-500/30 border-t-yellow-500",
  white: "border-white/20 border-t-white",
};

/**
 * Renders a standardized loading spinner with optional custom message.
 * Use this for consistent loading states across all modals.
 */
export function renderLoadingSpinner(
  message?: string,
  spinnerColor: "blue" | "green" | "yellow" | "white" = "blue",
): TemplateResult {
  return html`
    <div
      class="flex flex-col items-center justify-center p-12 text-white h-full min-h-[400px]"
    >
      <div
        class="w-12 h-12 border-4 ${spinnerColorClasses[
          spinnerColor
        ]} rounded-full animate-spin mb-4"
      ></div>
      ${message
        ? html`<p class="text-white/60 font-medium tracking-wide animate-pulse">
            ${message}
          </p>`
        : ""}
    </div>
  `;
}
