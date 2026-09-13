import {
  html,
  LitElement,
  render as litRender,
  nothing,
  TemplateResult,
} from "lit";
import { customElement, property } from "lit/decorators.js";
import { CosmeticPack } from "../../core/CosmeticSchemas";
import { ResolvedCosmetic } from "../Cosmetics";
import { translateText } from "../Utils";
import "./CosmeticCard";
import { cosmeticTypeLabel } from "./CosmeticPresentation";
import { isPreviewableCosmetic } from "./CosmeticPreviewBubble";

/**
 * Shows everything in a cosmetic bundle: the store card for each resolved item
 * (without its own price) with its type underneath, and the bundle's buy action
 * (or ownership status) at the bottom. Activating an item opens its preview. Rendered into a body portal (like confirm-dialog) so
 * it sits above the store modal. Set `.pack`; dispatches `close`.
 */
@customElement("pack-contents-dialog")
export class PackContentsDialog extends LitElement {
  @property({ attribute: false }) pack: ResolvedCosmetic | null = null;

  /** The same purchase button / status the bundle's store card shows. */
  @property({ attribute: false })
  actionContent: TemplateResult | typeof nothing = nothing;

  private portal: HTMLDivElement | null = null;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.portal = document.createElement("div");
    document.body.appendChild(this.portal);
    window.addEventListener("keydown", this.onKeyDown);
  }

  disconnectedCallback() {
    window.removeEventListener("keydown", this.onKeyDown);
    if (this.portal) {
      litRender(html``, this.portal);
      this.portal.remove();
      this.portal = null;
    }
    super.disconnectedCallback();
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") this.close();
  };

  private close() {
    this.dispatchEvent(new CustomEvent("close"));
  }

  // The overlay lives in a body portal, so an item's preview bubble can't
  // bubble up to the store on its own: re-raise it from this host element.
  private relayPreview = (event: Event) => {
    event.stopPropagation();
    this.openPreview((event as CustomEvent<ResolvedCosmetic>).detail);
  };

  private openPreview(item: ResolvedCosmetic): void {
    if (!isPreviewableCosmetic(item)) return;
    this.dispatchEvent(
      new CustomEvent("open-cosmetic-preview", {
        bubbles: true,
        composed: true,
        detail: item,
      }),
    );
  }

  render() {
    if (this.portal) {
      litRender(
        this.pack ? this.renderOverlay(this.pack) : html``,
        this.portal,
      );
    }
    return html``;
  }

  private renderOverlay(resolved: ResolvedCosmetic) {
    const pack = resolved.cosmetic as CosmeticPack;
    const items = resolved.packItems ?? [];
    return html`<div
      class="fixed inset-0 z-[10020] flex items-center justify-center bg-black/80"
      @click=${(e: Event) => {
        if (e.target === e.currentTarget) this.close();
      }}
      @open-cosmetic-preview=${this.relayPreview}
    >
      <div
        data-pack-contents
        role="dialog"
        aria-label=${pack.displayName}
        class="relative mx-4 max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/10 bg-surface p-6 shadow-2xl"
      >
        <button
          type="button"
          aria-label=${translateText("common.close")}
          @click=${() => this.close()}
          class="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-lg text-xl leading-none text-white/50 transition-all hover:bg-white/10 hover:text-white"
        >
          ×
        </button>
        <h2 class="mb-1 pr-8 text-lg font-bold text-white">
          ${pack.displayName}
        </h2>
        ${pack.description
          ? html`<p class="mb-4 text-sm text-white/60">${pack.description}</p>`
          : html`<div class="mb-4"></div>`}
        ${items.length === 0
          ? html`<p class="py-6 text-center text-sm text-white/50">
              ${translateText("store.pack_no_items")}
            </p>`
          : html`<div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
              ${items.map(
                (item) =>
                  html`<div
                    data-pack-contents-item=${item.key}
                    class="flex min-w-0 flex-col items-center gap-1"
                  >
                    <cosmetic-card
                      class="block w-full"
                      .resolved=${item}
                      .onActivate=${(r: ResolvedCosmetic) =>
                        this.openPreview(r)}
                    ></cosmetic-card>
                    <span
                      data-pack-contents-type
                      class="text-[10px] font-bold uppercase tracking-wider text-white/50"
                      >${cosmeticTypeLabel(item)}</span
                    >
                  </div>`,
              )}
            </div>`}
        ${this.actionContent !== nothing
          ? html`<div data-pack-contents-action class="mx-auto mt-4 max-w-xs">
              ${this.actionContent}
            </div>`
          : nothing}
      </div>
    </div>`;
  }
}
