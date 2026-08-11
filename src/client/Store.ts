import type { TemplateResult } from "lit";
import { html } from "lit";
import { customElement } from "lit/decorators.js";
import { UserMeResponse } from "../core/ApiSchemas";
import { Cosmetics, Product } from "../core/CosmeticSchemas";
import { BaseModal } from "./components/BaseModal";
import "./components/CosmeticButton";
import "./components/CosmeticCard";
import "./components/CosmeticDetailPanel";
import { cosmeticDisplayName } from "./components/CosmeticPresentation";
import "./components/CurrencyDisplay";
import "./components/CustomCurrencyCard";
import "./components/EffectsGrid";
import "./components/NotLoggedInWarning";
import "./components/PurchaseButton";
import "./components/TribesPanel";
import { modalHeader } from "./components/ui/ModalHeader";
import {
  fetchCosmetics,
  groupCosmeticVariants,
  purchaseCosmetic,
  resolveCosmetics,
  ResolvedCosmetic,
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
  private inspected: ResolvedCosmetic | null = null;
  private visibleGroups: readonly (readonly ResolvedCosmetic[])[] = [];

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
    this.selectVisible(this.groupsForTab(this.activeTab));
    await this.refresh();
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

  private resolvedPurchasables(): ResolvedCosmetic[] {
    return resolveCosmetics(
      this.cosmetics,
      this.userMeResponse,
      this.affiliateCode,
    ).filter((resolved) => resolved.relationship === "purchasable");
  }

  private cosmeticsGroups(
    tab: CosmeticsSubTab,
  ): readonly (readonly ResolvedCosmetic[])[] {
    const items = this.resolvedPurchasables();
    if (tab === "flags") {
      return items
        .filter((resolved) => resolved.type === "flag")
        .map((r) => [r]);
    }
    if (tab === "crowns") {
      return items
        .filter((resolved) => resolved.type === "crown")
        .map((r) => [r]);
    }
    return groupCosmeticVariants(
      items.filter(
        (resolved) => resolved.type === "pattern" || resolved.type === "skin",
      ),
    );
  }

  private groupsForTab(tab: string): readonly (readonly ResolvedCosmetic[])[] {
    if (this.affiliateCode) return [];
    if (tab === "cosmetics") {
      return this.cosmeticsGroups(this.cosmeticsSubTab);
    }
    if (tab === "effects") {
      return this.resolvedPurchasables()
        .filter((resolved) => resolved.type === "effect")
        .map((resolved) => [resolved]);
    }
    return [];
  }

  private inspect(resolved: ResolvedCosmetic): void {
    this.inspected = resolved;
    this.requestUpdate();
  }

  private reconcileInspection(
    groups: readonly (readonly ResolvedCosmetic[])[],
  ): void {
    const visible = groups.flat();
    const current = visible.find((item) => item.key === this.inspected?.key);
    this.inspected = current ?? groups[0]?.[0] ?? null;
  }

  private selectVisible(
    groups: readonly (readonly ResolvedCosmetic[])[],
  ): void {
    this.visibleGroups = groups;
    this.reconcileInspection(groups);
  }

  protected onTabEnter(key: string): void {
    this.selectVisible(this.groupsForTab(key));
    this.requestUpdate();
  }

  private setCosmeticsSubTab(tab: CosmeticsSubTab): void {
    this.cosmeticsSubTab = tab;
    this.selectVisible(this.cosmeticsGroups(tab));
    this.requestUpdate();
  }

  private renderCosmeticCards(): TemplateResult {
    return html`${this.visibleGroups.map((group) => {
      const focused = group.find((item) => item.key === this.inspected?.key);
      const active = focused ?? group[0];
      return html`<cosmetic-card
        .resolved=${group[0]}
        .variants=${group.length > 1 ? group : []}
        .activeVariantKey=${active.key}
        state=${focused ? "focused" : "idle"}
        .onActivate=${(resolved: ResolvedCosmetic) => this.inspect(resolved)}
        .onVariantActivate=${(resolved: ResolvedCosmetic) =>
          this.inspect(resolved)}
      ></cosmetic-card>`;
    })}`;
  }

  private renderPurchaseAction(): TemplateResult {
    const resolved = this.inspected!;
    const priced = resolved.cosmetic as {
      product?: Product | null;
      priceHard?: number;
      priceSoft?: number;
      rarity?: string;
    } | null;
    const product = priced?.product ?? null;
    const priceHard = priced?.priceHard;
    const priceSoft = priced?.priceSoft;
    const purchase = async (method: "dollar" | "hard" | "soft") => {
      if (!this.inspected) return;
      return purchaseCosmetic(this.inspected, method);
    };
    return html`<purchase-button
      .product=${product}
      .priceHard=${priceHard ?? null}
      .priceSoft=${priceSoft ?? null}
      .rarity=${priced?.rarity ?? "common"}
      .itemName=${cosmeticDisplayName(resolved)}
      .onPurchaseDollar=${product ? () => purchase("dollar") : undefined}
      .onPurchaseHard=${priceHard !== undefined
        ? () => purchase("hard")
        : undefined}
      .onPurchaseSoft=${priceSoft !== undefined
        ? () => purchase("soft")
        : undefined}
    ></purchase-button>`;
  }

  private renderInspectedDetail(): TemplateResult {
    const group =
      this.visibleGroups.find((candidate) =>
        candidate.some((item) => item.key === this.inspected?.key),
      ) ?? [];
    return html`<cosmetic-detail-panel
      context="store"
      .resolved=${this.inspected}
      .variants=${group.length > 1 ? group : []}
      .activeVariantKey=${this.inspected?.key ?? null}
      .onVariantActivate=${(variant: ResolvedCosmetic) => this.inspect(variant)}
      .actionContent=${this.inspected ? this.renderPurchaseAction() : html``}
    ></cosmetic-detail-panel>`;
  }

  private renderBrowser(cards: TemplateResult): TemplateResult {
    return html`<div
      data-store-browser
      class="grid grid-cols-1 gap-4 p-3 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]"
    >
      <div
        data-store-grid
        class="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4"
      >
        ${cards}
      </div>
      <aside class="order-first lg:order-none lg:sticky lg:top-0 lg:self-start">
        ${this.renderInspectedDetail()}
      </aside>
    </div>`;
  }

  // Skins / Flags / Crowns grouped under one top-level tab; a sub-tab bar
  // (styled like effects-grid's) picks which grid shows.
  private renderCosmeticsPanel(): TemplateResult {
    const emptyKey =
      this.cosmeticsSubTab === "flags"
        ? "store.no_flags"
        : this.cosmeticsSubTab === "crowns"
          ? "store.no_crowns"
          : "store.no_skins";
    const cards =
      this.visibleGroups.length === 0
        ? html`<div
            class="col-span-full py-8 text-center text-sm font-bold uppercase tracking-wider text-white/40"
          >
            ${translateText(emptyKey)}
          </div>`
        : this.renderCosmeticCards();
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
            @click=${() => this.setCosmeticsSubTab(tab)}
          >
            ${translateText(`store.${tab}`)}
          </button>`;
        })}
      </div>
      ${this.renderBrowser(cards)}
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
    return this.renderBrowser(
      html`<effects-grid
        class="col-span-full"
        mode="purchase"
        tabbed
        .cosmetics=${this.cosmetics}
        .userMeResponse=${this.userMeResponse}
        .affiliateCode=${this.affiliateCode}
        .focusedKey=${this.inspected?.key ?? null}
        .onPurchaseFocus=${(item: ResolvedCosmetic) => this.inspect(item)}
      ></effects-grid>`,
    );
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
    const affiliate =
      typeof args?.affiliateCode === "string" ? args.affiliateCode : null;
    this.affiliateCode = affiliate;
    this.cosmetics ??= await fetchCosmetics();
    this.selectVisible(this.groupsForTab(this.activeTab));
    await this.refresh();
  }

  protected onClose(): void {
    this.affiliateCode = null;
    this.selectVisible(this.groupsForTab(this.activeTab));
  }

  public async refresh() {
    this.requestUpdate();
  }
}
