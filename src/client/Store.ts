import type { TemplateResult } from "lit";
import { html } from "lit";
import { customElement } from "lit/decorators.js";
import { UserMeResponse } from "../core/ApiSchemas";
import { Cosmetics } from "../core/CosmeticSchemas";
import { UserSettings } from "../core/game/UserSettings";
import { BaseModal } from "./components/BaseModal";
import "./components/CosmeticButton";
import "./components/CurrencyDisplay";
import "./components/CustomCurrencyCard";
import "./components/EffectsGrid";
import "./components/NotLoggedInWarning";
import "./components/TribesPanel";
import { modalHeader } from "./components/ui/ModalHeader";
import {
  fetchCosmetics,
  groupCosmeticVariants,
  purchaseCosmetic,
  resolveCosmetics,
} from "./Cosmetics";
import { translateText } from "./Utils";

type StoreTab =
  | "cosmetics"
  | "effects"
  | "merch"
  | "packs"
  | "subscriptions"
  | "tribes";

const COSMETICS_SUB_TABS = ["patterns", "flags", "crowns"] as const;
type CosmeticsSubTab = (typeof COSMETICS_SUB_TABS)[number];

@customElement("store-modal")
export class StoreModal extends BaseModal {
  protected routerName = "store";
  private cosmetics: Cosmetics | null = null;
  private affiliateCode: string | null = null;
  private userMeResponse: UserMeResponse | false = false;
  private cosmeticsSubTab: CosmeticsSubTab = "patterns";

  protected modalConfig() {
    if (this.affiliateCode) {
      // Affiliate mode: hide tabs, show only items associated with the code.
      return {};
    }
    return {
      tabs: [
        { key: "packs", label: translateText("store.packs") },
        { key: "subscriptions", label: translateText("store.subscriptions") },
        { key: "cosmetics", label: translateText("store.cosmetics") },
        { key: "effects", label: translateText("store.effects") },
        { key: "tribes", label: translateText("store.tribes") },
        { key: "merch", label: translateText("store.merch") },
      ],
    };
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

  private renderHeader(): TemplateResult {
    const currency =
      this.userMeResponse === false
        ? undefined
        : this.userMeResponse.player.currency;
    return modalHeader({
      title: translateText("store.title"),
      onBack: () => this.close(),
      ariaLabel: translateText("common.back"),
      rightContent: html`<div class="flex items-center gap-4">
        ${currency
          ? html`<currency-display
              .hard=${currency.hard}
              .soft=${currency.soft}
            ></currency-display>`
          : ""}
        <not-logged-in-warning></not-logged-in-warning>
      </div>`,
    });
  }

  private renderPatternGrid(): TemplateResult {
    const items = resolveCosmetics(
      this.cosmetics,
      this.userMeResponse,
      this.affiliateCode,
    ).filter(
      (r) =>
        (r.type === "pattern" || r.type === "skin") &&
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

    // Collapse colour-palette variants of the same pattern into one tile; the
    // variants become clickable colour swatches on the cosmetic-button.
    return html`
      <div
        class="flex flex-wrap gap-4 p-8 justify-center items-stretch content-start"
      >
        ${groupCosmeticVariants(items).map(
          (group) => html`
            <cosmetic-button
              .resolved=${group[0]}
              .variants=${group}
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

  private renderCrownGrid(): TemplateResult {
    const items = resolveCosmetics(
      this.cosmetics,
      this.userMeResponse,
      this.affiliateCode,
    ).filter(
      (r) =>
        r.type === "crown" &&
        r.relationship !== "blocked" &&
        r.relationship !== "owned",
    );

    if (items.length === 0) {
      return html`<div
        class="text-white/40 text-sm font-bold uppercase tracking-wider text-center py-8"
      >
        ${translateText("store.no_crowns")}
      </div>`;
    }

    const selectedCrown = new UserSettings().getSelectedCrownName() ?? "";
    return html`
      <div
        class="flex flex-wrap gap-4 p-8 justify-center items-stretch content-start"
      >
        ${items.map(
          (r) => html`
            <cosmetic-button
              .resolved=${r}
              .selected=${`crown:${selectedCrown}` === r.key}
              .onPurchase=${purchaseCosmetic}
            ></cosmetic-button>
          `,
        )}
      </div>
    `;
  }

  // Skins / Flags / Crowns grouped under one top-level tab; a sub-tab bar
  // (styled like effects-grid's) picks which grid shows.
  private renderCosmeticsPanel(): TemplateResult {
    let grid: TemplateResult;
    if (this.cosmeticsSubTab === "flags") {
      grid = this.renderFlagGrid();
    } else if (this.cosmeticsSubTab === "crowns") {
      grid = this.renderCrownGrid();
    } else {
      grid = this.renderPatternGrid();
    }
    return html`
      <div
        class="flex items-center justify-center gap-6 border-b border-white/10 px-4"
      >
        ${COSMETICS_SUB_TABS.map((tab) => {
          const active = this.cosmeticsSubTab === tab;
          return html`<button
            class="-mb-px border-b-2 px-2 py-3 text-sm font-black uppercase tracking-wider transition-colors ${active
              ? "border-blue-500 text-blue-400"
              : "border-transparent text-white/50 hover:text-white/80"}"
            @click=${() => {
              this.cosmeticsSubTab = tab;
              this.requestUpdate();
            }}
          >
            ${translateText(`store.${tab}`)}
          </button>`;
        })}
      </div>
      ${grid}
    `;
  }

  private renderMerchPanel(): TemplateResult {
    return html`
      <div
        class="flex flex-col items-center justify-center gap-6 p-12 min-h-[300px]"
      >
        <p class="text-white/70 text-lg text-center">
          ${translateText("store.merch_blurb")}
        </p>
        <a
          href="https://merch.openfront.io"
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex items-center justify-center gap-3 rounded-xl bg-malibu-blue hover:bg-aquarius text-white font-bold uppercase tracking-wider py-4 px-8 text-lg lg:text-xl transition-all duration-300 transform hover:-translate-y-px"
        >
          ${translateText("store.merch_visit_store")}
          <svg
            class="h-5 w-5 shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path
              d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"
            />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
        </a>
      </div>
    `;
  }

  private renderEffectGrid(): TemplateResult {
    // A sub-tab per effectType (Boat Trail / Nuke Trail); each tab opens that
    // type's grid. Tabs are always present, even when a type has nothing to buy.
    return html`<effects-grid
      mode="purchase"
      tabbed
      .cosmetics=${this.cosmetics}
      .userMeResponse=${this.userMeResponse}
      .affiliateCode=${this.affiliateCode}
    ></effects-grid>`;
  }

  private renderPackGrid(): TemplateResult {
    const items = resolveCosmetics(
      this.cosmetics,
      this.userMeResponse,
      this.affiliateCode,
    ).filter((r) => r.type === "pack" && r.relationship === "purchasable");

    // The custom-amount card is always purchasable (priced inline server-side,
    // no catalog entry), and follows the fixed packs at the end of the grid.
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
        <custom-currency-card></custom-currency-card>
      </div>
    `;
  }

  private renderSubscriptionGrid(): TemplateResult {
    const items = resolveCosmetics(
      this.cosmetics,
      this.userMeResponse,
      this.affiliateCode,
    ).filter(
      (r) =>
        r.type === "subscription" &&
        (r.relationship === "purchasable" || r.relationship === "owned"),
    );

    if (items.length === 0) {
      return html`<div
        class="text-white/40 text-sm font-bold uppercase tracking-wider text-center py-8"
      >
        ${translateText("store.no_subscriptions")}
      </div>`;
    }

    const userHasSubscription =
      this.userMeResponse !== false &&
      this.userMeResponse.player.subscription !== null;

    return html`
      <div
        class="flex flex-wrap gap-4 p-8 justify-center items-stretch content-start"
      >
        ${items.map(
          (r) => html`
            <cosmetic-button
              .resolved=${r}
              .onPurchase=${purchaseCosmetic}
              .userHasSubscription=${userHasSubscription}
            ></cosmetic-button>
          `,
        )}
      </div>
    `;
  }

  protected renderHeaderSlot() {
    return this.renderHeader();
  }

  protected renderBody(key: string): TemplateResult {
    if (this.affiliateCode) {
      return this.renderAffiliateGrid();
    }
    switch (key as StoreTab) {
      case "cosmetics":
        return this.renderCosmeticsPanel();
      case "merch":
        return this.renderMerchPanel();
      case "effects":
        return this.renderEffectGrid();
      case "subscriptions":
        return this.renderSubscriptionGrid();
      case "tribes":
        return this.renderTribeGrid();
      case "packs":
      default:
        return this.renderPackGrid();
    }
  }

  private renderTribeGrid(): TemplateResult {
    return html`<tribes-panel
      .userMeResponse=${this.userMeResponse}
    ></tribes-panel>`;
  }

  private renderAffiliateGrid(): TemplateResult {
    const items = resolveCosmetics(
      this.cosmetics,
      this.userMeResponse,
      this.affiliateCode,
    ).filter(
      (r) =>
        (r.type === "pattern" ||
          r.type === "skin" ||
          r.type === "flag" ||
          r.type === "crown" ||
          r.type === "effect" ||
          r.type === "pack") &&
        r.relationship === "purchasable",
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
        ${groupCosmeticVariants(items).map(
          (group) => html`
            <cosmetic-button
              .resolved=${group[0]}
              .variants=${group}
              .onPurchase=${purchaseCosmetic}
            ></cosmetic-button>
          `,
        )}
      </div>
    `;
  }

  protected async onOpen(args?: Record<string, unknown>) {
    // Old links used top-level tab=patterns|flags|crowns; map them onto the
    // grouped cosmetics tab so they still land on the right grid.
    const tab = typeof args?.tab === "string" ? args.tab : null;
    if (COSMETICS_SUB_TABS.includes(tab as CosmeticsSubTab)) {
      this.cosmeticsSubTab = tab as CosmeticsSubTab;
      this.activeTab = "cosmetics";
    }
    const affiliate =
      typeof args?.affiliateCode === "string" ? args.affiliateCode : null;
    this.affiliateCode = affiliate;
    this.cosmetics ??= await fetchCosmetics();
    await this.refresh();
  }

  protected onClose(): void {
    this.affiliateCode = null;
  }

  public async refresh() {
    this.requestUpdate();
  }
}
