import type { TemplateResult } from "lit";
import { html, LitElement } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { UserMeResponse } from "../core/ApiSchemas";
import { ColorPalette, Cosmetics, Pattern } from "../core/CosmeticSchemas";
import "./components/Difficulties";
import "./components/PatternButton";
import {
  fetchCosmetics,
  handlePurchase,
  patternRelationship,
} from "./Cosmetics";
import { translateText } from "./Utils";

@customElement("shop-modal")
class ShopModalInner extends LitElement {
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };

  @state() private activeTab: "patterns" | "colors" = "patterns";

  private cosmetics: Cosmetics | null = null;
  private userMeResponse: UserMeResponse | false = false;
  private isActive = false;

  constructor() {
    super();
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener(
      "userMeResponse",
      (event: CustomEvent<UserMeResponse | false>) => {
        this.onUserMe(event.detail);
      },
    );
  }

  async onUserMe(userMeResponse: UserMeResponse | false) {
    this.userMeResponse = userMeResponse;
    this.cosmetics = await fetchCosmetics();
    this.refresh();
  }

  createRenderRoot() {
    return this;
  }

  private renderTabNavigation(): TemplateResult {
    return html`
      <div class="flex border-b border-gray-600 mb-4 justify-center">
        <button
          class="px-4 py-2 text-sm font-medium transition-colors duration-200 ${this
            .activeTab === "patterns"
            ? "text-blue-400 border-b-2 border-blue-400 bg-blue-400/10"
            : "text-gray-400 hover:text-white"}"
          @click=${() => (this.activeTab = "patterns")}
        >
          ${translateText("shop.skins")}
        </button>
        <button
          class="px-4 py-2 text-sm font-medium transition-colors duration-200 ${this
            .activeTab === "colors"
            ? "text-blue-400 border-b-2 border-blue-400 bg-blue-400/10"
            : "text-gray-400 hover:text-white"}"
          @click=${() => (this.activeTab = "colors")}
        >
          ${translateText("shop.colors")}
        </button>
      </div>
    `;
  }

  private renderPatternGrid(): TemplateResult {
    const buttons: TemplateResult[] = [];
    for (const pattern of Object.values(this.cosmetics?.patterns ?? {})) {
      const colorPalettes = [...(pattern.colorPalettes ?? []), null];
      for (const colorPalette of colorPalettes) {
        const rel = patternRelationship(
          pattern,
          colorPalette,
          this.userMeResponse,
          null, // No affiliate code filtering in shop
        );
        // Only show purchasable items (not owned or blocked)
        if (rel !== "purchasable") {
          continue;
        }
        buttons.push(html`
          <pattern-button
            .pattern=${pattern}
            .colorPalette=${this.cosmetics?.colorPalettes?.[
              colorPalette?.name ?? ""
            ] ?? null}
            .requiresPurchase=${true}
            .onSelect=${() => {}}
            .onPurchase=${(p: Pattern, colorPalette: ColorPalette | null) =>
              handlePurchase(p, colorPalette)}
          ></pattern-button>
        `);
      }
    }

    if (buttons.length === 0) {
      return html`
        <div class="flex flex-col gap-2">
          <div class="text-center text-gray-400 py-8">
            ${translateText("shop.no_items_available")}
          </div>
        </div>
      `;
    }

    return html`
      <div class="flex flex-col gap-2">
        <div
          class="flex flex-wrap gap-4 p-2"
          style="justify-content: center; align-items: flex-start;"
        >
          ${buttons}
        </div>
      </div>
    `;
  }

  private renderColorSwatchGrid(): TemplateResult {
    // For now, show message that colors aren't available in shop
    // You could expand this if there are purchasable colors in the future
    return html`
      <div class="text-center text-gray-400 py-8">
        ${translateText("shop.no_colors_available")}
      </div>
    `;
  }

  render() {
    if (!this.isActive) return html``;
    return html`
      <o-modal
        id="shopModal"
        title="${this.activeTab === "patterns"
          ? translateText("shop.skins")
          : translateText("shop.colors")}"
      >
        ${this.renderTabNavigation()}
        ${this.activeTab === "patterns"
          ? this.renderPatternGrid()
          : this.renderColorSwatchGrid()}
      </o-modal>
    `;
  }

  public async open() {
    this.isActive = true;
    await this.refresh();
  }

  public close() {
    this.isActive = false;
    this.modalEl?.close();
  }

  public async refresh() {
    this.requestUpdate();

    // Wait for the DOM to be updated and the o-modal element to be available
    await this.updateComplete;

    // Now modalEl should be available
    if (this.modalEl) {
      this.modalEl.open();
    } else {
      console.warn("modalEl is still null after updateComplete");
    }
    this.requestUpdate();
  }
}

@customElement("shop-button")
export class ShopButton extends LitElement {
  @query("shop-modal") private shopModal!: ShopModalInner;

  createRenderRoot() {
    return this;
  }

  render() {
    return html`
      <div class="relative w-full group">
        <button
          id="shop-button"
          class="w-full border p-[4px] rounded-lg flex cursor-pointer border-black/30 dark:border-gray-300/60 bg-white/70 dark:bg-[rgba(55,65,81,0.7)] justify-center items-center transition-all duration-300 hover:shadow-lg hover:shadow-blue-500/50"
          title="Shop"
          @click=${this.open}
        >
          <img
            src="/images/ShoppingCart.svg"
            alt="Shop"
            class="w-full h-full object-contain transition-all duration-300"
            style="filter: invert(47%) sepia(96%) saturate(1733%) hue-rotate(193deg) brightness(98%) contrast(101%);"
          />
        </button>
        <span
          id="shop-badge"
          class="absolute -top-0.5 -right-2 bg-green-500 text-white text-[9px] font-bold px-2 py-0.5 rounded-full uppercase whitespace-nowrap -rotate-[330deg] shadow-md transition-all duration-300 group-hover:scale-110 group-hover:shadow-[0_0_20px_rgba(34,197,94,0.8),0_0_40px_rgba(34,197,94,0.4)] pointer-events-none overflow-hidden"
          style="animation: glint 3s ease-in-out infinite"
        >
          <span class="relative z-10">${translateText("shop.badge")}</span>
          <span
            class="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent"
            style="
              animation: glint-slide 3s ease-in-out infinite;
              transform: translateX(-100%);
            "
          ></span>
        </span>
      </div>
      <shop-modal></shop-modal>
    `;
  }

  private open() {
    this.shopModal?.open();
  }

  public close() {
    this.shopModal?.close();
  }
}
