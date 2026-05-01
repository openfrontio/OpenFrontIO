import type { TemplateResult } from "lit";
import { html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { UserMeResponse } from "../core/ApiSchemas";
import { Cosmetics } from "../core/CosmeticSchemas";
import { UserSettings } from "../core/game/UserSettings";
import { BaseModal } from "./components/BaseModal";
import "./components/CosmeticButton";
import "./components/NotLoggedInWarning";
import { modalHeader } from "./components/ui/ModalHeader";
import {
  fetchCosmetics,
  purchaseCosmetic,
  resolveCosmetics,
} from "./Cosmetics";
import { translateText } from "./Utils";

@customElement("store-modal")
export class StoreModal extends BaseModal {
  @state() private activeTab: "patterns" | "flags" | "packs" = "patterns";

  private cosmetics: Cosmetics | null = null;
  private isActive = false;
  private affiliateCode: string | null = null;
  private userMeResponse: UserMeResponse | false = false;

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

  private renderHeader(): TemplateResult {
    return html`
      ${modalHeader({
        title: translateText("store.title"),
        onBack: () => this.close(),
        ariaLabel: translateText("common.back"),
        rightContent: html`<not-logged-in-warning></not-logged-in-warning>`,
      })}
      <div class="flex items-center gap-2 justify-center pt-2">
        <button
          class="px-6 py-2 text-xs font-bold transition-all duration-200 rounded-lg uppercase tracking-widest ${this
            .activeTab === "packs"
            ? "bg-malibu-blue/20 text-aquarius border border-malibu-blue/30 shadow-[var(--shadow-malibu-blue)]"
            : "text-white/40 hover:text-white hover:bg-white/5 border border-transparent"}"
          @click=${() => (this.activeTab = "packs")}
        >
          ${translateText("store.packs")}
        </button>
        <button
          class="px-6 py-2 text-xs font-bold transition-all duration-200 rounded-lg uppercase tracking-widest ${this
            .activeTab === "patterns"
            ? "bg-malibu-blue/20 text-aquarius border border-malibu-blue/30 shadow-[var(--shadow-malibu-blue)]"
            : "text-white/40 hover:text-white hover:bg-white/5 border border-transparent"}"
          @click=${() => (this.activeTab = "patterns")}
        >
          ${translateText("store.patterns")}
        </button>
        <button
          class="px-6 py-2 text-xs font-bold transition-all duration-200 rounded-lg uppercase tracking-widest ${this
            .activeTab === "flags"
            ? "bg-malibu-blue/20 text-aquarius border border-malibu-blue/30 shadow-[var(--shadow-malibu-blue)]"
            : "text-white/40 hover:text-white hover:bg-white/5 border border-transparent"}"
          @click=${() => (this.activeTab = "flags")}
        >
          ${translateText("store.flags")}
        </button>
      </div>
    `;
  }

  private renderPatternGrid(): TemplateResult {
    const items = resolveCosmetics(
      this.cosmetics,
      this.userMeResponse,
      this.affiliateCode,
    ).filter(
      (r) =>
        r.type === "pattern" &&
        r.relationship !== "blocked" &&
        r.relationship !== "owned",
    );

    if (items.length === 0) {
      return html`<div
        class="text-white/40 text-sm font-bold uppercase tracking-wider text-center py-8"
      >
        ${translateText("store.no_skins")}
      </div>`;
    }

    return html`
      <div
        class="flex flex-wrap gap-4 p-8 justify-center items-stretch content-start"
      >
        ${items.map(
          (r) => html`
            <cosmetic-button
              .resolved=${r}
              .onPurchase=${purchaseCosmetic}
            ></cosmetic-button>
          `,
        )}
      </div>
    `;
  }

  private renderFlagGrid(): TemplateResult {
    const items = resolveCosmetics(
      this.cosmetics,
      this.userMeResponse,
      this.affiliateCode,
    ).filter(
      (r) =>
        r.type === "flag" &&
        r.relationship !== "blocked" &&
        r.relationship !== "owned",
    );

    if (items.length === 0) {
      return html`<div
        class="text-white/40 text-sm font-bold uppercase tracking-wider text-center py-8"
      >
        ${translateText("store.no_flags")}
      </div>`;
    }

    const selectedFlag = new UserSettings().getFlag() ?? "";
    return html`
      <div
        class="flex flex-wrap gap-4 p-8 justify-center items-stretch content-start"
      >
        ${items.map(
          (r) => html`
            <cosmetic-button
              .resolved=${r}
              .selected=${selectedFlag === r.key}
              .onPurchase=${purchaseCosmetic}
            ></cosmetic-button>
          `,
        )}
      </div>
    `;
  }

  private renderPackGrid(): TemplateResult {
    const items = resolveCosmetics(
      this.cosmetics,
      this.userMeResponse,
      this.affiliateCode,
    ).filter((r) => r.type === "pack" && r.relationship === "purchasable");

    if (items.length === 0) {
      return html`<div
        class="text-white/40 text-sm font-bold uppercase tracking-wider text-center py-8"
      >
        ${translateText("store.no_packs")}
      </div>`;
    }

    return html`
      <div
        class="flex flex-wrap gap-4 p-8 justify-center items-stretch content-start"
      >
        ${items.map(
          (r) => html`
            <cosmetic-button
              .resolved=${r}
              .onPurchase=${purchaseCosmetic}
            ></cosmetic-button>
          `,
        )}
      </div>
    `;
  }

  render() {
    if (!this.isActive && !this.inline) return html``;

    const content = html`
      <div class="${this.modalContainerClass}">
        ${this.renderHeader()}
        <div class="overflow-y-auto pr-2 custom-scrollbar mr-1">
          ${this.activeTab === "patterns"
            ? this.renderPatternGrid()
            : this.activeTab === "flags"
              ? this.renderFlagGrid()
              : this.renderPackGrid()}
        </div>
      </div>
    `;

    if (this.inline) {
      return content;
    }

    return html`
      <o-modal
        id="storeModal"
        title="${translateText("store.title")}"
        ?inline=${this.inline}
        ?hideHeader=${true}
        ?hideCloseButton=${true}
      >
        ${content}
      </o-modal>
    `;
  }

  public async open(options?: string | { affiliateCode?: string }) {
    if (this.isModalOpen) return;
    this.isActive = true;
    if (typeof options === "string") {
      this.affiliateCode = options;
    } else if (
      options !== null &&
      typeof options === "object" &&
      !Array.isArray(options)
    ) {
      this.affiliateCode = options.affiliateCode ?? null;
    } else {
      this.affiliateCode = null;
    }

    this.cosmetics ??= await fetchCosmetics();
    await this.refresh();
    super.open();
  }

  public close() {
    this.isActive = false;
    this.affiliateCode = null;
    super.close();
  }

  public async refresh() {
    this.requestUpdate();
  }
}
