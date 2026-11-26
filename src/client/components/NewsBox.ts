import type { NewsItem, UserMeResponse } from "@openfront/shared/ApiSchemas";
import type { Cosmetics } from "@openfront/shared/CosmeticSchemas";
import type { ClientPlatform } from "@openfront/shared/WireSchemas";
import { LitElement, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { getNews } from "../Api";
import { clientPlatform } from "../ClientPlatform";
import {
  fetchCosmetics,
  invalidateCosmetics,
  refreshStaleCosmetics,
  type ResolvedCosmetic,
} from "../Cosmetics";
import { COSMETICS_CHANGED } from "../Experiments";
import { fetchPlayPrices, sellsOnlyThroughPlay } from "../Payments";
import {
  type PlayPrices,
  playProductIds,
  storePurchasables,
} from "../StoreSellable";
import { lastUserMeResponse } from "../UserMeBroadcast";
import {
  HIDE_SALE_BANNERS_KEY,
  USER_SETTINGS_CHANGED_EVENT,
} from "../UserSettings";
import { translateText } from "../Utils";
import {
  runningSales,
  salesPlayerCanBuy,
  visibleBannerSales,
} from "./SaleBanner";
import {
  showSteamAwardsBanner,
  STEAM_AWARDS_NOMINATIONS_END,
} from "./SteamAwardsBanner";

// Re-render when the sale banner setting changes.
const SALE_BANNER_SETTING_EVENT = `${USER_SETTINGS_CHANGED_EVENT}:${HIDE_SALE_BANNERS_KEY}`;

export type { NewsItem };

const DISMISSED_NEWS_KEY = "dismissedNewsItems";
const CYCLE_INTERVAL_MS = 5000;
// After a sale (or a flash sale's slot) ends, the API's one-minute-cached
// catalog can still list it, so the refetch retries (8 x 15s = 2 minutes).
const SALE_END_RETRY_MS = 15_000;
const SALE_END_RETRIES = 8;
// How often an open page looks for a sale that has started since it loaded.
const SALE_RECHECK_MS = 5 * 60_000;
// news.json lists each running sale set to announce as "promotion-<sale id>".
// The sale banner replaces those items.
const SALE_NEWS_PREFIX = "promotion-";

function getDismissedIds(): Set<string> {
  const raw = localStorage.getItem(DISMISSED_NEWS_KEY);
  if (raw) return new Set(JSON.parse(raw));
  return new Set();
}

function saveDismissedIds(ids: Set<string>): void {
  localStorage.setItem(DISMISSED_NEWS_KEY, JSON.stringify([...ids]));
}

export function getVisibleNewsItems(items: NewsItem[]): NewsItem[] {
  const dismissed = getDismissedIds();
  return items.filter((item) => !dismissed.has(item.id));
}

export function filterNewsByPlatform(
  items: NewsItem[],
  platform: ClientPlatform,
): NewsItem[] {
  return items.filter(
    (item) => !item.platforms?.length || item.platforms.includes(platform),
  );
}

const typeLabelKeys: Record<string, string> = {
  tournament: "news_box.tournament",
  tutorial: "news_box.tutorial",
  announcement: "news_box.news",
  warning: "news_box.warning",
};

const typeLabelColors: Record<string, string> = {
  tournament: "bg-amber-500/20 text-amber-300",
  tutorial: "bg-sky-500/20 text-sky-300",
  announcement: "bg-emerald-500/20 text-emerald-300",
  warning: "bg-red-500/20 text-red-300",
};

@customElement("news-box")
export class NewsBox extends LitElement {
  @state() private items: NewsItem[] = [];
  @state() private activeIndex = 0;
  // While a sale runs, the box is its banner rather than the news.
  @state() private cosmetics: Cosmetics | null = null;
  // The sales news.json announces: a sale set not to announce gets no banner.
  @state() private announcedSales: ReadonlySet<string> = new Set();
  private saleTimer: ReturnType<typeof setTimeout> | null = null;
  // Bumped by every catalog the box takes: a read started before it (a slow
  // first fetch) must not put an older catalog back.
  private salesRead = 0;
  // The markdown renderer is its own chunk, loaded alongside the news.
  private renderMarkdown: typeof import("../Markdown").renderMarkdown | null =
    null;
  private cycleTimer: ReturnType<typeof setInterval> | null = null;
  // The signed-in player, so a sale on only what they own gets no banner.
  @state() private userMe: UserMeResponse | false =
    lastUserMeResponse()?.response ?? false;
  // In the Android app: Play's prices for the catalog's packs, which decide
  // whether the Store lists a pack at all.
  private playPrices: PlayPrices = null;
  private playPricesFor: Cosmetics | null = null;
  private purchasableFor: {
    cosmetics: Cosmetics;
    userMe: UserMeResponse | false;
    playPrices: PlayPrices;
    items: ResolvedCosmetic[];
  } | null = null;
  // Drops the Steam Awards banner when nominations close.
  private awardsTimer: ReturnType<typeof setTimeout> | null = null;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener(COSMETICS_CHANGED, this.onCosmeticsChanged);
    globalThis.addEventListener(SALE_BANNER_SETTING_EVENT, this.rerender);
    document.addEventListener("userMeResponse", this.onUserMe);
    this.userMe = lastUserMeResponse()?.response ?? false;
    void this.loadNews();
    void this.loadSales();
    const untilAwardsEnd = STEAM_AWARDS_NOMINATIONS_END - Date.now();
    // setTimeout overflows past ~24.8 days; a page open that long re-renders
    // on its own long before then.
    if (untilAwardsEnd > 0 && untilAwardsEnd < 2 ** 31 - 1) {
      this.awardsTimer = setTimeout(this.rerender, untilAwardsEnd);
    }
  }

  // A refetched catalog (the player's store experiment group landed or
  // changed, or a purchase met a changed price): the banner shows its sales,
  // so a Deeper player sees their group's % here as in the store.
  private onCosmeticsChanged = (event: Event) => {
    const fresh = (event as CustomEvent<Cosmetics>).detail;
    if (!fresh || !this.isConnected) return;
    this.salesRead++;
    // Its sales may end sooner than the next check: reschedule from it,
    // without fetching again.
    this.showSales(fresh, 0);
  };
  private rerender = (): void => this.requestUpdate();

  private onUserMe = (event: Event): void => {
    this.userMe = (event as CustomEvent<UserMeResponse | false>).detail;
  };

  /**
   * What the store would sell this player, by the Store's own rule, resolved
   * once per catalog and account (the box re-renders every few seconds while
   * news cycles). The banner opens the Store without an affiliate code.
   */
  private purchasable(cosmetics: Cosmetics): ResolvedCosmetic[] {
    const cached = this.purchasableFor;
    if (
      cached?.cosmetics === cosmetics &&
      cached.userMe === this.userMe &&
      cached.playPrices === this.playPrices
    ) {
      return cached.items;
    }
    const { userMe, playPrices } = this;
    const items = storePurchasables(cosmetics, userMe, null, playPrices);
    this.purchasableFor = { cosmetics, userMe, playPrices, items };
    return items;
  }

  /**
   * Asks Play for the catalog's pack prices, once per catalog. A failed ask
   * is tried again on the next catalog check.
   */
  private async loadPlayPrices(cosmetics: Cosmetics): Promise<void> {
    if (!sellsOnlyThroughPlay() || this.playPricesFor === cosmetics) return;
    this.playPricesFor = cosmetics;
    let prices: PlayPrices;
    try {
      prices = await fetchPlayPrices(playProductIds(cosmetics));
    } catch (error) {
      console.warn("Play prices unavailable", error);
      if (this.playPricesFor === cosmetics) this.playPricesFor = null;
      return;
    }
    if (this.playPricesFor !== cosmetics) return;
    this.playPrices = prices;
    this.requestUpdate();
  }

  /**
   * Fetches the catalog for its running sales, and keeps it current for as long
   * as the box is up: when the soonest sale ends (so the banner drops it, or
   * moves to a flash sale's next item), and every few minutes in case a sale
   * has started.
   */
  private async loadSales(attempt = 0) {
    const read = ++this.salesRead;
    const cosmetics = await fetchCosmetics();
    if (!this.isConnected || read !== this.salesRead) return;
    this.showSales(cosmetics, attempt);
  }

  /** Shows a catalog's sales and schedules the next check from them. */
  private showSales(cosmetics: Cosmetics | null, attempt: number) {
    if (cosmetics !== null) {
      this.cosmetics = cosmetics;
      void this.loadPlayPrices(cosmetics);
    }
    // Re-render even when the refetch hands back the same catalog: a sale
    // whose end has passed drops out of the banner on time.
    this.requestUpdate();
    this.clearSaleTimer();
    const listsEnded = (cosmetics?.promotions ?? []).some(
      (sale) => new Date(sale.endsAt).getTime() <= Date.now(),
    );
    const retrying =
      (cosmetics === null || listsEnded) && attempt < SALE_END_RETRIES;
    const wait = retrying ? SALE_END_RETRY_MS : SALE_RECHECK_MS;
    // Every running sale, not just the announced ones: news.json may not
    // have landed yet.
    const untilSaleEnds = Math.min(
      Infinity,
      ...runningSales(this.cosmetics).map(
        (sale) => new Date(sale.endsAt).getTime() - Date.now(),
      ),
    );
    const refetch = retrying || untilSaleEnds <= wait;
    this.saleTimer = setTimeout(
      () => void this.recheckSales(refetch, retrying ? attempt + 1 : 0),
      Math.max(Math.min(untilSaleEnds, wait), 0),
    );
  }

  /**
   * One timer's worth of {@link loadSales}. A box nobody can see (a game is on,
   * the tab is in the background, or the window is too short for it) stays on
   * the catalog it has, and catches up within a recheck of being seen again.
   */
  private async recheckSales(refetch: boolean, attempt: number) {
    const seen = !document.hidden && (this.checkVisibility?.() ?? true);
    if (seen) {
      if (refetch) invalidateCosmetics();
      else refreshStaleCosmetics();
    }
    await this.loadSales(attempt);
    // The banner needs news.json to announce a sale, too.
    const unannounced = runningSales(this.cosmetics).some(
      (sale) => !this.announcedSales.has(sale.id),
    );
    if (seen && unannounced && this.isConnected) void this.loadNews();
  }

  private clearSaleTimer() {
    if (this.saleTimer !== null) clearTimeout(this.saleTimer);
    this.saleTimer = null;
  }

  /** The store's On sale tab, where everything the banner covers is listed. */
  private openSale() {
    window.location.hash = "modal=store&tab=cosmetics&sub=sale";
  }

  private async loadNews() {
    try {
      const [news, { renderMarkdown }] = await Promise.all([
        getNews(),
        import("../Markdown"),
      ]);
      if (!this.isConnected) return;
      this.renderMarkdown = renderMarkdown;
      const platformItems = filterNewsByPlatform(news, clientPlatform());
      // Added to, never replaced: a refetch that fails gets the bundled news,
      // which announces nothing, and must not take a running sale's banner
      // away. A sale that has ended drops out through runningSales.
      this.announcedSales = new Set([
        ...this.announcedSales,
        ...platformItems
          .filter((item) => item.id.startsWith(SALE_NEWS_PREFIX))
          .map((item) => item.id.slice(SALE_NEWS_PREFIX.length)),
      ]);
      // The sale banner says these, with a countdown.
      const allItems = platformItems.filter(
        (item) => !item.id.startsWith(SALE_NEWS_PREFIX),
      );
      // Reset stale dismissed list when all items would be hidden
      const visible = getVisibleNewsItems(allItems);
      if (visible.length === 0 && allItems.length > 0) {
        localStorage.removeItem(DISMISSED_NEWS_KEY);
        this.items = allItems;
      } else {
        this.items = visible;
      }
      // A refetch can bring a shorter list than the cycle has moved through.
      if (this.activeIndex >= this.items.length) this.activeIndex = 0;
      this.startCycle();
    } catch (e) {
      console.warn(e);
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener(COSMETICS_CHANGED, this.onCosmeticsChanged);
    globalThis.removeEventListener(SALE_BANNER_SETTING_EVENT, this.rerender);
    document.removeEventListener("userMeResponse", this.onUserMe);
    this.stopCycle();
    this.clearSaleTimer();
    if (this.awardsTimer !== null) clearTimeout(this.awardsTimer);
    this.awardsTimer = null;
  }

  private startCycle() {
    this.stopCycle();
    if (this.items.length > 1) {
      this.cycleTimer = setInterval(() => {
        this.activeIndex = (this.activeIndex + 1) % this.items.length;
      }, CYCLE_INTERVAL_MS);
    }
  }

  private stopCycle() {
    if (this.cycleTimer !== null) {
      clearInterval(this.cycleTimer);
      this.cycleTimer = null;
    }
  }

  private dismiss(id: string) {
    const dismissed = getDismissedIds();
    dismissed.add(id);
    saveDismissedIds(dismissed);
    this.items = this.items.filter((item) => item.id !== id);
    if (this.activeIndex >= this.items.length) {
      this.activeIndex = 0;
    }
    this.startCycle();
  }

  private goTo(index: number) {
    this.activeIndex = index;
    this.startCycle();
  }

  render() {
    // In the Steam app, while Steam Awards nominations are open, a banner
    // asking players to nominate the game takes the news's place. A running
    // sale's banner stays, under it.
    if (!showSteamAwardsBanner()) return this.renderBox();
    const sales = this.renderSales();
    return html`<div class="flex flex-col gap-1.5">
      <steam-awards-banner></steam-awards-banner>
      ${sales}
    </div>`;
  }

  /** The running sales' banner, or nothing when none is running. */
  private renderSales() {
    const running = runningSales(this.cosmetics, this.announcedSales);
    const sales = visibleBannerSales(
      this.cosmetics === null
        ? running
        : salesPlayerCanBuy(
            running,
            this.cosmetics,
            this.purchasable(this.cosmetics),
          ),
    );
    if (sales.length === 0) return nothing;
    return html`<sale-banner
      linked
      .sales=${sales}
      .cosmetics=${this.cosmetics}
      @open-sale=${() => this.openSale()}
    ></sale-banner>`;
  }

  private renderBox() {
    // A running sale takes the box for as long as it runs: no rotation and
    // no dismiss, so it's there every time the player looks.
    const sales = this.renderSales();
    if (sales !== nothing) return sales;
    if (this.items.length === 0) return nothing;

    const item = this.items[this.activeIndex];

    return html`
      <div
        class="px-2 py-2 bg-surface border-y border-white/10 lg:border-y-0 lg:rounded-xl lg:p-3"
      >
        <div class="flex items-center gap-3">
          <span
            class="shrink-0 text-[10px] font-bold tracking-wider px-2 py-0.5 rounded ${
              typeLabelColors[item.type] ?? typeLabelColors["announcement"]
            }"
            >${translateText(
              typeLabelKeys[item.type] ?? typeLabelKeys["announcement"],
            )}</span
          >
          <div class="flex-1 min-w-0">
            ${
              item.url
                ? html`<a
                    href="${item.url}"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="text-sm font-medium text-white hover:text-blue-300 transition-colors truncate block"
                    >${item.title}</a
                  >`
                : html`<span
                    class="text-sm font-medium text-white truncate block"
                    >${item.title}</span
                  >`
            }
            <span
              class="text-xs text-white/50 block [&_a]:text-blue-300 [&_a:hover]:text-blue-200"
              >${this.renderMarkdown?.(
                item.descriptionTranslationKey
                  ? translateText(item.descriptionTranslationKey)
                  : (item.description ?? ""),
              )}</span
            >
          </div>
          ${
            this.items.length > 1
              ? html`
                  <div class="flex gap-1 shrink-0">
                    ${this.items.map(
                      (_, i) => html`
                        <button
                          @click=${() => this.goTo(i)}
                          class="w-1.5 h-1.5 rounded-full transition-colors ${
                            i === this.activeIndex
                              ? "bg-white/60"
                              : "bg-white/20 hover:bg-white/40"
                          }"
                          aria-label="${translateText("news_box.go_to_item", {
                            num: i + 1,
                          })}"
                        ></button>
                      `,
                    )}
                  </div>
                `
              : nothing
          }
          <button
            @click=${() => this.dismiss(item.id)}
            class="shrink-0 p-0.5 text-white/30 hover:text-white/70 transition-colors"
            aria-label="${translateText("news_box.dismiss")}"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              class="w-3.5 h-3.5"
            >
              <path
                d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"
              />
            </svg>
          </button>
        </div>
      </div>
    `;
  }
}
