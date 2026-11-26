import {
  paidSubscriptionOf,
  StorePlacement,
  StorePlacementFeaturedSection,
  StorePlacementFeaturedSectionSchema,
  StorePlacementSubTab,
  StorePlacementTab,
  StorePlacementTabSchema,
  UserMeResponse,
} from "@openfront/shared/ApiSchemas";
import {
  CosmeticPack,
  Cosmetics,
  Product,
  Subscription,
} from "@openfront/shared/CosmeticSchemas";
import type { LevelBadge } from "@openfront/shared/LevelBadgeWire";
import type { PropertyValues, TemplateResult } from "lit";
import { html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { BaseModal } from "./components/BaseModal";
import { isCardItemType } from "./components/card/CardItems";
import {
  type CardStoreGrid,
  cardStoreItems,
} from "./components/card/CardStoreGrid";
import "./components/CosmeticCard";
import type { CosmeticCard } from "./components/CosmeticCard";
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
import {
  flashSaleItemName,
  runningSales,
  saleCoversEverything,
  salesPlayerCanBuy,
  visibleBannerSales,
} from "./components/SaleBanner";
import "./components/TribesPanel";
import { modalHeader } from "./components/ui/ModalHeader";
import {
  activeSale,
  isNew,
  newUntilMs,
  fetchCosmetics,
  cosmeticsCacheIsStale,
  getCachedCosmetics,
  invalidateCosmetics,
  refreshStaleCosmetics,
  findPackItem,
  groupCosmeticVariants,
  ownedPackItems,
  purchaseCosmetic,
  resolveCosmetics,
  ResolvedCosmetic,
} from "./Cosmetics";
import { matchesStoreItem } from "./EquippedCosmetics";
import { COSMETICS_CHANGED, exposureWatcher } from "./Experiments";
import {
  fetchPlayPrices,
  priceStringToCents,
  reportPendingSteamAuthorizations,
  sellsOnlyThroughPlay,
} from "./Payments";
import { type PricedItem, shownPrice } from "./ShownPrice";
import {
  playPrice,
  playProductIds,
  sellable,
  storePurchasables,
} from "./StoreSellable";
import { StoreTracker } from "./StoreTracking";
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

// The store's tabs are the placement schema's, plus Featured: a tab the store
// analytics API would reject cannot be added here without failing typecheck.
// Featured is placed by its own kind and section, never as a tab.
type StoreTab = StorePlacementTab | "featured";

/** A tab that is placed as `{ kind: "tab" }`; Featured is not one. */
function isStoreTab(key: string): key is StorePlacementTab {
  return (StorePlacementTabSchema.options as readonly string[]).includes(key);
}

function isFeaturedSection(
  key: string | undefined,
): key is StorePlacementFeaturedSection {
  return (
    key !== undefined &&
    (StorePlacementFeaturedSectionSchema.options as readonly string[]).includes(
      key,
    )
  );
}

// The flash deal's card wherever the store shows it, for the store experiment
// exposure: the On sale tab's hero, or Featured's deal hero (which is placed
// as featured/deal, not flash, so it carries a marker of its own). Not the
// deal slot's owned strip or rollover placeholder, which show no price.
const FLASH_EXPOSURE_SELECTOR = "[data-store-flash], [data-featured-deal-hero]";

// How many cards a Featured row holds: one row at every width, 2 cards on
// phones, 3 from Tailwind's sm and 4 from its xl. Without matchMedia, 4.
const FEATURED_ROW_SM = "(min-width: 40rem)";
const FEATURED_ROW_XL = "(min-width: 80rem)";

function featuredRowLength(): number {
  if (typeof window.matchMedia !== "function") return 4;
  if (window.matchMedia(FEATURED_ROW_XL).matches) return 4;
  return window.matchMedia(FEATURED_ROW_SM).matches ? 3 : 2;
}

type Group = readonly ResolvedCosmetic[];

/** What the Featured tab shows, each item in only the first section it fits. */
interface FeaturedSections {
  /** The running flash sale's item, while the player can buy it. */
  deal: Group | undefined;
  /** New items, newest first, without the deal item. */
  new: Group[];
  /** The rest on sale, without the deal item and anything in `new`. */
  sale: Group[];
}

/** The local time of a deal's end, as GameHistoryDates formats times. */
function localTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// "new" and "sale" list every new or discounted skin, flag, crown, effect and
// bundle; each tab shows only while something is new or on sale.
const COSMETICS_SUB_TABS = [
  "new",
  "sale",
  "patterns",
  "flags",
  "crowns",
  "card",
] as const satisfies readonly StorePlacementSubTab[];
type CosmeticsSubTab = (typeof COSMETICS_SUB_TABS)[number];

/** Sub-tab holding the catalog item a store deep link points at. */
export function subTabForItem(itemKey: string): CosmeticsSubTab {
  if (itemKey.startsWith("crown:")) return "crowns";
  if (itemKey.startsWith("flag:")) return "flags";
  const type = itemKey.split(":")[0];
  // Held-back titles and taunts aren't card item types here: their links open
  // the default.
  if (isCardItemType(type)) return "card";
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

/** Whether any variant in a card's group is new to the store. */
function groupIsNew(group: readonly ResolvedCosmetic[]): boolean {
  return group.some((resolved) => isNew(resolved.cosmetic));
}

/** When a card's group stops being new: its latest variant's newUntil. */
function groupNewUntil(group: readonly ResolvedCosmetic[]): number {
  return Math.max(
    ...group.map((resolved) => newUntilMs(resolved.cosmetic) ?? 0),
  );
}

/** The most recently added first: the one that stays new longest. */
function newestFirst<T extends readonly ResolvedCosmetic[]>(
  groups: readonly T[],
): T[] {
  return groups
    .map((group) => ({ group, until: groupNewUntil(group) }))
    .sort((a, b) => b.until - a.until)
    .map(({ group }) => group);
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
  // In the Android app: Play's price for each product it sells, by product id.
  // Null when Play could not be asked, which lists no pack for real money.
  private playPrices: ReadonlyMap<string, string> | null = null;
  private affiliateCode: string | null = null;
  private userMeResponse: UserMeResponse | false = false;
  // `userMeResponse` starts at `false`, which is also what "no session" looks
  // like, so a tab that renders a sign-in prompt on `false` would show it to a
  // logged-in player for the whole window before Main's first userMeResponse
  // broadcast (a Steam ticket exchange on desktop). This distinguishes the
  // two: nothing is asserted about the session until it has actually settled.
  // Reactive on its own, unlike `userMeResponse`, so a settled no-session
  // result never waits on a slow catalog before it may say so.
  @state() private authSettled = false;
  private cosmeticsSubTab: CosmeticsSubTab = "patterns";

  /** The viewer's level badge, for the Card tab's large preview. */
  private cardBadge(): LevelBadge | null {
    const progress =
      this.userMeResponse === false
        ? null
        : this.userMeResponse.player.progress;
    return progress
      ? {
          level: progress.level,
          prestige: progress.prestige,
          legend: progress.legend,
        }
      : null;
  }
  // Item the URL asked for (`#modal=store&item=<key>`). Held until its group
  // is visible, then inspected so the store opens on that item.
  private requestedItem: string | null = null;
  private inspected: ResolvedCosmetic | null = null;
  private previewingCosmetic: ResolvedCosmetic | null = null;
  private visibleGroups: readonly (readonly ResolvedCosmetic[])[] = [];
  /** The bundle whose contents dialog is open, if any. */
  private openedPack: ResolvedCosmetic | null = null;
  private readonly pages = new ProgressiveList(this);
  /**
   * Whether this open shows the Featured tab. Decided once, as the store
   * opens, so the tab row never changes under the player while it is open.
   * Hidden before the first open, so an inline store mounts on Packs.
   */
  private featuredVisible = false;
  /** Cards per Featured row at the current width; see featuredRowLength. */
  private featuredRowLength = 4;
  private rowQueries: MediaQueryList[] = [];
  /** Set as the store opens; the first onOpen of that open consumes it. */
  private firstOnOpen = false;
  /**
   * The flash slot rolling over to its next item while Featured shows it:
   * the slot keeps the height it had (null if it wasn't rendered) and shows a
   * placeholder until the next deal arrives or the sale-end refetch stops.
   */
  private dealRollover: { height: number | null } | null = null;
  /** The flash promotion whose hero or strip Featured last rendered. */
  private shownFlashPromotionId: string | null = null;
  /** The New row Featured last selected, to drop items that stop being new. */
  private featuredNewGroups: readonly Group[] = [];

  protected modalConfig() {
    if (this.affiliateCode) {
      // Affiliate mode: hide tabs, show only items associated with the code.
      return { showScrollToTop: true };
    }
    return {
      showScrollToTop: true,
      tabs: [
        ...(this.featuredVisible
          ? [
              {
                key: "featured" as const,
                label: translateText("store.featured"),
              },
            ]
          : []),
        { key: "packs", label: translateText("store.packs") },
        { key: "subscriptions", label: translateText("store.subscriptions") },
        { key: "bundles", label: translateText("store.bundles") },
        { key: "cosmetics", label: translateText("store.cosmetics") },
        { key: "effects", label: translateText("store.effects") },
        { key: "tribes", label: translateText("store.tribes") },
      ] satisfies { key: StoreTab; label: string }[],
    };
  }

  /**
   * On a fresh open, seed the catalog from the module cache and decide
   * whether Featured shows, before BaseModal reads the tabs.
   */
  public open(args?: Record<string, unknown>): void {
    if (!this.isModalOpen) {
      // The shared cache is at least as new as the store's own copy, which
      // nothing updates while the store is closed.
      this.cosmetics = getCachedCosmetics() ?? this.cosmetics;
      this.featuredRowLength = featuredRowLength();
      // Decide only from a catalog onOpen won't replace. With none in hand,
      // or one that is stale or still lists an ended sale (a deal may have
      // rolled over), Featured shows and waits for the refetch.
      this.featuredVisible =
        this.cosmetics === null ||
        cosmeticsCacheIsStale() ||
        hasEndedSale(this.cosmetics) ||
        this.featuredHasContent();
      this.firstOnOpen = true;
    }
    super.open(args);
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener("userMeResponse", this.onUserMeEvent);
    document.addEventListener(COSMETICS_CHANGED, this.onCosmeticsChanged);
    // The store loads on demand, usually after Main's broadcast went out.
    const last = lastUserMeResponse();
    if (last !== null) void this.onUserMe(last.response);
    this.addEventListener("open-cosmetic-preview", this.onOpenCosmeticPreview);
    // Rows re-wrap on resize, so which currencies share a row changes with it.
    if (typeof ResizeObserver !== "undefined") {
      this.rowObserver ??= new ResizeObserver(() => alignPurchaseRows(this));
      this.rowObserver.observe(this);
    }
    if (typeof window.matchMedia === "function") {
      this.rowQueries = [FEATURED_ROW_SM, FEATURED_ROW_XL].map((query) =>
        window.matchMedia(query),
      );
      for (const query of this.rowQueries) {
        query.addEventListener("change", this.onRowLengthChange);
      }
    }
  }

  /** A Featured row holds as many cards as fit, so a resize re-picks them. */
  private onRowLengthChange = () => {
    const length = featuredRowLength();
    if (length === this.featuredRowLength) return;
    this.featuredRowLength = length;
    if (this.isModalOpen && this.activeTab === "featured") {
      this.selectVisible(this.groupsForTab(this.activeTab));
      this.requestUpdate();
    }
  };

  disconnectedCallback() {
    document.removeEventListener("userMeResponse", this.onUserMeEvent);
    document.removeEventListener(COSMETICS_CHANGED, this.onCosmeticsChanged);
    this.removeEventListener(
      "open-cosmetic-preview",
      this.onOpenCosmeticPreview,
    );
    this.rowObserver?.disconnect();
    for (const query of this.rowQueries) {
      query.removeEventListener("change", this.onRowLengthChange);
    }
    this.rowQueries = [];
    this.tracker?.dispose();
    this.tracker = null;
    if (this.alignFrame !== null) cancelAnimationFrame(this.alignFrame);
    this.alignFrame = null;
    // A store removed while open never gets onClose; don't let a days-long
    // timeout hold on to it, or a sale end start a rollover and refetch on
    // the detached element.
    this.clearNewEnd();
    if (this.saleEndTimer !== null) clearTimeout(this.saleEndTimer);
    this.saleEndTimer = null;
    if (this.saleRetryTimer !== null) clearTimeout(this.saleRetryTimer);
    this.saleRetryTimer = null;
    this.saleRefetchGeneration++;
    // With the refetch cancelled nothing would clear the deal placeholder, so
    // a store reattached while open would hold it for good.
    this.dealRollover = null;
    this.shownFlashPromotionId = null;
    // Neither field is reactive: redraw so a reattached store doesn't keep
    // the placeholder's markup.
    this.requestUpdate();
    super.disconnectedCallback();
  }

  protected updated(changed: PropertyValues) {
    super.updated(changed);
    this.observeProducts();
    this.observeFlashExposure();
    // The cards are nested components, so their purchase buttons only exist
    // (and only have positions) after their own updates commit — a frame later.
    alignPurchaseRows(this);
    if (typeof requestAnimationFrame === "undefined") return;
    this.alignFrame ??= requestAnimationFrame(() => {
      this.alignFrame = null;
      alignPurchaseRows(this);
    });
  }

  /**
   * The catalog was refetched (the player's store experiment group landed or
   * changed, or a purchase met a changed price): show it. The open store
   * keeps the object it rendered, so this is what moves it on. Analytics are
   * untouched: no new page view, so no impression is counted twice.
   */
  private onCosmeticsChanged = () => {
    void this.loadCatalog().then(() => {
      this.selectVisible(this.groupsForTab(this.activeTab));
      this.refreshOpenedPack();
      this.requestUpdate();
    });
  };

  /**
   * An open bundle dialog shows (and buys at) the price of the catalog it was
   * opened from: move it onto the catalog now shown, or close it if the
   * bundle is no longer there.
   */
  private refreshOpenedPack(): void {
    const opened = this.openedPack;
    if (opened === null) return;
    const fresh = resolveCosmetics(
      this.cosmetics,
      this.userMeResponse,
      this.affiliateCode,
    ).find(
      (resolved) =>
        resolved.type === "cosmeticPack" && resolved.key === opened.key,
    );
    if (fresh === undefined) this.closePack();
    else this.openedPack = fresh;
  }

  private onUserMeEvent = (event: Event) => {
    const customEvent = event as CustomEvent<UserMeResponse | false>;
    void this.onUserMe(customEvent.detail);
  };

  private onOpenCosmeticPreview = (event: Event) => {
    const customEvent = event as CustomEvent<ResolvedCosmetic>;
    const target = event.target as Element | null;
    // A preview from inside a bundle's contents is not a click on a store
    // card: the item has no card on that tab, and counting it would also hide
    // a real click on the item's own card later in the visit.
    if (!target?.closest?.("pack-contents-dialog")) {
      this.trackClick(customEvent.detail, target);
    }
    this.previewingCosmetic = customEvent.detail;
    this.requestUpdate();
  };

  private rowObserver: ResizeObserver | null = null;
  /** Fires when the soonest running sale ends, to refetch its prices. */
  private saleEndTimer: ReturnType<typeof setTimeout> | null = null;
  /** When saleEndTimer is due. */
  private saleEndAt = 0;
  /** Fires when the soonest new item stops being new, to drop its badge. */
  private newEndTimer: ReturnType<typeof setTimeout> | null = null;
  /** When newEndTimer is due. */
  private newEndAt = 0;
  /** Retries that refetch while the API's cached catalog still has the sale. */
  private saleRetryTimer: ReturnType<typeof setTimeout> | null = null;
  /** Bumped on close, so a sale-end refetch still in flight then is dropped. */
  private saleRefetchGeneration = 0;
  /** Bumped by every catalog fetch, so only the newest one's answer is kept. */
  private catalogRequest = 0;
  /** The latest catalogRequest that has finished, whatever it got. */
  private settledCatalogRequest = 0;
  private alignFrame: number | null = null;

  async onUserMe(userMeResponse: UserMeResponse | false) {
    this.userMeResponse = userMeResponse;
    this.authSettled = true;
    // Show the new account (the balance in the header) now, not after the
    // catalog: in the Android app that fetch also waits on Play's prices.
    this.requestUpdate();
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

  /**
   * Everything the player can buy here. Cached on its inputs: a render reads
   * it several times (sub-tabs, grid, New timer), and none of it depends on
   * the clock (cards judge sales and New against it themselves).
   */
  private resolvedPurchasables(): ResolvedCosmetic[] {
    const inputs = [
      this.cosmetics,
      this.userMeResponse,
      this.affiliateCode,
      this.playPrices,
    ] as const;
    const cached = this.purchasablesCache;
    if (cached && cached.inputs.every((input, i) => input === inputs[i])) {
      return cached.items;
    }
    const items = this.resolvePurchasables();
    this.purchasablesCache = { inputs, items };
    return items;
  }

  private purchasablesCache: {
    inputs: readonly unknown[];
    items: ResolvedCosmetic[];
  } | null = null;

  private resolvePurchasables(): ResolvedCosmetic[] {
    return storePurchasables(
      this.cosmetics,
      this.userMeResponse,
      this.affiliateCode,
      this.playPrices,
    );
  }

  private sellable(resolved: ResolvedCosmetic): boolean {
    return sellable(resolved, this.playPrices);
  }

  private playPrice(resolved: ResolvedCosmetic): string | null {
    return playPrice(resolved, this.playPrices);
  }

  private cosmeticsGroups(
    tab: CosmeticsSubTab,
  ): readonly (readonly ResolvedCosmetic[])[] {
    const items = this.resolvedPurchasables();
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
    if (tab === "sale" || tab === "new") {
      // A sale (a flash sale's pick included) or a new item can be an effect
      // or a bundle too, and those live on other tabs; list them here as well
      // so On sale and New each lead to every such item (the banner's "On
      // sale" link included).
      const others = items
        .filter(
          (resolved) =>
            resolved.type === "effect" || resolved.type === "cosmeticPack",
        )
        .map((r) => [r]);
      const all = [...skins, ...flags, ...crowns, ...others];
      return tab === "sale"
        ? saleFirst(all.filter(groupOnSale))
        : newestFirst(all.filter(groupIsNew));
    }
    // The Card sub-tab draws its own grid (<card-store-grid>).
    if (tab === "card") return [];
    return saleFirst(
      tab === "flags" ? flags : tab === "crowns" ? crowns : skins,
    );
  }

  /** The Featured tab's sections, from the catalog, the player and the clock. */
  private featuredSections(): FeaturedSections {
    const onSale = this.cosmeticsGroups("sale");
    const deal = flashGroup(onSale);
    const keysOf = (groups: readonly Group[]) =>
      new Set(groups.flatMap((group) => group.map((item) => item.key)));
    const dealKeys = keysOf(deal ? [deal] : []);
    const fresh = this.cosmeticsGroups("new")
      .filter((group) => !group.some((item) => dealKeys.has(item.key)))
      .slice(0, this.featuredRowLength);
    // Only what the New row shows at this width: a new item on sale that
    // doesn't fit there still shows under On sale.
    const newKeys = keysOf(fresh);
    const sale = onSale.filter(
      (group) =>
        group !== deal &&
        !group.some((item) => dealKeys.has(item.key) || newKeys.has(item.key)),
    );
    return {
      deal,
      new: fresh,
      sale: sale.slice(0, this.featuredRowLength),
    };
  }

  /** Something to buy on Featured. The owned-deal strip doesn't count. */
  private featuredHasContent(): boolean {
    const sections = this.featuredSections();
    return (
      sections.deal !== undefined ||
      sections.new.length > 0 ||
      sections.sale.length > 0
    );
  }

  /**
   * The running flash sale's item when the player already owns it, for the
   * strip that says when the next deal comes. Read from the player's owned
   * items, never inferred from the deal being absent: an affiliate-only item
   * or one Play can't sell is absent too.
   */
  private ownedFlashDeal(): {
    name: string;
    endsAt: string;
    promotionId: string;
  } | null {
    if (this.userMeResponse === false) return null;
    for (const resolved of resolveCosmetics(
      this.cosmetics,
      this.userMeResponse,
      null,
    )) {
      if (resolved.relationship !== "owned") continue;
      const sale = activeSale(resolved.cosmetic);
      if (sale?.kind !== "flash") continue;
      const promotionId = (resolved.cosmetic as { promotion?: { id: string } })
        .promotion?.id;
      if (promotionId === undefined) continue;
      const name = flashSaleItemName(this.cosmetics, promotionId);
      if (name === null) continue;
      return { name, endsAt: sale.endsAt, promotionId };
    }
    return null;
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
      const groups = this.cosmeticsGroups(this.cosmeticsSubTab);
      // The sale ended, the last item stopped being new, or the catalog
      // dropped it, while its tab was open. Not while the latest catalog
      // fetch is pending: a `sub=new` or `sub=sale` link opens the store
      // before it arrives, and a refreshed catalog may have what the cached
      // one lacked.
      if (
        groups.length === 0 &&
        (this.cosmeticsSubTab === "sale" || this.cosmeticsSubTab === "new") &&
        this.cosmetics !== null &&
        this.settledCatalogRequest === this.catalogRequest
      ) {
        this.cosmeticsSubTab = "patterns";
        return this.cosmeticsGroups("patterns");
      }
      return groups;
    }
    if (tab === "featured") {
      const sections = this.featuredSections();
      this.featuredNewGroups = sections.new;
      return [
        ...(sections.deal ? [sections.deal] : []),
        ...sections.new,
        ...sections.sale,
      ];
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
            ((resolved.relationship === "purchasable" &&
              this.sellable(resolved)) ||
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
    this.trackClick(resolved, this.productFor(resolved));
    if (resolved.type === "cosmeticPack") this.openedPack = resolved;
    if (isPreviewableCosmetic(resolved)) this.previewingCosmetic = resolved;
    this.inspect(resolved);
  }

  // Store analytics. The tracker is made on the first open and kept.
  private tracker: StoreTracker | null = null;

  /**
   * Where a card sits in the store; purchases are placed the same way.
   * Undefined before a tab is active, or for anything on Featured outside
   * its sections: no placement is sent then.
   */
  private placementFor(el: Element): StorePlacement | undefined {
    const section = el.closest<HTMLElement>("[data-featured-section]")?.dataset
      .featuredSection;
    if (isFeaturedSection(section)) return { kind: "featured", section };
    if (el.closest("[data-store-flash]")) return { kind: "flash" };
    if (this.affiliateCode) return { kind: "affiliate" };
    const tab = this.activeTab;
    if (!isStoreTab(tab)) return undefined;
    if (tab === "cosmetics") {
      return { kind: "tab", tab, subTab: this.cosmeticsSubTab };
    }
    return { kind: "tab", tab };
  }

  // Cards are tracked under their item key; the tracker folds a pattern's
  // palette keys into the pattern card's key (`pattern:<name>`), so
  // data-cosmetic-key stays the palette key the store selects by.
  private observeProducts(): void {
    if (this.tracker === null || typeof IntersectionObserver === "undefined") {
      return;
    }
    // One prune per update, not one per card.
    this.tracker.releaseDetached();
    for (const el of this.querySelectorAll<HTMLElement>(
      "[data-store-product][data-cosmetic-key]",
    )) {
      const key = el.dataset.cosmeticKey;
      const placement = this.placementFor(el);
      if (key && placement) this.tracker.observe(el, key, placement);
    }
  }

  /**
   * The flash deal's card, for the store experiment exposure (Experiments.ts),
   * which has its own trigger apart from the analytics above. Only purchasable
   * items reach the hero, so the card always shows a price.
   */
  private observeFlashExposure(): void {
    const flash = this.querySelector(FLASH_EXPOSURE_SELECTOR);
    if (flash !== null && this.isModalOpen) {
      // Only once the card shows the catalog now in use: in the Android app
      // this.cosmetics is swapped in after Play's prices arrive, which can
      // be after the new group's catalog (and its generation) landed.
      exposureWatcher.observe(
        flash,
        "store_flash",
        () =>
          this.cosmetics !== null && this.cosmetics === getCachedCosmetics(),
      );
    }
  }

  /** The tile showing this item, or one of its variants. */
  private productFor(resolved: ResolvedCosmetic): Element | null {
    for (const el of this.querySelectorAll<HTMLElement>(
      "[data-store-product][data-cosmetic-key]",
    )) {
      const card = el as Partial<CosmeticCard>;
      if (
        el.dataset.cosmeticKey === resolved.key ||
        card.resolved?.key === resolved.key ||
        card.variants?.some((variant) => variant.key === resolved.key)
      ) {
        return el;
      }
    }
    return null;
  }

  private trackClick(resolved: ResolvedCosmetic, el: Element | null): void {
    try {
      const placement = this.placementFor(el ?? this);
      if (placement) this.tracker?.click(resolved.key, placement);
    } catch {
      // Analytics must never break the click.
    }
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
    this.selectVisible(this.groupsForTab(key));
    this.requestUpdate();
  }

  /**
   * The sub-tabs to show: "New" only while something is new, "On sale" only
   * while something is discounted.
   */
  private visibleCosmeticsSubTabs(): CosmeticsSubTab[] {
    const hasNew = this.cosmeticsGroups("new").length > 0;
    const hasSale = this.cosmeticsGroups("sale").length > 0;
    const hasCard = cardStoreItems(this.cosmetics).length > 0;
    return COSMETICS_SUB_TABS.filter(
      (tab) =>
        // The selected one stays while groupsForTab holds it for a pending
        // catalog fetch, so the bar still shows where the player is.
        tab === this.cosmeticsSubTab ||
        ((tab !== "new" || hasNew) &&
          (tab !== "sale" || hasSale) &&
          (tab !== "card" || hasCard)),
    );
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
    withAction = true,
  ): TemplateResult {
    return html`${groups.map((group) => {
      const focused = group.find((item) => item.key === this.inspected?.key);
      const active = focused ?? group[0];
      const action = withAction
        ? this.renderCardAction(active, userHasSubscription)
        : nothing;
      return html`<cosmetic-card
        data-store-product
        data-cosmetic-key=${group[0].key}
        class=${cardClass}
        previewSize=${previewSize}
        showNewBadge
        .resolved=${group[0]}
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
      promotion?: PricedItem["promotion"];
      rarity?: string;
    } | null;
    const isPurchasable = resolved.relationship === "purchasable";
    // In the Android app the only real-money price is Play's own, in the
    // player's currency, and the only real-money button is a Play purchase.
    const playOnly = sellsOnlyThroughPlay();
    const playPrice = isPurchasable ? this.playPrice(resolved) : null;
    // Only packs and subscriptions still check out in USD; cosmetics are
    // currency-only (their catalog product is always null now, but a cached
    // cosmetics.json may still carry one — never render a dollar button).
    const product =
      isPurchasable &&
      !playOnly &&
      (resolved.type === "pack" || resolved.type === "subscription")
        ? (priced?.product ?? null)
        : null;
    // A tier with no Stripe listing (sold only on Steam) has no `product`;
    // its price is the tier's own, in cents.
    const subscriptionDollarPrice =
      isPurchasable &&
      !playOnly &&
      resolved.type === "subscription" &&
      product === null
        ? formatUsdCents((resolved.cosmetic as Subscription).priceMonthly)
        : "";
    const dollarPrice = playPrice ?? subscriptionDollarPrice;
    // The price as the server charges it now: once the item's own sale has
    // ended that is its list price, whatever the catalog in hand says.
    // Read through the same shownPrice as the Inventory; the button also
    // gets the promotion, so it switches to the list price when the sale
    // ends while the Store is open.
    const hard = isPurchasable && priced ? shownPrice(priced, "hard") : null;
    const soft = isPurchasable && priced ? shownPrice(priced, "soft") : null;
    // Resolved when clicked, from the card holding the button, so a purchase
    // from the flash hero is placed as flash.
    // Analytics must never break a purchase: a throw means no placement.
    const placement = (): StorePlacement | undefined => {
      try {
        return this.placementFor(this.productFor(resolved) ?? this);
      } catch {
        return undefined;
      }
    };
    // With the price this button shows: the server refuses to charge more.
    const purchase = (method: "dollar" | "hard" | "soft") =>
      purchaseCosmetic(
        resolved,
        method,
        placement(),
        method === "hard"
          ? hard?.price
          : method === "soft"
            ? soft?.price
            : undefined,
      );
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
            placement,
          }
        : null;
    // Reserved currency lines are assigned per visual row by
    // alignPurchaseRows() once the grid has laid out.
    return html`<purchase-button
      .product=${product}
      .dollarPrice=${dollarPrice}
      .inlineCheckout=${inlineCheckout}
      .priceHard=${hard?.price ?? null}
      .priceSoft=${soft?.price ?? null}
      .listPriceHard=${hard?.listPrice ?? null}
      .listPriceSoft=${soft?.listPrice ?? null}
      .promotion=${priced?.promotion ?? null}
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
        product || dollarPrice ? () => purchase("dollar") : undefined
      }
      .onPurchaseHard=${hard !== null ? () => purchase("hard") : undefined}
      .onPurchaseSoft=${soft !== null ? () => purchase("soft") : undefined}
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
      `${this.affiliateCode ?? ""}:${this.activeTab}:${this.cosmeticsSubTab}`,
      groups,
    );
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
            ? "store.no_new_items"
            : this.cosmeticsSubTab === "sale"
              ? "store.no_sale_items"
              : "store.no_skins";
    return html`
      <div
        class="flex flex-nowrap items-center gap-6 overflow-x-auto border-b border-white/10 px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>button:first-of-type]:ms-auto [&>button:last-of-type]:me-auto"
      >
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
            }${translateText(
              tab === "sale"
                ? "store.on_sale"
                : tab === "new"
                  ? "store.new_tab"
                  : `store.${tab}`,
            )}
          </button>`;
        })}
      </div>
      ${
        this.cosmeticsSubTab === "card"
          ? html`<card-store-grid
              .cosmetics=${this.cosmetics}
              .flares=${
                this.userMeResponse === false
                  ? []
                  : (this.userMeResponse.player.flares ?? [])
              }
              .tracker=${this.tracker ?? null}
              .requestedItem=${this.requestedItem}
              .username=${
                this.userMeResponse === false
                  ? ""
                  : (this.userMeResponse.player.username ?? "")
              }
              .badge=${this.cardBadge()}
              @requested-item-shown=${() => (this.requestedItem = null)}
            ></card-store-grid>`
          : flash
            ? html`${this.renderFlashHero(flash)}
              ${(() => {
                // With the flash item the only thing on sale, the hero is the
                // whole tab: no "No skins available" under it.
                const rest = this.visibleGroups.filter(
                  (group) => group !== flash,
                );
                return rest.length > 0
                  ? this.renderBrowser(rest, { emptyTranslationKey: emptyKey })
                  : nothing;
              })()}`
            : this.renderBrowser(this.visibleGroups, {
                emptyTranslationKey: emptyKey,
              })
      }
      ${this.renderPackDialog()}
    `;
  }

  /**
   * The flash sale's item, leading the On sale tab: its card beside what the
   * sale is and a clock to the next item. On Featured it is the deal section:
   * a compact row on phones, a fixed minimum height (so a rollover placeholder
   * of the same height keeps the rows below in place) and the local time the
   * next deal starts. Only the On sale tab's hero is placed as `flash`.
   */
  private renderFlashHero(
    group: readonly ResolvedCosmetic[],
    featured = false,
  ): TemplateResult {
    const sale = group
      .map((resolved) => activeSale(resolved.cosmetic))
      .find((found) => found !== null);
    if (!sale) return html``;
    // The variant the player is looking at: the hero's buy button pays for it.
    const active =
      group.find((item) => item.key === this.inspected?.key) ?? group[0];
    const title = translateText("store.flash_sale_hero_title", {
      name: cosmeticSelectionLabel(group[0]),
      percent: sale.percentOff,
    });
    const card = this.renderCosmeticCards(
      [group],
      false,
      undefined,
      "card",
      false,
    );
    const countdown = (size: string) =>
      html`<span
        class="flex items-baseline gap-2 rounded-lg bg-black/30 px-3 py-2 text-xs font-bold uppercase tracking-wider text-dawn-blue"
      >
        ${translateText("store.flash_ends_in")}
        <sale-countdown
          class="${size} font-black normal-case tracking-normal tabular-nums text-white"
          format="clock"
          .endsAt=${sale.endsAt}
        ></sale-countdown>
      </span>`;
    if (featured) {
      return html`<section
        data-featured-section="deal"
        data-featured-deal-hero
        class="mx-3 mt-3 flex min-h-56 flex-row items-center gap-4 rounded-xl border border-aquarius/50 bg-gradient-to-br from-deep-navy via-deep-navy to-malibu-blue/50 p-4 shadow-[0_0_28px_rgba(63,169,245,0.25)] sm:min-h-72 sm:items-stretch"
      >
        <div class="w-32 shrink-0 sm:w-52">${card}</div>
        <div
          class="flex min-w-0 flex-1 flex-col items-start justify-center gap-2 sm:gap-3"
        >
          <span
            class="text-xs font-black uppercase tracking-widest text-aquarius sm:text-sm"
          >
            ${translateText("store.flash_sale")}
          </span>
          <span class="text-lg font-black leading-tight text-white sm:text-2xl"
            >${title}</span
          >
          <span class="hidden max-w-sm text-sm text-dawn-blue sm:block"
            >${translateText("store.flash_sale_hero_body")}</span
          >
          <div
            data-store-flash-buy
            class="w-full max-w-xs [&_button]:min-h-11 [&_button]:text-lg sm:[&_button]:min-h-14 sm:[&_button]:text-2xl [&_s]:text-sm [&_s]:text-white/75 sm:[&_s]:text-base"
          >
            ${this.renderCardAction(active, false)}
          </div>
          ${countdown("text-xl sm:text-2xl")}
          <span data-featured-deal-at class="text-xs text-dawn-blue"
            >${translateText("store.featured_next_deal_at", {
              time: localTime(sale.endsAt),
            })}</span
          >
        </div>
      </section>`;
    }
    return html`<section
      data-store-flash
      class="mx-3 mt-3 flex flex-col items-center gap-4 rounded-xl border border-aquarius/50 bg-gradient-to-br from-deep-navy via-deep-navy to-malibu-blue/50 p-4 shadow-[0_0_28px_rgba(63,169,245,0.25)] sm:flex-row sm:items-stretch"
    >
      <div class="w-44 shrink-0 sm:w-52">${card}</div>
      <div
        class="flex flex-1 flex-col items-center justify-center gap-3 text-center sm:items-start sm:text-left"
      >
        <span
          class="flex items-center gap-1.5 text-sm font-black uppercase tracking-widest text-aquarius"
        >
          ${translateText("store.flash_sale")}
        </span>
        <span class="text-2xl font-black leading-tight text-white"
          >${title}</span
        >
        <span class="max-w-sm text-sm text-dawn-blue"
          >${translateText("store.flash_sale_hero_body")}</span
        >
        <!-- The price, and the way to pay it, beside the offer at full size
             rather than small on the card: the card above carries none. -->
        <div
          data-store-flash-buy
          class="w-full max-w-xs [&_button]:min-h-14 [&_button]:text-2xl [&_s]:text-base [&_s]:text-white/75"
        >
          ${this.renderCardAction(active, false)}
        </div>
        ${countdown("text-2xl")}
      </div>
    </section>`;
  }

  /** The Featured tab: loading, error, empty, or its sections in order. */
  private renderFeatured(): TemplateResult {
    if (this.cosmetics === null) {
      const failed =
        this.catalogRequest > 0 &&
        this.settledCatalogRequest === this.catalogRequest;
      return failed ? this.renderFeaturedError() : this.renderFeaturedLoading();
    }
    const sections = this.featuredSections();
    const deal = this.renderFeaturedDeal(sections.deal);
    if (
      deal === nothing &&
      sections.new.length === 0 &&
      sections.sale.length === 0
    ) {
      // A stale catalog with nothing to feature: the refetch (or a sale-end
      // retry) may bring something, so wait for it before saying so.
      if (
        this.catalogRequest !== this.settledCatalogRequest ||
        this.saleRetryTimer !== null
      ) {
        return this.renderFeaturedLoading();
      }
      return html`<div
        data-featured-empty
        class="py-8 text-center text-sm font-bold uppercase tracking-wider text-white/40"
      >
        ${translateText("store.featured_empty")}
      </div>`;
    }
    return html`<div data-featured class="pb-3">
        ${deal} ${this.renderFeaturedRow("new", sections.new)}
        ${this.renderFeaturedRow("sale", sections.sale)}
      </div>
      ${this.renderPackDialog()}`;
  }

  /** The deal slot: the hero, the owned strip, the rollover placeholder or nothing. */
  private renderFeaturedDeal(
    deal: Group | undefined,
  ): TemplateResult | typeof nothing {
    const owned = deal === undefined ? this.ownedFlashDeal() : null;
    if (deal === undefined && owned === null && this.dealRollover !== null) {
      const height = this.dealRollover.height;
      return html`<div
        data-featured-section="deal"
        data-featured-rollover
        style=${height !== null ? `height: ${height}px` : nothing}
        class="mx-3 mt-3 flex flex-col items-center justify-center rounded-xl bg-white/5 ${
          height === null ? "min-h-56 sm:min-h-72" : ""
        }"
      >
        <div
          class="h-28 w-full max-w-md animate-pulse rounded-lg bg-white/5"
        ></div>
        <p
          class="mt-3 text-sm font-bold uppercase tracking-wider text-white/40"
        >
          ${translateText("store.featured_next_deal_loading")}
        </p>
      </div>`;
    }
    if (deal !== undefined) {
      this.shownFlashPromotionId =
        deal
          .map(
            (item) =>
              (item.cosmetic as { promotion?: { id: string } } | null)
                ?.promotion?.id,
          )
          .find((id) => id !== undefined) ?? null;
      return this.renderFlashHero(deal, true);
    }
    if (owned !== null) {
      this.shownFlashPromotionId = owned.promotionId;
      return html`<div
        data-featured-section="deal"
        data-featured-deal-owned
        class="mx-3 mt-3 flex flex-col gap-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm sm:flex-row sm:items-center sm:gap-3"
      >
        <span class="min-w-0 font-semibold text-dawn-blue sm:flex-1"
          >${translateText("store.featured_deal_owned", {
            name: owned.name,
          })}</span
        >
        <span
          class="flex flex-wrap items-baseline gap-x-2 text-xs font-bold uppercase tracking-wider text-dawn-blue"
        >
          ${translateText("store.featured_next_deal_in")}
          <sale-countdown
            class="text-base font-black normal-case tracking-normal tabular-nums text-white"
            format="clock"
            .endsAt=${owned.endsAt}
          ></sale-countdown>
          <span data-featured-deal-at class="font-semibold normal-case"
            >${translateText("store.featured_next_deal_at", {
              time: localTime(owned.endsAt),
            })}</span
          >
        </span>
      </div>`;
    }
    return nothing;
  }

  /** A Featured row: a heading, "See all", and one row of cards. */
  private renderFeaturedRow(
    section: "new" | "sale",
    groups: readonly Group[],
  ): TemplateResult | typeof nothing {
    if (groups.length === 0) return nothing;
    const headingId = `store-featured-${section}-heading`;
    // featuredSections keeps only what fits one row at this width.
    const cardClass = "block h-full min-w-0";
    return html`<div data-featured-section=${section}>
      <div
        class="mx-3 mt-4 flex items-center justify-between gap-3 border-b border-white/10 pb-2"
      >
        <h3
          id=${headingId}
          class="text-sm font-black uppercase tracking-wider text-white/70"
        >
          ${translateText(section === "new" ? "store.new_tab" : "store.on_sale")}
        </h3>
        <button
          data-featured-see-all=${section}
          aria-describedby=${headingId}
          class="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-black uppercase tracking-wider text-white transition-colors hover:bg-white/10"
          @click=${() => this.openCosmeticsSubTab(section)}
        >
          ${translateText("store.see_all")}
        </button>
      </div>
      <div
        data-featured-grid
        class="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 xl:grid-cols-4"
      >
        ${groups.map((group) =>
          this.renderCosmeticCards([group], false, cardClass),
        )}
      </div>
    </div>`;
  }

  private renderFeaturedLoading(): TemplateResult {
    const square = (i: number) =>
      i === 2 ? "hidden sm:block" : i === 3 ? "hidden xl:block" : "";
    return html`<div data-featured-loading aria-busy="true">
      <span class="sr-only">${translateText("common.loading")}</span>
      <div
        class="mx-3 mt-3 min-h-56 animate-pulse rounded-xl bg-white/5 sm:min-h-72"
      ></div>
      <div class="mx-3 mt-4 h-6 w-32 animate-pulse rounded bg-white/5"></div>
      <div class="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 xl:grid-cols-4">
        ${[0, 1, 2, 3].map(
          (i) =>
            html`<div
              class="${square(i)} aspect-square animate-pulse rounded-xl bg-white/5"
            ></div>`,
        )}
      </div>
    </div>`;
  }

  private renderFeaturedError(): TemplateResult {
    return html`<div
      data-featured-error
      class="flex flex-col items-center gap-4 p-8 text-center text-red-300"
    >
      <p>${translateText("store.load_failed")}</p>
      <button
        data-featured-retry
        class="rounded-lg bg-blue-600 px-4 py-2 font-bold text-white"
        @click=${() => void this.retryCatalog()}
      >
        ${translateText("store.retry")}
      </button>
    </div>`;
  }

  /** Featured's Retry: the skeleton shows while the fetch runs. */
  private async retryCatalog(): Promise<void> {
    const loading = this.loadCatalog();
    this.requestUpdate();
    await loading;
    this.selectVisible(this.groupsForTab(this.activeTab));
    this.requestUpdate();
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
    // there is no longer a rail on which this card is a dead button. Not in
    // the Android app, though, where Play sells only its fixed packs; there a
    // Play that could not price them says so instead.
    const playOnly = sellsOnlyThroughPlay();
    return this.renderBrowser(this.visibleGroups, {
      emptyTranslationKey: "store.no_packs",
      trailingContent: !playOnly
        ? html`<custom-currency-card
            class="block w-[calc(50%-0.5rem)] max-w-48 shrink-0 sm:w-48"
          ></custom-currency-card>`
        : this.cosmetics !== null && this.playPrices === null
          ? html`<div
              data-store-play-unavailable
              class="w-full py-8 text-center text-sm font-bold uppercase tracking-wider text-white/40"
            >
              ${translateText("store.play_unavailable")}
            </div>`
          : undefined,
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
    })}${this.renderPackDialog()}`;
  }

  /**
   * The contents of the bundle a player opened, from Bundles or from
   * Cosmetics → New / On sale, which list bundles too.
   */
  private renderPackDialog(): TemplateResult | string {
    // The dialog is portaled above the modal's stacking context, so a preview
    // opened from one of its items would render underneath it. Yield to the
    // preview; the dialog comes back when it closes.
    if (!this.openedPack || this.previewingCosmetic) return "";
    return html`<pack-contents-dialog
      .pack=${this.openedPack}
      .actionContent=${this.renderCardAction(this.openedPack, false)}
      @close=${() => this.closePack()}
    ></pack-contents-dialog>`;
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
    this.scheduleNewEnd();
    const shown = visibleBannerSales(
      salesPlayerCanBuy(sales, this.cosmetics, this.resolvedPurchasables()),
    );
    if (shown.length === 0) return "";
    return html`<sale-banner
      class="block px-3 pt-2"
      .sales=${shown}
      .cosmetics=${this.cosmetics}
      @open-sale=${() => this.openCosmeticsSubTab("sale")}
    ></sale-banner>`;
  }

  /**
   * Cosmetics → On sale or New: from the flash sale's banner line, or from a
   * Featured row's "See all".
   */
  private openCosmeticsSubTab(sub: "sale" | "new"): void {
    this.cosmeticsSubTab = sub;
    if (this.activeTab === "cosmetics") {
      this.setCosmeticsSubTab(sub);
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
    const now = Date.now();
    // A redraw after the sale ended, before its timer ran (or after the
    // clock jumped), sees no running sale: refetch now rather than lose it.
    const overdue = this.saleEndTimer !== null && this.saleEndAt <= now;
    if (this.saleEndTimer !== null) clearTimeout(this.saleEndTimer);
    this.saleEndTimer = null;
    if (!this.isModalOpen) return;
    if (!overdue && sales.length === 0) return;
    const nextEnd = overdue
      ? now
      : Math.min(...sales.map((s) => new Date(s.endsAt).getTime()));
    this.saleEndAt = nextEnd;
    // setTimeout overflows past ~24.8 days; a later end is rescheduled by a
    // later render.
    const delay = Math.min(Math.max(nextEnd - now, 0), 2 ** 31 - 1);
    this.saleEndTimer = setTimeout(() => {
      this.saleEndTimer = null;
      this.beginDealRollover();
      void this.refetchAfterSaleEnd(0);
    }, delay);
  }

  /**
   * The flash deal Featured showed has just ended: hold its slot, at the
   * height it had, until the next deal arrives or the refetch gives up.
   */
  private beginDealRollover(): void {
    if (!this.isModalOpen || this.affiliateCode !== null) return;
    const now = Date.now();
    const ended = (this.cosmetics?.promotions ?? []).some(
      (sale) =>
        sale.kind === "flash" &&
        new Date(sale.endsAt).getTime() <= now &&
        sale.id === this.shownFlashPromotionId,
    );
    if (!ended) return;
    const slot = this.querySelector('[data-featured-section="deal"]');
    this.dealRollover = {
      height: slot ? slot.getBoundingClientRect().height : null,
    };
    this.requestUpdate();
  }

  private endDealRollover(): void {
    if (this.dealRollover === null) return;
    this.dealRollover = null;
    // The ended deal is done with: a later sale ending (one the API still
    // serves) must not start the placeholder again. The next render sets
    // this to the deal it draws, if any.
    this.shownFlashPromotionId = null;
    this.requestUpdate();
  }

  /**
   * When the soonest new item stops being new, drop its badge, and the New
   * tab with its last item. No refetch: the catalog's newUntil already says
   * when. Rescheduled on every render; cleared on close.
   */
  private scheduleNewEnd(): void {
    const now = Date.now();
    // Something on screen has already stopped being new: the deadline passed
    // before its timer ran (or the clock jumped), or before the first render.
    const overdue =
      (this.newEndTimer !== null && this.newEndAt <= now) ||
      (this.activeTab === "cosmetics" &&
        this.cosmeticsSubTab === "new" &&
        this.affiliateCode === null &&
        this.visibleGroups.some((group) => !groupIsNew(group))) ||
      (this.activeTab === "featured" &&
        this.affiliateCode === null &&
        this.featuredNewGroups.some((group) => !groupIsNew(group)));
    if (!this.isModalOpen) {
      this.clearNewEnd();
      return;
    }
    const ends = this.resolvedPurchasables().flatMap((resolved) => {
      const at = newUntilMs(resolved.cosmetic);
      return at !== null && at > now ? [at] : [];
    });
    if (!overdue && ends.length === 0) {
      this.clearNewEnd();
      return;
    }
    // setTimeout overflows past ~24.8 days; newUntil is at most 14 days out.
    const delay = overdue ? 0 : Math.min(Math.min(...ends) - now, 2 ** 31 - 1);
    // Most redraws don't move the deadline: keep the timer already set.
    if (
      !overdue &&
      this.newEndTimer !== null &&
      this.newEndAt === now + delay
    ) {
      return;
    }
    this.clearNewEnd();
    this.newEndAt = now + delay;
    this.newEndTimer = setTimeout(() => {
      this.newEndTimer = null;
      // Only Cosmetics → New and Featured change which cards they list; other
      // tabs (an Effects category, say) keep their own selection and redraw.
      if (
        (this.activeTab === "cosmetics" || this.activeTab === "featured") &&
        this.affiliateCode === null
      ) {
        this.selectVisible(this.groupsForTab(this.activeTab));
      }
      // The cards' own properties haven't changed, so ask them to redraw.
      for (const card of this.querySelectorAll<CosmeticCard>("cosmetic-card")) {
        card.requestUpdate();
      }
      this.requestUpdate();
    }, delay);
  }

  private clearNewEnd(): void {
    if (this.newEndTimer !== null) clearTimeout(this.newEndTimer);
    this.newEndTimer = null;
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
    try {
      return await this.fetchCatalog(request);
    } finally {
      // An older fetch landing after a newer one started settles nothing.
      if (request === this.catalogRequest) this.settledCatalogRequest = request;
    }
  }

  private async fetchCatalog(request: number): Promise<Cosmetics | null> {
    const fresh = await fetchCosmetics();
    // In the Android app, Play prices the packs it sells, in the player's
    // own currency.
    const playPrices = sellsOnlyThroughPlay()
      ? await fetchPlayPrices(playProductIds(fresh ?? this.cosmetics))
      : null;
    if (request === this.catalogRequest) {
      this.cosmetics = fresh ?? this.cosmetics;
      this.playPrices = playPrices;
      // The next deal is here: the hero (or the owned strip) comes back.
      if (
        this.dealRollover !== null &&
        (this.featuredSections().deal !== undefined ||
          this.ownedFlashDeal() !== null)
      ) {
        this.endDealRollover();
      }
    }
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
    // Closed (and maybe reopened) since: that open's own fetch wins. The
    // deal placeholder is left alone: onClose cleared this open's, and one
    // the new open has set is that open's to clear.
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
    } else {
      // No more retries, whatever the catalog holds: the slot shows the hero,
      // the owned strip, or nothing (a next item the player can neither buy
      // nor own), never the placeholder for good.
      this.endDealRollover();
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
      case "featured":
        // Never sat on while hidden (onOpen moves it to Packs); a fallback.
        return this.featuredVisible
          ? this.renderFeatured()
          : this.renderPackGrid();
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
    this.tracker ??= new StoreTracker();
    this.tracker.beginPageView();
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
    // `sub=sale` (the home screen's sale banner) opens Cosmetics → On sale,
    // `sub=new` Cosmetics → New; groupsForTab falls back to Skins if nothing
    // is on sale or new by now.
    if (args?.sub === "sale" || args?.sub === "new") {
      this.cosmeticsSubTab = args.sub;
    }
    // `sub=card`: the Inventory's Player card tab ("More … in the Store").
    if (args?.sub === "card") this.cosmeticsSubTab = "card";
    this.chooseOpeningTab(args, affiliate);
    // Prices change when a sale starts or ends, so a catalog fetched more than
    // a minute ago is refetched rather than shown with stale prices. In the
    // Android app, Play is asked again if it could not price the packs.
    if (
      refreshStaleCosmetics() ||
      this.cosmetics === null ||
      (sellsOnlyThroughPlay() && this.playPrices === null)
    ) {
      await this.loadCatalog();
    }
    // A catalog still carrying a sale that has ended (the store was closed
    // while the sale-end refetch was retrying, then reopened within the
    // stale window) would show its prices with no banner: refetch it. Started
    // before the render, so Featured shows loading rather than its empty line.
    if (hasEndedSale(this.cosmetics)) void this.refetchAfterSaleEnd(0);
    this.selectVisible(this.groupsForTab(this.activeTab));
    await this.refresh();
  }

  /**
   * Which tab an open lands on, set before onOpen's first await so BaseModal
   * enters it once. A valid `tab` is BaseModal's to apply. `sub` or `item`
   * without one opens Cosmetics. Anything else is untargeted: its first
   * onOpen lands on Featured, or on Packs while Featured is hidden; a router
   * call that follows on the already-open store changes nothing.
   */
  private chooseOpeningTab(
    args: Record<string, unknown> | undefined,
    affiliate: string | null,
  ): void {
    const first = this.firstOnOpen;
    this.firstOnOpen = false;
    if (affiliate === null) {
      const tabs = this.modalConfig().tabs ?? [];
      const validTab =
        typeof args?.tab === "string" && tabs.some((t) => t.key === args.tab);
      const targetsItem =
        typeof args?.sub === "string" || typeof args?.item === "string";
      if (!validTab && targetsItem) {
        if (first) this.activeTab = "cosmetics";
        else this.setActiveTab("cosmetics");
      } else if (!validTab && first) {
        this.activeTab = this.featuredVisible ? "featured" : "packs";
      }
    }
    // Never sit on a Featured tab this open doesn't show.
    if (this.activeTab === "featured" && !this.featuredVisible) {
      this.activeTab = "packs";
    }
  }

  protected onClose(): void {
    this.tracker?.flush();
    // The store hides rather than disconnects: stop the flash card's exposure
    // clock now, before the observer reports it hidden. Reopening re-observes.
    const flash = this.querySelector(FLASH_EXPOSURE_SELECTOR);
    if (flash !== null) exposureWatcher.unobserve(flash);
    this.dealRollover = null;
    this.shownFlashPromotionId = null;
    if (this.saleEndTimer !== null) clearTimeout(this.saleEndTimer);
    this.saleEndTimer = null;
    this.clearNewEnd();
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
    // Likewise the Card sub-tab's large preview: left open, its Tab trap
    // would hold keyboard focus on a hidden page.
    this.querySelector<CardStoreGrid>("card-store-grid")?.closePreview();
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
