import type { PropertyValues, TemplateResult } from "lit";
import { html } from "lit";
import { customElement } from "lit/decorators.js";
import { UserMeResponse } from "../core/ApiSchemas";
import { Cosmetics, Product } from "../core/CosmeticSchemas";
import { BaseModal } from "./components/BaseModal";
import "./components/CosmeticCard";
import { cosmeticDisplayName } from "./components/CosmeticPresentation";
import "./components/CurrencyDisplay";
import "./components/CustomCurrencyCard";
import "./components/EffectsGrid";
import "./components/NotLoggedInWarning";
import "./components/PurchaseButton";
import { alignPurchaseRows } from "./components/PurchaseButton";
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

interface StoreBrowserOptions {
  emptyTranslationKey: string;
  userHasSubscription?: boolean;
  trailingContent?: TemplateResult;
  gridClass?: string;
  cardClass?: string;
  emptyClass?: string;
}

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
    // Rows re-wrap on resize, so which currencies share a row changes with it.
    if (typeof ResizeObserver !== "undefined") {
      this.rowObserver ??= new ResizeObserver(() => alignPurchaseRows(this));
      this.rowObserver.observe(this);
    }
  }

  disconnectedCallback() {
    this.rowObserver?.disconnect();
    if (this.alignFrame !== null) cancelAnimationFrame(this.alignFrame);
    this.alignFrame = null;
    super.disconnectedCallback();
  }

  protected updated(changed: PropertyValues) {
    super.updated(changed);
    // The cards are nested components, so their purchase buttons only exist
    // (and only have positions) after their own updates commit — a frame later.
    alignPurchaseRows(this);
    if (typeof requestAnimationFrame === "undefined") return;
    this.alignFrame ??= requestAnimationFrame(() => {
      this.alignFrame = null;
      alignPurchaseRows(this);
    });
  }

  private rowObserver: ResizeObserver | null = null;
  private alignFrame: number | null = null;

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
    if (this.affiliateCode) {
      return groupCosmeticVariants(
        this.resolvedPurchasables().filter(
          (resolved) => resolved.cosmetic?.affiliateCode === this.affiliateCode,
        ),
      );
    }
    if (tab === "cosmetics") {
      return this.cosmeticsGroups(this.cosmeticsSubTab);
    }
    if (tab === "effects") {
      return this.resolvedPurchasables()
        .filter((resolved) => resolved.type === "effect")
        .map((resolved) => [resolved]);
    }
    if (tab === "packs") {
      return this.resolvedPurchasables()
        .filter((resolved) => resolved.type === "pack")
        .map((resolved) => [resolved]);
    }
    if (tab === "subscriptions") {
      return resolveCosmetics(
        this.cosmetics,
        this.userMeResponse,
        this.affiliateCode,
      )
        .filter(
          (resolved) =>
            resolved.type === "subscription" &&
            (resolved.relationship === "purchasable" ||
              resolved.relationship === "owned"),
        )
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

  private renderCosmeticCards(
    groups: readonly (readonly ResolvedCosmetic[])[] = this.visibleGroups,
    userHasSubscription = false,
    cardClass = "block h-full min-w-0",
  ): TemplateResult {
    return html`${groups.map((group) => {
      const focused = group.find((item) => item.key === this.inspected?.key);
      const active = focused ?? group[0];
      const action =
        active.type === "subscription" && active.relationship === "owned"
          ? html`<span
              data-store-status
              class="rounded-lg bg-white/5 px-3 py-2 text-center text-sm font-bold text-white/70"
              >${translateText("store.subscribed")}</span
            >`
          : this.renderPurchaseAction(active, userHasSubscription);
      return html`<cosmetic-card
        data-store-product
        data-cosmetic-key=${group[0].key}
        class=${cardClass}
        .resolved=${group[0]}
        .variants=${group.length > 1 ||
        group[0].type === "pattern" ||
        group[0].type === "skin"
          ? group
          : []}
        .activeVariantKey=${active.key}
        .actionContent=${action}
        state=${focused ? "focused" : "idle"}
        .onActivate=${(resolved: ResolvedCosmetic) => this.inspect(resolved)}
        .onVariantActivate=${(resolved: ResolvedCosmetic) =>
          this.inspect(resolved)}
      ></cosmetic-card>`;
    })}`;
  }

  private renderPurchaseAction(
    resolved: ResolvedCosmetic,
    userHasSubscription: boolean,
  ): TemplateResult {
    const priced = resolved.cosmetic as {
      product?: Product | null;
      priceHard?: number;
      priceSoft?: number;
      rarity?: string;
    } | null;
    const isPurchasable = resolved.relationship === "purchasable";
    const product = isPurchasable ? (priced?.product ?? null) : null;
    const priceHard = isPurchasable ? priced?.priceHard : undefined;
    const priceSoft = isPurchasable ? priced?.priceSoft : undefined;
    const purchase = (method: "dollar" | "hard" | "soft") =>
      purchaseCosmetic(resolved, method);
    // Reserved currency lines are assigned per visual row by
    // alignPurchaseRows() once the grid has laid out.
    return html`<purchase-button
      .product=${product}
      .priceHard=${priceHard ?? null}
      .priceSoft=${priceSoft ?? null}
      .rarity=${priced?.rarity ?? "common"}
      .itemName=${cosmeticDisplayName(resolved)}
      .dollarLabelKey=${resolved.type === "subscription" && userHasSubscription
        ? "store.switch_button"
        : ""}
      .priceSuffix=${resolved.type === "subscription"
        ? translateText("store.price_per_month")
        : ""}
      .onPurchaseDollar=${product ? () => purchase("dollar") : undefined}
      .onPurchaseHard=${priceHard !== undefined
        ? () => purchase("hard")
        : undefined}
      .onPurchaseSoft=${priceSoft !== undefined
        ? () => purchase("soft")
        : undefined}
    ></purchase-button>`;
  }

  private renderBrowserLayout(
    cards: TemplateResult,
    gridClass = "grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4",
  ): TemplateResult {
    return html`<div data-store-browser class="grid grid-cols-1 gap-4 p-3">
      <div data-store-grid class=${gridClass}>${cards}</div>
    </div>`;
  }

  private renderBrowser(
    groups: readonly (readonly ResolvedCosmetic[])[],
    options: StoreBrowserOptions,
  ): TemplateResult {
    const cards =
      groups.length === 0
        ? options.trailingContent
          ? html``
          : html`<div
              class=${`${options.emptyClass ?? "col-span-full"} py-8 text-center text-sm font-bold uppercase tracking-wider text-white/40`}
            >
              ${translateText(options.emptyTranslationKey)}
            </div>`
        : this.renderCosmeticCards(
            groups,
            options.userHasSubscription,
            options.cardClass,
          );
    return this.renderBrowserLayout(
      html`${cards}${options.trailingContent ?? ""}`,
      options.gridClass,
    );
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
    return html`
      <div
        class="flex items-center justify-center gap-6 border-b border-white/10 px-4"
      >
        ${COSMETICS_SUB_TABS.map((tab) => {
          const active = this.cosmeticsSubTab === tab;
          return html`<button
            class="-mb-px whitespace-nowrap border-b-2 px-4 py-3 text-sm font-bold uppercase tracking-wider transition-colors ${active
              ? "border-malibu-blue text-aquarius"
              : "border-transparent text-white/40 hover:text-white/70"}"
            @click=${() => this.setCosmeticsSubTab(tab)}
          >
            ${translateText(`store.${tab}`)}
          </button>`;
        })}
      </div>
      ${this.renderBrowser(this.visibleGroups, {
        emptyTranslationKey: emptyKey,
      })}
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
      .focusedKey=${this.inspected?.key ?? null}
      .onPurchaseFocus=${(item: ResolvedCosmetic) => this.inspect(item)}
      .renderPurchaseAction=${(item: ResolvedCosmetic) =>
        this.renderPurchaseAction(item, false)}
      .onVisiblePurchaseItemsChange=${(items: readonly ResolvedCosmetic[]) => {
        this.selectVisible(items.map((item) => [item]));
        this.requestUpdate();
      }}
    ></effects-grid>`;
  }

  private renderPackGrid(): TemplateResult {
    // The custom-amount card is always purchasable (priced inline server-side,
    // no catalog entry), and follows the fixed packs at the end of the grid.
    return this.renderBrowser(this.visibleGroups, {
      emptyTranslationKey: "store.no_packs",
      trailingContent: html`<custom-currency-card
        class="block w-48 shrink-0"
      ></custom-currency-card>`,
      gridClass:
        "flex flex-wrap items-stretch justify-center content-start gap-4 p-8",
      cardClass: "block w-48 shrink-0",
      emptyClass:
        "w-full py-8 text-center text-sm font-bold uppercase tracking-wider text-white/40",
    });
  }

  private renderSubscriptionGrid(): TemplateResult {
    const userHasSubscription =
      this.userMeResponse !== false &&
      this.userMeResponse.player.subscription !== null;
    return this.renderBrowser(this.visibleGroups, {
      emptyTranslationKey: "store.no_subscriptions",
      userHasSubscription,
      gridClass:
        "flex flex-wrap items-stretch justify-center content-start gap-4 p-8",
      cardClass: "block w-48 shrink-0",
      emptyClass:
        "w-full py-8 text-center text-sm font-bold uppercase tracking-wider text-white/40",
    });
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
    return this.renderBrowser(this.visibleGroups, {
      emptyTranslationKey: "store.no_affiliate_items",
    });
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
