import { html, LitElement, nothing } from "lit";
import type { PropertyValues } from "lit";
import { customElement, state } from "lit/decorators.js";
import "./components/CosmeticCard";
import "./components/CosmeticPreviewModal";
import "./components/ConfirmDialog";
import type { ResolvedCosmetic } from "./Cosmetics";
import {
  STEAM_SKIN_DROP_KEYS,
  type SteamSkinDropAnswer,
} from "./SteamSkinDrop";
import { translateText } from "./Utils";

type View = "popup" | "prompt" | "preview";

/**
 * The one-time popup that tells a Steam owner this month's exclusive skin has
 * dropped. `show()` resolves with what the player chose; the caller does the
 * claiming, equipping and marking the notice seen.
 *
 * Like PurchaseNudgeModal there is no backdrop dismissal: closing takes an
 * explicit click. Previewing is a two-step affair so a stray click on the card
 * does not open the WebGL preview: the card (or its corner bubble) opens a
 * confirm prompt, and only its "Preview" button swaps the popup for
 * <cosmetic-preview-modal>. That modal sits at z-[100], below this popup, so
 * the popup is not rendered while it shows.
 *
 * Imported only through LazyModals so the preview chunk stays out of the
 * homepage.
 */
@customElement("steam-skin-drop-modal")
export class SteamSkinDropModal extends LitElement {
  @state() private resolved: ResolvedCosmetic | null = null;
  @state() private view: View = "popup";

  private pending: ((answer: SteamSkinDropAnswer) => void) | null = null;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.addEventListener("open-cosmetic-preview", this.onOpenPreview);
  }

  disconnectedCallback() {
    this.removeEventListener("open-cosmetic-preview", this.onOpenPreview);
    // Nobody can answer a removed popup, and the boot-interrupt runner holds
    // its "a dialog is open" flag until this settles.
    this.settle("abandoned");
    super.disconnectedCallback();
  }

  show(resolved: ResolvedCosmetic): Promise<SteamSkinDropAnswer> {
    // A second call replaces the first rather than leaking its promise.
    this.settle("abandoned");
    this.resolved = resolved;
    this.view = "popup";
    return new Promise((resolve) => {
      this.pending = resolve;
    });
  }

  private settle(answer: SteamSkinDropAnswer) {
    const resolve = this.pending;
    this.pending = null;
    this.resolved = null;
    this.view = "popup";
    resolve?.(answer);
  }

  protected updated(changed: PropertyValues) {
    // Focus starts behind the overlay otherwise, so Tab then Enter would reach
    // the homepage under it. Re-run when the popup comes back from the preview.
    if (
      this.resolved !== null &&
      this.view === "popup" &&
      (changed.has("resolved") || changed.has("view"))
    ) {
      this.focusPrimary();
      // Something outside can still take focus in the frame after the first
      // paint (the boot path re-renders the homepage), so check once more.
      requestAnimationFrame(() => {
        if (
          this.resolved !== null &&
          this.view === "popup" &&
          !this.contains(document.activeElement)
        ) {
          this.focusPrimary();
        }
      });
    }
  }

  private focusPrimary() {
    this.querySelector<HTMLElement>("[data-steam-skin-drop-primary]")?.focus();
  }

  // Keeps Tab inside the panel while it is the only thing on screen.
  private onKeydown = (event: KeyboardEvent) => {
    if (event.key !== "Tab") return;
    const panel = event.currentTarget as HTMLElement;
    const items = [
      ...panel.querySelectorAll<HTMLElement>("button, [tabindex='0']"),
    ];
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !panel.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (
      !event.shiftKey &&
      (active === last || !panel.contains(active))
    ) {
      event.preventDefault();
      first.focus();
    }
  };

  private onOpenPreview = (event: Event) => {
    // Stopped so no ancestor opens its own preview over the popup.
    event.stopPropagation();
    this.view = "prompt";
  };

  private renderPopup(resolved: ResolvedCosmetic) {
    const keys = STEAM_SKIN_DROP_KEYS;
    return html`
      <div
        data-steam-skin-drop
        class="fixed inset-0 z-[10000] bg-black/60 flex items-center justify-center p-4"
      >
        <div
          class="relative w-full max-w-[440px] rounded-2xl border border-white/10 bg-black/70 p-6 text-white shadow-2xl backdrop-blur-xl"
          role="dialog"
          aria-modal="true"
          @keydown=${this.onKeydown}
          aria-label=${translateText(keys.message)}
        >
          <button
            type="button"
            class="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-lg text-xl leading-none text-white/50 transition-all hover:bg-white/10 hover:text-white cursor-pointer"
            aria-label=${translateText(keys.close)}
            @click=${() => this.settle("dismiss")}
          >
            ×
          </button>
          <div class="mx-auto mb-4 mt-6 w-56 max-w-full">
            <cosmetic-card
              .resolved=${resolved}
              .interactive=${true}
              .showSwatches=${false}
              previewSize="detail"
              .onActivate=${() => {
                this.view = "prompt";
              }}
            ></cosmetic-card>
          </div>
          <p class="mb-5 text-center text-sm font-medium text-white/90">
            ${translateText(keys.message)}
          </p>
          <div class="flex gap-3">
            <button
              type="button"
              class="flex-1 cursor-pointer rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-white/80 transition-all hover:bg-white/10 hover:text-white"
              @click=${() => this.settle("claim")}
            >
              ${translateText(keys.claim)}
            </button>
            <button
              type="button"
              data-steam-skin-drop-primary
              class="flex-1 cursor-pointer rounded-xl border-0 bg-malibu-blue px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-white transition-all hover:brightness-110"
              @click=${() => this.settle("equip")}
            >
              ${translateText(keys.claimEquip)}
            </button>
          </div>
        </div>
      </div>
      ${
        this.view === "prompt"
          ? html`<confirm-dialog
              variant="warning"
              .message=${translateText(keys.previewPrompt)}
              .confirmText=${translateText(keys.previewConfirm)}
              .cancelText=${translateText(keys.previewBack)}
              @confirm=${() => {
                this.view = "preview";
              }}
              @cancel=${() => {
                this.view = "popup";
              }}
            ></confirm-dialog>`
          : nothing
      }
    `;
  }

  render() {
    const resolved = this.resolved;
    if (resolved === null) return nothing;
    if (this.view === "preview") {
      return html`<cosmetic-preview-modal
        .resolved=${resolved}
        @close-preview=${() => {
          this.view = "popup";
        }}
      ></cosmetic-preview-modal>`;
    }
    return this.renderPopup(resolved);
  }
}
