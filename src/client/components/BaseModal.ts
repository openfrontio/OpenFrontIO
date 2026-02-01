import { LitElement } from "lit";
import { property, query, state } from "lit/decorators.js";

/**
 * Base class for modal components that provides unified Escape key handling and common modal patterns.
 *
 * Features:
 * - Visibility tracking with isModalOpen state
 * - Escape key handler with visibility check and target validation
 * - Automatic listener lifecycle management
 * - Common inline/modal element handling
 * - Shared open/close logic with hooks for custom behavior
 */
export abstract class BaseModal extends LitElement {
  @state() protected isModalOpen = false;
  @property({ type: Boolean }) inline = false;

  @query("o-modal") protected modalEl?: HTMLElement & {
    open: () => void;
    close: () => void;
    onClose?: () => void;
  };

  createRenderRoot() {
    return this;
  }

  protected firstUpdated(): void {
    if (this.modalEl) {
      this.modalEl.onClose = () => {
        if (this.isModalOpen) {
          this.close();
        }
      };
    }
  }

  disconnectedCallback() {
    this.unregisterEscapeHandler();
    super.disconnectedCallback();
  }

  /**
   * Handle Escape key press to close the modal.
   * Only closes if the modal is open.
   */
  private handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && this.isModalOpen) {
      e.preventDefault();
      this.close();
    }
  };

  /**
   * Register the Escape key handler and mark modal as open.
   */
  protected registerEscapeHandler() {
    this.isModalOpen = true;
    window.addEventListener("keydown", this.handleKeyDown);
  }

  /**
   * Unregister the Escape key handler and mark modal as closed.
   */
  protected unregisterEscapeHandler() {
    this.isModalOpen = false;
    window.removeEventListener("keydown", this.handleKeyDown);
  }

  /**
   * Hook for custom logic when modal opens.
   * Override this in subclasses to add custom open behavior.
   */
  protected onOpen(): void {
    // Default implementation does nothing
  }

  /**
   * Hook for custom logic when modal closes.
   * Override this in subclasses to add custom close behavior.
   */
  protected onClose(): void {
    // Default implementation does nothing
  }

  /**
   * Open the modal. Handles both inline and modal element modes.
   * Subclasses can override onOpen() for custom behavior.
   */
  public open(): void {
    this.registerEscapeHandler();
    this.onOpen();

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
  }

  /**
   * Close the modal. Handles both inline and modal element modes.
   * Subclasses can override onClose() for custom behavior.
   */
  public close(): void {
    this.unregisterEscapeHandler();
    this.onClose();

    if (this.inline) {
      this.style.pointerEvents = "none";
      if (window.showPage) {
        window.showPage?.("page-play");
      }
    } else {
      this.modalEl?.close();
    }
  }
}
