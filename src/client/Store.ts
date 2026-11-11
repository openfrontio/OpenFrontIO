import {
  paidSubscriptionOf,
  UserMeResponse,
} from "@openfront/shared/ApiSchemas";
import {
  CosmeticPack,
  Cosmetics,
  Product,
  Subscription,
} from "@openfront/shared/CosmeticSchemas";
import type { PropertyValues, TemplateResult } from "lit";
import { html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { BaseModal } from "./components/BaseModal";
import "./components/CosmeticCard";
import { cosmeticSelectionLabel } from "./components/CosmeticPresentation";
import { isPreviewableCosmetic } from "./components/CosmeticPreviewBubble";
import "./components/CosmeticPreviewModal";
import "./components/CurrencyDisplay";
import "./components/CustomCurrencyCard";
import "./components/EffectsGrid";
import type { InlineCheckout } from "./components/InlineCheckout";
import "./components/NotLoggedInWarning";
import "./components/PackContentsDialog";
import { ProgressiveList } from "./components/ProgressiveList";
import "./components/SaleCountdown";
import { alignPurchaseRows } from "./components/PurchaseButton";
import { runningSales, saleCoversEverything } from "./components/SaleBanner";
import "./components/TribesPanel";
import { modalHeader } from "./components/ui/ModalHeader";
import { styledSelect } from "./components/ui/StyledSelect";
import {
  activeSale,
  currentPrice,
  fetchCosmetics,
  invalidateCosmetics,
  refreshStaleCosmetics,
  findPackItem,
  groupCosmeticVariants,
  ownedPackItems,
  purchaseCosmetic,
  resolveCosmetics,
  saleHasEnded,
  ResolvedCosmetic,
} from "./Cosmetics";
import { matchesStoreItem } from "./EquippedCosmetics";
import {
  priceStringToCents,
  reportPendingSteamAuthorizations,
} from "./Payments";
import { lastUserMeResponse } from "./UserMeBroadcast";
import { translateText } from "./Utils";

// Matches the API's formatting of `product.price`, so a tier priced from its
// own cents reads the same as one priced from its Stripe listing.
const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

function formatUsdCents(cents: number): string {
  return usdFormatter.format(cents / 100);
}

type StoreTab =
  | "cosmetics"
  | "bundles"
  | "effects"
  | "packs"
  | "subscriptions"
  | "tribes";

// "sale" lists every discounted skin, flag, crown, effect and bundle; its tab
// shows only while a sale covers one of them.
const COSMETICS_SUB_TABS = ["sale", "patterns", "new", "flags", "crowns"] as const;
type CosmeticsSubTab = (typeof COSMETICS_SUB_TABS)[number];

export type StoreCurrencyFilter = "all" | "caps" | "plutonium";
export type StoreSortOption =
  | "default"
  | "newest"
  | "oldest"
  | "price_asc"
  | "price_desc";

/** Sub-tab holding the catalog item a store deep link points at. */
export function subTabForItem(itemKey: string): CosmeticsSubTab {
  if (itemKey.startsWith("crown:")) return "crowns";
  if (itemKey.startsWith("flag:")) return "flags";
  return "patterns";
}

interface StoreBrowserOptions {
  emptyTranslationKey: string;
  userHasSubscription?: boolean;
  trailingContent?: TemplateResult;
  gridClass?: string;
  cardClass?: string;
  previewSize?: "card" | "detail";
  emptyClass?: string;
}

// After a sale ends, how often and how many times the store refetches while
// the API's one-minute-cached catalog still lists it (8 x 15s = 2 minutes).
const SALE_END_RETRY_MS = 15_000;
const SALE_END_RETRIES = 8;

/** Whether the catalog still lists a sale whose end time has passed. */
function hasEndedSale(cosmetics: Cosmetics | null): boolean {
  const now = Date.now();
  return (cosmetics?.promotions ?? []).some(
    (sale) => new Date(sale.endsAt).getTime() <= now,
  );
}

/** The running flash sale's item group, if one is among `groups`. */
function flashGroup<T extends readonly ResolvedCosmetic[]>(
  groups: readonly T[],
): T | undefined {
  return groups.find((group) =>
    group.some((resolved) => activeSale(resolved.cosmetic)?.kind === "flash"),
  );
}

/** Whether a running sale discounts any variant in a card's group. */
function groupOnSale(group: readonly ResolvedCosmetic[]): boolean {
  return group.some((resolved) => activeSale(resolved.cosmetic) !== null);
}

/** The flash item, then the rest on sale, then everything else. */
export function saleFirst<T extends readonly ResolvedCosmetic[]>(
  groups: readonly T[],
): T[] {
  const flash = flashGroup(groups);
  const rest = groups.filter((group) => group !== flash);
  return [
    ...(flash ? [flash] : []),
    ...rest.filter(groupOnSale),
    ...rest.filter((group) => !groupOnSale(group)),
  ];
}

export { saleCoversEverything };

@customElement("store-modal")
export class StoreModal extends BaseModal {
  protected routerName = "store";
  private cosmetics: Cosmetics | null = null;
  private affiliateCode: string | null = null;
  private userMeResponse: UserMeResponse | false = false;
  // `userMeResponse` starts at `false`, which is also what "no session" looks
  // like, so a tab that renders a sign-in prompt on `false` would show it to a
  // logged-in player for the whole window before Main's first userMeResponse
  // broadcast (a Steam ticket exchange on desktop). This distinguishes the
  // two: nothing is asserted about the session until it has actually settled.
  // Reactive on its own, unlike `userMeResponse`: onUserMe() only calls
  // refresh() after the catalog fetch, and a settled no-session result must
  // not wait on a slow catalog before it may say so.
  @state() private authSettled = false;
  @state() private search = "";
  @state() private currencyFilter: StoreCurrencyFilter = "all";
  @state() private sortBy: StoreSortOption = "default";
  private cosmeticsSubTab: CosmeticsSubTab = "patterns";
  // Item the URL asked for (`#modal=store&item=<key>`). Held until its group
  // is visible, then inspected so the store opens on that item.
  private requestedItem: string | null = null;
  private inspected: ResolvedCosmetic | null = null;
  private previewingCosmetic: ResolvedCosmetic | null = null;
  private visibleGroups: readonly (readonly ResolvedCosmetic[])[] = [];
  /** The bundle whose contents dialog is open, if any. */
  private openedPack: ResolvedCosmetic | null = null;
  private readonly pages = new ProgressiveList(this);

  protected modalConfig() {
    if (this.affiliateCode) {
      // Affiliate mode: hide tabs, show only items associated with the code.
      return { showScrollToTop: true };
    }
    return {
      showScrollToTop: true,
      tabs: [
        { key: "packs", label: translateText("store.packs") },
        { key: "subscriptions", label: translateText("store.subscriptions") },
        { key: "bundles", label: translateText("store.bundles") },
        { key: "cosmetics", label: translateText("store.cosmetics") },
        { key: "effects", label: translateText("store.effects") },
        { key: "tribes", label: translateText("store.tribes") },
      ],
    };
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener("userMeResponse", this.onUserMeEvent);
    // The store loads on demand, usually after Main's broadcast went out.
    const last = lastUserMeResponse();
    if (last !== null) void this.onUserMe(last.response);
    this.addEventListener("open-cosmetic-preview", this.onOpenCosmeticPreview);
    // Rows re-wrap on resize, so which currencies share a row changes with it.
    if (typeof ResizeObserver !== "undefined") {
      this.rowObserver ??= new ResizeObserver(() => alignPurchaseRows(this));
      this.rowObserver.observe(this);
    }
  }

  disconnectedCallback() {
    document.removeEventListener("userMeResponse", this.onUserMeEvent);
    this.removeEventListener(
      "open-cosmetic-preview",
      this.onOpenCosmeticPreview,
    );
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

  private onUserMeEvent = (event: Event) => {
    const customEvent = event as CustomEvent<UserMeResponse | false>;
    void this.onUserMe(customEvent.detail);
  };

  private onOpenCosmeticPreview = (event: Event) => {
    const customEvent = event as CustomEvent<ResolvedCosmetic>;
    this.previewingCosmetic = customEvent.detail;
    this.requestUpdate();
  };

  private rowObserver: ResizeObserver | null = null;
  /** Fires when the soonest running sale ends, to refetch its prices. */
  private saleEndTimer: ReturnType<typeof setTimeout> | null = null;
  /** Retries that refetch while the API's cached catalog still has the sale. */
  private saleRetryTimer: ReturnType<typeof setTimeout> | null = null;
  /** Bumped on close, so a sale-end refetch still in flight then is dropped. */
  private saleRefetchGeneration = 0;
  /** Bumped by every catalog fetch, so only the newest one's answer is kept. */
  private catalogRequest = 0;
  private alignFrame: number | null = null;

  async onUserMe(userMeResponse: UserMeResponse | false) {
    this.userMeResponse = userMeResponse;
    this.authSettled = true;
    await this.loadCatalog();
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
        ${
          currency
            ? html`<currency-display
                .hard=${currency.hard}
                .soft=${currency.soft}
              ></currency-display>`
            : ""
        }
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

  private includedInSearch(name: string): boolean {
    if (!this.search.trim()) return true;
    const query = this.search.trim().toLowerCase();
    const displayName = name.replace(/_/g, " ").toLowerCase();
    return displayName.includes(query) || name.toLowerCase().includes(query);
  }

  private handleSearch(event: Event): void {
    this.search = (event.target as HTMLInputElement).value;
    this.selectVisible(this.cosmeticsGroups(this.cosmeticsSubTab));
    this.requestUpdate();
  }

  private clearSearch(): void {
    this.search = "";
    this.selectVisible(this.cosmeticsGroups(this.cosmeticsSubTab));
    this.requestUpdate();
  }

  private handleCurrencyFilter(filter: StoreCurrencyFilter): void {
    this.currencyFilter = filter;
    this.selectVisible(this.cosmeticsGroups(this.cosmeticsSubTab));
    this.requestUpdate();
  }

  private handleSort(sort: StoreSortOption): void {
    this.sortBy = sort;
    this.selectVisible(this.cosmeticsGroups(this.cosmeticsSubTab));
    this.requestUpdate();
  }

  private clearFilters(): void {
    this.search = "";
    this.currencyFilter = "all";
    this.sortBy = "default";
    this.selectVisible(this.cosmeticsGroups(this.cosmeticsSubTab));
    this.requestUpdate();
  }

  private get hasActiveFilters(): boolean {
    return (
      this.search.trim() !== "" ||
      this.currencyFilter !== "all" ||
      this.sortBy !== "default"
    );
  }

  private groupEffectivePrice(group: readonly ResolvedCosmetic[]): number {
    for (const item of group) {
      const c = item.cosmetic as {
        priceHard?: number;
        priceSoft?: number;
      } | null;
      if (this.currencyFilter === "caps") {
        if (c?.priceSoft !== undefined && c.priceSoft > 0) return c.priceSoft;
      } else if (this.currencyFilter === "plutonium") {
        if (c?.priceHard !== undefined && c.priceHard > 0) return c.priceHard;
      } else {
        if (c?.priceSoft !== undefined && c.priceSoft > 0) return c.priceSoft;
        if (c?.priceHard !== undefined && c.priceHard > 0)
          return c.priceHard * 25;
      }
    }
    return 0;
  }

  private newCosmeticKeys(): Set<string> {
    const items = this.resolvedPurchasables();
    const allSkins = groupCosmeticVariants(
      items.filter((r) => r.type === "pattern" || r.type === "skin"),
    );
    const explicitNew = allSkins.filter((g) =>
      g.some((r) => (r.cosmetic as { isNew?: boolean } | null)?.isNew === true),
    );
    const newGroups = explicitNew.length > 0 ? explicitNew : allSkins.slice(-8);
    return new Set(newGroups.flatMap((g) => g.map((r) => r.key)));
  }

  private cosmeticsGroups(
    tab: CosmeticsSubTab,
  ): readonly (readonly ResolvedCosmetic[])[] {
    const items = this.resolvedPurchasables();
    let baseGroups: readonly (readonly ResolvedCosmetic[])[];
    if (tab === "flags") {
      baseGroups = items
        .filter((resolved) => resolved.type === "flag")
        .map((r) => [r]);
    } else if (tab === "crowns") {
      baseGroups = items
        .filter((resolved) => resolved.type === "crown")
        .map((r) => [r]);
    } else if (tab === "new") {
      const skins = groupCosmeticVariants(
        items.filter(
          (resolved) => resolved.type === "pattern" || resolved.type === "skin",
        ),
      );
      const explicitNew = skins.filter((g) =>
        g.some(
          (r) => (r.cosmetic as { isNew?: boolean } | null)?.isNew === true,
        ),
      );
      baseGroups =
        explicitNew.length > 0 ? explicitNew : skins.slice(-8).reverse();
    } else if (tab === "sale") {
      // A sale (a flash sale's pick included) can land on an effect or a
      // bundle too, and those live on other tabs; list them here as well so
      // the banner's "On sale" always leads to the item.
      const skins = groupCosmeticVariants(
        items.filter(
          (resolved) => resolved.type === "pattern" || resolved.type === "skin",
        ),
      );
      const flags = items
        .filter((resolved) => resolved.type === "flag")
        .map((r) => [r]);
      const crowns = items
        .filter((resolved) => resolved.type === "crown")
        .map((r) => [r]);
      const others = items
        .filter(
          (resolved) =>
            resolved.type === "effect" || resolved.type === "cosmeticPack",
        )
        .map((r) => [r]);
      baseGroups = [
        ...skins,
        ...flags,
        ...crowns,
        ...others,
      ].filter(groupOnSale);
    } else {
      baseGroups = groupCosmeticVariants(
        items.filter(
          (resolved) => resolved.type === "pattern" || resolved.type === "skin",
        ),
      );
    }

    let filtered = baseGroups.filter((group) =>
      group.some(
        (r) =>
          (r.cosmetic !== null && this.includedInSearch(r.cosmetic.name)) ||
          (r.colorPalette !== null &&
            this.includedInSearch(r.colorPalette.name)),
      ),
    );

    if (this.currencyFilter === "caps") {
      filtered = filtered.filter((group) =>
        group.some((r) => {
          const c = r.cosmetic as { priceSoft?: number } | null;
          return c?.priceSoft !== undefined && c.priceSoft > 0;
        }),
      );
    } else if (this.currencyFilter === "plutonium") {
      filtered = filtered.filter((group) =>
        group.some((r) => {
          const c = r.cosmetic as { priceHard?: number } | null;
          return c?.priceHard !== undefined && c.priceHard > 0;
        }),
      );
    }

    if (this.sortBy === "newest") {
      filtered = tab === "new" ? filtered : [...filtered].reverse();
    } else if (this.sortBy === "oldest") {
      filtered = tab === "new" ? [...filtered].reverse() : filtered;
    } else if (this.sortBy === "price_asc") {
      filtered = [...filtered].sort(
        (a, b) => this.groupEffectivePrice(a) - this.groupEffectivePrice(b),
      );
    } else if (this.sortBy === "price_desc") {
      filtered = [...filtered].sort(
        (a, b) => this.groupEffectivePrice(b) - this.groupEffectivePrice(a),
      );
    } else {
      filtered = saleFirst(filtered);
    }

    return filtered;
  }

  private groupsForTab(tab: string): readonly (readonly ResolvedCosmetic[])[] {
    if (this.affiliateCode) {
      return groupCosmeticVariants(
        this.resolvedPurchasables().filter((resolved) => {
          const c = resolved.cosmetic;
          return (
            c !== null &&
            "affiliateCode" in c &&
            c.affiliateCode === this.affiliateCode
          );
        }),
      );
    }
    if (tab === "cosmetics") {
      // The sale ended (or the catalog dropped it) while its tab was open.
      if (
        this.cosmeticsSubTab === "sale" &&
        this.cosmeticsGroups("sale").length === 0
      ) {
        this.cosmeticsSubTab = "patterns";
      }
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
    if (tab === "bundles") {
      // Owned and partially owned bundles stay listed (as a status, not a
      // buy button) so the player can see why one isn't for sale to them.
      return resolveCosmetics(
        this.cosmetics,
        this.userMeResponse,
        this.affiliateCode,
      )
        .filter(
          (resolved) =>
            resolved.type === "cosmeticPack" &&
            (resolved.relationship !== "blocked" ||
              this.ownedPackItemNames(resolved).length > 0),
        )
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

  // Activating a bundle also opens its contents: the card only has room to
  // tile a few items, so the dialog is where each one is shown with its name.
  private activate(resolved: ResolvedCosmetic): void {
    if (resolved.type === "cosmeticPack") this.openedPack = resolved;
    if (isPreviewableCosmetic(resolved)) this.previewingCosmetic = resolved;
    this.inspect(resolved);
  }

  private closePack(): void {
    this.openedPack = null;
    this.requestUpdate();
  }

  private reconcileInspection(
    groups: readonly (readonly ResolvedCosmetic[])[],
  ): void {
    const visible = groups.flat();
    const wanted = this.requestedItem;
    if (wanted !== null) {
      const match = visible.find((item) => matchesStoreItem(item.key, wanted));
      // The catalog loads after open, so keep the request until its item shows.
      if (match !== undefined) {
        this.requestedItem = null;
        this.inspected = match;
        return;
      }
    }
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
    if (key !== "cosmetics") {
      this.search = "";
      this.currencyFilter = "all";
      this.sortBy = "default";
    }
    this.selectVisible(this.groupsForTab(key));
    this.requestUpdate();
  }

  /** The sub-tabs to show: "On sale" only while something is discounted. */
  private visibleCosmeticsSubTabs(): CosmeticsSubTab[] {
    const hasSale = this.cosmeticsGroups("sale").length > 0;
    return COSMETICS_SUB_TABS.filter((tab) => tab !== "sale" || hasSale);
  }

  private setCosmeticsSubTab(tab: CosmeticsSubTab): void {
    this.cosmeticsSubTab = tab;
    this.selectVisible(this.cosmeticsGroups(tab));
    this.requestUpdate();
  }

  /** Display names of the bundle's items the player already owns. */
  private ownedPackItemNames(resolved: ResolvedCosmetic): string[] {
    return ownedPackItems(
      resolved.cosmetic as CosmeticPack,
      this.userMeResponse,
    ).map((item) => {
      const found = findPackItem(item, resolved.packItems ?? []);
      return found ? cosmeticSelectionLabel(found) : item.name;
    });
  }

  // Same box as a purchase button (w-full, min-h-11, text-base) so an owned
  // tier or bundle reads as a peer of its neighbours' buy action instead of
  // a small tag tucked to one side of the card.
  private renderStatus(text: string, muted = false): TemplateResult {
    return html`<span
      data-store-status
      class="mt-2 flex min-h-11 w-full items-center justify-center rounded-lg border px-2 py-1.5 text-center font-bold ${
        muted
          ? "border-white/15 bg-white/5 text-xs text-white/60"
          : "border-emerald-500/40 bg-emerald-500/15 text-base text-emerald-300"
      }"
      >${text}</span
    >`;
  }

  private renderCardAction(
    active: ResolvedCosmetic,
    userHasSubscription: boolean,
  ): TemplateResult {
    if (active.type === "subscription" && active.relationship === "owned") {
      return this.renderStatus(translateText("store.subscribed"));
    }
    if (active.type === "cosmeticPack") {
      if (active.relationship === "owned") {
        return this.renderStatus(translateText("store.pack_owned"));
      }
      if (active.relationship === "blocked") {
        return this.renderStatus(
          translateText("store.pack_partially_owned", {
            items: this.ownedPackItemNames(active).join(", "),
          }),
          true,
        );
      }
    }
    return this.renderPurchaseAction(active, userHasSubscription);
  }

  private renderCosmeticCards(
    groups: readonly (readonly ResolvedCosmetic[])[] = this.visibleGroups,
    userHasSubscription = false,
    cardClass = "block h-full min-w-0",
    previewSize: "card" | "detail" = "card",
  ): TemplateResult {
    const newKeys = this.newCosmeticKeys();
    return html`${groups.map((group) => {
      const focused = group.find((item) => item.key === this.inspected?.key);
      const active = focused ?? group[0];
      const action = this.renderCardAction(active, userHasSubscription);
      const isNew = newKeys.has(active.key);
      return html`<cosmetic-card
        data-store-product
        data-cosmetic-key=${group[0].key}
        class=${cardClass}
        previewSize=${previewSize}
        .resolved=${group[0]}
        .isNew=${isNew}
        .variants=${
          group.length > 1 ||
          group[0].type === "pattern" ||
          group[0].type === "skin"
            ? group
            : []
        }
        .activeVariantKey=${active.key}
        .actionContent=${action}
        state=${focused ? "focused" : "idle"}
        .onActivate=${(resolved: ResolvedCosmetic) => this.activate(resolved)}
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
      name?: string;
      product?: Product | null;
      priceHard?: number;
      priceSoft?: number;
      listPriceHard?: number;
      listPriceSoft?: number;
      promotion?: { endsAt: string };
      rarity?: string;
    } | null;
    const isPurchasable = resolved.relationship === "purchasable";
    // Only packs and subscriptions still check out in USD; cosmetics are
    // currency-only (their catalog product is always null now, but a cached
    // cosmetics.json may still carry one — never render a dollar button).
    const product =
      isPurchasable &&
      (resolved.type === "pack" || resolved.type === "subscription")
        ? (priced?.product ?? null)
        : null;
    // A tier with no Stripe listing (sold only on Steam) has no `product`;
    // its price is the tier's own, in cents.
    const subscriptionDollarPrice =
      isPurchasable && resolved.type === "subscription" && product === null
        ? formatUsdCents((resolved.cosmetic as Subscription).priceMonthly)
        : "";
    // The price as the server charges it now: once the item's own sale has
    // ended that is its list price, whatever the catalog in hand says.
    const saleEnded = priced !== null && saleHasEnded(priced);
    const priceHard =
      isPurchasable && priced ? currentPrice(priced, "hard") : undefined;
    const priceSoft =
      isPurchasable && priced ? currentPrice(priced, "soft") : undefined;
    const purchase = (method: "dollar" | "hard" | "soft") =>
      purchaseCosmetic(resolved, method);
    // Currency packs check out inline (wallet button / in-page card form)
    // when the display price parses; anything else — including subscriptions,
    // which are recurring and not a PaymentIntent — keeps the redirect flow,
    // which is also what an unparseable price degrades to.
    const amountCents =
      resolved.type === "pack" && product !== null && priced?.name !== undefined
        ? priceStringToCents(product.price)
        : null;
    const inlineCheckout =
      amountCents !== null
        ? {
            request: {
              kind: "currency_pack" as const,
              packName: priced!.name!,
            },
            amountCents,
            successMessageKey: "store.currency_pack_purchase_success",
          }
        : null;
    // Reserved currency lines are assigned per visual row by
    // alignPurchaseRows() once the grid has laid out.
    return html`<purchase-button
      .product=${product}
      .dollarPrice=${subscriptionDollarPrice}
      .inlineCheckout=${inlineCheckout}
      .priceHard=${priceHard ?? null}
      .priceSoft=${priceSoft ?? null}
      .listPriceHard=${
        priceHard !== undefined && !saleEnded
          ? (priced?.listPriceHard ?? null)
          : null
      }
      .listPriceSoft=${
        priceSoft !== undefined && !saleEnded
          ? (priced?.listPriceSoft ?? null)
          : null
      }
      .rarity=${priced?.rarity ?? "common"}
      .itemName=${cosmeticSelectionLabel(resolved)}
      .dollarLabelKey=${
        resolved.type === "subscription" && userHasSubscription
          ? "store.switch_button"
          : ""
      }
      .priceSuffix=${
        resolved.type === "subscription"
          ? translateText("store.price_per_month")
          : ""
      }
      .onPurchaseDollar=${
        product || subscriptionDollarPrice
          ? () => purchase("dollar")
          : undefined
      }
      .onPurchaseHard=${
        priceHard !== undefined ? () => purchase("hard") : undefined
      }
      .onPurchaseSoft=${
        priceSoft !== undefined ? () => purchase("soft") : undefined
      }
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
    const page = this.pages.page(
      "store-grid",
      `${this.affiliateCode ?? ""}:${this.activeTab}:${this.cosmeticsSubTab}:${this.search}:${this.currencyFilter}:${this.sortBy}`,
      groups,
    );
    const cards =
      groups.length === 0
        ? options.trailingContent
          ? html``
          : this.hasActiveFilters
            ? html`<div
                data-store-empty-search
                class="col-span-full flex flex-col items-center justify-center gap-3 py-12 text-center"
              >
                <svg
                  class="h-8 w-8 text-white/30"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="1.5"
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
                <div class="text-sm font-semibold text-white/60">
                  ${this.search.trim() !== ""
                    ? translateText("store.no_search_results", {
                        query: this.search.trim(),
                      })
                    : translateText("store.no_filter_results")}
                </div>
                <button
                  type="button"
                  data-store-clear-search-btn
                  class="rounded-lg bg-white/10 px-3.5 py-1.5 text-xs font-bold uppercase tracking-wider text-white transition-colors hover:bg-white/20 cursor-pointer"
                  @click=${() => this.clearFilters()}
                >
                  ${translateText("store.clear_filters")}
                </button>
              </div>`
            : html`<div
                class=${`${options.emptyClass ?? "col-span-full"} py-8 text-center text-sm font-bold uppercase tracking-wider text-white/40`}
              >
                ${translateText(options.emptyTranslationKey)}
              </div>`
        : this.renderCosmeticCards(
            page.items,
            options.userHasSubscription,
            options.cardClass,
            options.previewSize,
          );
    return this.renderBrowserLayout(
      html`${cards}${page.more}${options.trailingContent ?? ""}`,
      options.gridClass,
    );
  }

  // Skins / Flags / Crowns grouped under one top-level tab; a sub-tab bar
  // (styled like effects-grid's) picks which grid shows.
  private renderCosmeticsPanel(): TemplateResult {
    const subTabs = this.visibleCosmeticsSubTabs();
    const flash =
      this.cosmeticsSubTab === "sale"
        ? flashGroup(this.visibleGroups)
        : undefined;
    const emptyKey =
      this.cosmeticsSubTab === "flags"
        ? "store.no_flags"
        : this.cosmeticsSubTab === "crowns"
          ? "store.no_crowns"
          : this.cosmeticsSubTab === "new"
            ? "store.no_new_skins"
            : "store.no_skins";
    return html`
      <div class="flex flex-col gap-2.5 border-b border-white/10 px-4 py-2">
        <div
          class="flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <div class="flex items-center gap-1 sm:gap-2 overflow-x-auto">
            ${subTabs.map((tab) => {
              const active = this.cosmeticsSubTab === tab;
              return html`<button
                data-store-subtab=${tab}
                class="-mb-px flex items-center gap-1.5 shrink-0 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-bold uppercase tracking-wider transition-colors ${
                  active
                    ? "border-malibu-blue text-aquarius"
                    : "border-transparent text-white/40 hover:text-white/70"
                }"
                @click=${() => this.setCosmeticsSubTab(tab)}
              >
                ${
                  tab === "sale"
                    ? html`<span
                        class="h-2 w-2 rounded-full bg-aquarius shadow-[0_0_6px_var(--color-aquarius)]"
                        aria-hidden="true"
                      ></span>`
                    : nothing
                }${translateText(tab === "sale" ? "store.on_sale" : `store.${tab}`)}
              </button>`;
            })}
          </div>

          <div class="relative flex items-center min-w-48 sm:max-w-64">
            <input
              data-store-search
              type="text"
              class="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-1.5 pl-8 text-sm text-white placeholder-white/30 outline-none transition-all focus:border-malibu-blue focus:ring-1 focus:ring-malibu-blue"
              placeholder=${translateText("store.search_placeholder")}
              .value=${this.search}
              @input=${(e: Event) => this.handleSearch(e)}
            />
            <svg
              class="pointer-events-none absolute left-2.5 h-4 w-4 text-white/40"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            ${this.search
              ? html`<button
                  type="button"
                  data-store-search-clear
                  aria-label=${translateText("store.clear_search")}
                  class="absolute right-2 text-white/40 hover:text-white transition-colors cursor-pointer"
                  @click=${() => this.clearSearch()}
                >
                  ✕
                </button>`
              : nothing}
          </div>
        </div>

        <div
          class="flex items-center gap-3 sm:gap-4 flex-wrap text-xs text-white/70 pt-0.5"
        >
          <div class="flex items-center gap-1.5" data-store-currency-filter>
            <span
              class="font-bold text-white/50 text-[11px] uppercase tracking-wide"
            >
              ${translateText("store.filter_label")}:
            </span>
            ${styledSelect({
              options: [
                { value: "all", label: translateText("store.filter_all") },
                { value: "caps", label: translateText("store.filter_caps") },
                {
                  value: "plutonium",
                  label: translateText("store.filter_plutonium"),
                },
              ],
              value: this.currencyFilter,
              onChange: (val) =>
                this.handleCurrencyFilter(val as StoreCurrencyFilter),
              ariaLabel: translateText("store.filter_currency_label"),
              className: "w-32 sm:w-36",
            })}
          </div>

          <div class="flex items-center gap-1.5" data-store-sort>
            <span
              class="font-bold text-white/50 text-[11px] uppercase tracking-wide"
            >
              ${translateText("store.sort_label")}:
            </span>
            ${styledSelect({
              options: [
                {
                  value: "default",
                  label: translateText("store.sort_default"),
                },
                { value: "newest", label: translateText("store.sort_newest") },
                { value: "oldest", label: translateText("store.sort_oldest") },
                {
                  value: "price_asc",
                  label: translateText("store.sort_price_asc"),
                },
                {
                  value: "price_desc",
                  label: translateText("store.sort_price_desc"),
                },
              ],
              value: this.sortBy,
              onChange: (val) => this.handleSort(val as StoreSortOption),
              ariaLabel: translateText("store.sort_label"),
              className: "w-36 sm:w-44",
            })}
          </div>

          ${this.hasActiveFilters
            ? html`<button
                type="button"
                data-store-reset-filters
                class="ml-auto text-xs font-semibold text-malibu-blue hover:text-aquarius transition-colors underline cursor-pointer"
                @click=${() => this.clearFilters()}
              >
                ${translateText("store.clear_filters")}
              </button>`
            : nothing}
        </div>
      </div>
      ${
        flash
          ? html`${this.renderFlashHero(flash)}
            ${(() => {
              // With the flash item the only thing on sale, the hero is the
              // whole tab: no "No skins available" under it.
              const rest = this.visibleGroups.filter(
                (group) => group !== flash,
              );
              return rest.length > 0
                ? this.renderBrowser(rest, {
                    emptyTranslationKey: emptyKey,
                    gridClass:
                      "grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 p-3.5",
                  })
                : nothing;
            })()}`
          : this.renderBrowser(this.visibleGroups, {
              emptyTranslationKey: emptyKey,
              gridClass:
                "grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 p-3.5",
            })
      }
    `;
  }

  /**
   * The flash sale's item, leading the On sale tab: its card beside what the
   * sale is and a clock to the next item.
   */
  private renderFlashHero(group: readonly ResolvedCosmetic[]): TemplateResult {
    const sale = group
      .map((resolved) => activeSale(resolved.cosmetic))
      .find((found) => found !== null);
    if (!sale) return html``;
    return html`<section
      data-store-flash
      class="mx-3 mt-3 flex flex-col items-center gap-4 rounded-xl border border-aquarius/50 bg-gradient-to-br from-deep-navy via-deep-navy to-malibu-blue/50 p-4 shadow-[0_0_28px_rgba(63,169,245,0.25)] sm:flex-row sm:items-stretch"
    >
      <div class="w-44 shrink-0 sm:w-52">
        ${this.renderCosmeticCards([group])}
      </div>
      <div
        class="flex flex-1 flex-col items-center justify-center gap-3 text-center sm:items-start sm:text-left"
      >
        <span
          class="flex items-center gap-1.5 text-sm font-black uppercase tracking-widest text-aquarius"
        >
          ${translateText("store.flash_sale")}
        </span>
        <span class="text-2xl font-black leading-tight text-white"
          >${translateText("store.flash_sale_hero_title", {
            name: cosmeticSelectionLabel(group[0]),
            percent: sale.percentOff,
          })}</span
        >
        <span class="max-w-sm text-sm text-dawn-blue"
          >${translateText("store.flash_sale_hero_body")}</span
        >
        <span
          class="flex items-baseline gap-2 rounded-lg bg-black/30 px-3 py-2 text-xs font-bold uppercase tracking-wider text-dawn-blue"
        >
          ${translateText("store.flash_next_in")}
          <sale-countdown
            class="text-2xl font-black normal-case tracking-normal tabular-nums text-white"
            format="clock"
            .endsAt=${sale.endsAt}
          ></sale-countdown>
        </span>
      </div>
    </section>`;
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
      .onPurchaseFocus=${(item: ResolvedCosmetic) => this.activate(item)}
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
    // On BOTH rails: the Steam rail sells custom amounts since OPE-337, so
    // there is no longer a rail on which this card is a dead button.
    return this.renderBrowser(this.visibleGroups, {
      emptyTranslationKey: "store.no_packs",
      trailingContent: html`<custom-currency-card
        class="block w-[calc(50%-0.5rem)] max-w-48 shrink-0 sm:w-48"
      ></custom-currency-card>`,
      gridClass:
        "flex flex-wrap items-stretch justify-center content-start gap-4 p-4 sm:p-8",
      cardClass: "block w-[calc(50%-0.5rem)] max-w-48 shrink-0 sm:w-48",
      emptyClass:
        "w-full py-8 text-center text-sm font-bold uppercase tracking-wider text-white/40",
    });
  }

  private renderBundleGrid(): TemplateResult {
    return html`${this.renderBrowser(this.visibleGroups, {
      emptyTranslationKey: "store.no_bundles",
    })}${
      this.openedPack && !this.previewingCosmetic
        ? // The dialog is portaled above the modal's stacking context, so a
          // preview opened from one of its items would render underneath it.
          // Yield to the preview; the dialog comes back when it closes.
          html`<pack-contents-dialog
            .pack=${this.openedPack}
            .actionContent=${this.renderCardAction(this.openedPack, false)}
            @close=${() => this.closePack()}
          ></pack-contents-dialog>`
        : ""
    }`;
  }

  private renderSubscriptionGrid(): TemplateResult {
    // Drives the "Switch" label on the other tiers' buy buttons. A granted
    // player is deliberately NOT counted (OPE-440): they have nothing to
    // switch from — nobody is billing them — so every tier, theirs included,
    // is a first purchase and reads as a plain price.
    const userHasSubscription =
      this.userMeResponse !== false &&
      paidSubscriptionOf(this.userMeResponse.player) !== null;
    // The Steam store lists one tier; a lone card in the narrow tile column
    // reads as a cramped list, so it gets a wider card and a larger preview.
    const lone = this.visibleGroups.length === 1;
    return this.renderBrowser(this.visibleGroups, {
      emptyTranslationKey: "store.no_subscriptions",
      userHasSubscription,
      gridClass:
        "flex flex-wrap items-stretch justify-center content-start gap-4 p-4 sm:p-8",
      cardClass: lone
        ? "block w-full max-w-xs shrink-0"
        : "block w-[calc(50%-0.5rem)] max-w-48 shrink-0 sm:w-48",
      previewSize: lone ? "detail" : "card",
      emptyClass:
        "w-full py-8 text-center text-sm font-bold uppercase tracking-wider text-white/40",
    });
  }

  /** One line per running sale, under the header. */
  private renderSaleBanner(): TemplateResult | string {
    const sales = runningSales(this.cosmetics);
    this.scheduleSaleEnd(sales);
    if (sales.length === 0) return "";
    return html`<sale-banner
      class="block px-3 pt-2"
      .sales=${sales}
      .cosmetics=${this.cosmetics}
      @open-sale=${() => this.openSaleTab()}
    ></sale-banner>`;
  }

  /** Cosmetics → On sale, from the flash sale's banner line. */
  private openSaleTab(): void {
    this.cosmeticsSubTab = "sale";
    if (this.activeTab === "cosmetics") {
      this.setCosmeticsSubTab("sale");
    } else {
      this.setActiveTab("cosmetics");
    }
  }

  /**
   * When the soonest running sale ends, refetch the catalog so its items go
   * back to list price and its banner drops, even if the player never touches
   * the open store. Rescheduled on every render; cleared on close.
   */
  private scheduleSaleEnd(sales: readonly { endsAt: string }[]): void {
    if (this.saleEndTimer !== null) clearTimeout(this.saleEndTimer);
    this.saleEndTimer = null;
    if (sales.length === 0 || !this.isModalOpen) return;
    const nextEnd = Math.min(...sales.map((s) => new Date(s.endsAt).getTime()));
    // setTimeout overflows past ~24.8 days; a later end is rescheduled by a
    // later render.
    const delay = Math.min(Math.max(nextEnd - Date.now(), 0), 2 ** 31 - 1);
    this.saleEndTimer = setTimeout(() => {
      this.saleEndTimer = null;
      void this.refetchAfterSaleEnd(0);
    }, delay);
  }

  /**
   * Fetches the catalog and shows it, unless a newer fetch started meanwhile
   * (sign-in, reopening, a sale ending): an older answer landing last would
   * otherwise replace a newer catalog. A failed fetch keeps the catalog
   * already shown rather than emptying the store; the purchase endpoint
   * charges the live price either way. Returns what this fetch got.
   */
  private async loadCatalog(): Promise<Cosmetics | null> {
    const request = ++this.catalogRequest;
    const fresh = await fetchCosmetics();
    if (request === this.catalogRequest)
      this.cosmetics = fresh ?? this.cosmetics;
    return fresh;
  }

  /**
   * Refetches the catalog after a sale ends. The API serves cosmetics.json
   * from a one-minute cache, so the first answer may still carry the ended
   * sale's prices; while it does, try again, for up to two minutes.
   */
  private async refetchAfterSaleEnd(attempt: number): Promise<void> {
    const generation = this.saleRefetchGeneration;
    invalidateCosmetics();
    const fresh = await this.loadCatalog();
    // Closed (and maybe reopened) since: that open's own fetch wins.
    if (!this.isModalOpen || generation !== this.saleRefetchGeneration) return;
    this.selectVisible(this.groupsForTab(this.activeTab));
    this.requestUpdate();
    if (
      (fresh === null || hasEndedSale(this.cosmetics)) &&
      attempt < SALE_END_RETRIES
    ) {
      if (this.saleRetryTimer !== null) clearTimeout(this.saleRetryTimer);
      this.saleRetryTimer = setTimeout(() => {
        this.saleRetryTimer = null;
        void this.refetchAfterSaleEnd(attempt + 1);
      }, SALE_END_RETRY_MS);
    }
  }

  protected renderHeaderSlot() {
    return html`${this.renderHeader()} ${this.renderSaleBanner()}
    ${
      this.previewingCosmetic
        ? html`<cosmetic-preview-modal
            .resolved=${this.previewingCosmetic}
            @close-preview=${() => {
              this.previewingCosmetic = null;
              this.requestUpdate();
            }}
          ></cosmetic-preview-modal>`
        : ""
    }`;
  }

  protected renderBody(key: string): TemplateResult {
    if (this.affiliateCode) {
      return this.renderAffiliateGrid();
    }
    switch (key as StoreTab) {
      case "cosmetics":
        return this.renderCosmeticsPanel();
      case "bundles":
        return this.renderBundleGrid();
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
    // The panel's `false` branch is a sign-in prompt, i.e. a logged-out
    // state; hold it back until the session is known (see authSettled).
    if (!this.authSettled) return html``;
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
    // Drain any Steam overlay approval parked before this UI existed. The
    // main process's "something arrived" nudge is contentless, so one that
    // fired with no window listening is heard by nobody and sits parked until
    // something drains it -- which makes this required on every open, not an
    // optimisation.
    void reportPendingSteamAuthorizations();
    const affiliate =
      typeof args?.affiliateCode === "string" ? args.affiliateCode : null;
    this.affiliateCode = affiliate;
    this.requestedItem = typeof args?.item === "string" ? args.item : null;
    if (this.requestedItem !== null) {
      this.cosmeticsSubTab = subTabForItem(this.requestedItem);
    }
    // `sub=sale` (the home screen's sale banner) opens Cosmetics → On sale;
    // groupsForTab falls back to Skins if nothing is on sale by now.
    if (args?.sub === "sale") this.cosmeticsSubTab = "sale";
    // Prices change when a sale starts or ends, so a catalog fetched more than
    // a minute ago is refetched rather than shown with stale prices.
    if (refreshStaleCosmetics() || this.cosmetics === null) {
      await this.loadCatalog();
    }
    this.selectVisible(this.groupsForTab(this.activeTab));
    await this.refresh();
    // A catalog still carrying a sale that has ended (the store was closed
    // while the sale-end refetch was retrying, then reopened within the
    // stale window) would show its prices with no banner: refetch it.
    if (hasEndedSale(this.cosmetics)) void this.refetchAfterSaleEnd(0);
  }

  protected onClose(): void {
    if (this.saleEndTimer !== null) clearTimeout(this.saleEndTimer);
    this.saleEndTimer = null;
    if (this.saleRetryTimer !== null) clearTimeout(this.saleRetryTimer);
    this.saleRetryTimer = null;
    this.saleRefetchGeneration++;
    // The store hides via CSS (inline modal), so the tiles never disconnect
    // and an open card-payment modal — portaled to <body> — would float over
    // the play page after Escape closes the store. Close it explicitly.
    for (const inline of this.querySelectorAll<InlineCheckout>(
      "inline-checkout",
    )) {
      inline.closeCardModal();
    }
    this.affiliateCode = null;
    this.openedPack = null;
    this.previewingCosmetic = null;
    this.pages.reset();
    this.requestedItem = null;
    this.selectVisible(this.groupsForTab(this.activeTab));
  }

  public async refresh() {
    this.requestUpdate();
  }
}
