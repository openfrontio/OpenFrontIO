import type { NewsItem } from "@openfront/shared/ApiSchemas";
import type { Cosmetics } from "@openfront/shared/CosmeticSchemas";
import type { ClientPlatform } from "@openfront/shared/WireSchemas";
import { LitElement, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { getNews } from "../Api";
import { clientPlatform } from "../ClientPlatform";
import { fetchCosmetics, invalidateCosmetics } from "../Cosmetics";
import { translateText } from "../Utils";
import { runningSales } from "./SaleBanner";

export type { NewsItem };

const DISMISSED_NEWS_KEY = "dismissedNewsItems";
const CYCLE_INTERVAL_MS = 5000;
// After a sale (or a flash sale's slot) ends, the API's one-minute-cached
// catalog can still list it, so the refetch retries (8 x 15s = 2 minutes).
const SALE_END_RETRY_MS = 15_000;
const SALE_END_RETRIES = 8;
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
  // The markdown renderer is its own chunk, loaded alongside the news.
  private renderMarkdown: typeof import("../Markdown").renderMarkdown | null =
    null;
  private cycleTimer: ReturnType<typeof setInterval> | null = null;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    void this.loadNews();
    void this.loadSales();
  }

  /**
   * Fetches the catalog for its running sales, and again when the soonest
   * one ends, so the banner drops it (or moves to a flash sale's next item).
   */
  private async loadSales(attempt = 0) {
    const cosmetics = await fetchCosmetics();
    if (!this.isConnected) return;
    if (cosmetics !== null) this.cosmetics = cosmetics;
    // Re-render even when the refetch hands back the same catalog: a sale
    // whose end has passed drops out of the banner on time.
    this.requestUpdate();
    this.clearSaleTimer();
    const listsEnded = (cosmetics?.promotions ?? []).some(
      (sale) => new Date(sale.endsAt).getTime() <= Date.now(),
    );
    if ((cosmetics === null || listsEnded) && attempt < SALE_END_RETRIES) {
      this.saleTimer = setTimeout(() => {
        invalidateCosmetics();
        void this.loadSales(attempt + 1);
      }, SALE_END_RETRY_MS);
      return;
    }
    // Every running sale, not just the announced ones: news.json may not
    // have landed yet.
    const sales = runningSales(this.cosmetics);
    if (sales.length === 0) return;
    const nextEnd = Math.min(...sales.map((s) => new Date(s.endsAt).getTime()));
    // setTimeout overflows past ~24.8 days; a sale ending later is picked up
    // on the next visit.
    const delay = nextEnd - Date.now();
    if (delay > 2 ** 31 - 1) return;
    this.saleTimer = setTimeout(
      () => {
        invalidateCosmetics();
        void this.loadSales();
      },
      Math.max(delay, 0),
    );
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
      this.announcedSales = new Set(
        platformItems
          .filter((item) => item.id.startsWith(SALE_NEWS_PREFIX))
          .map((item) => item.id.slice(SALE_NEWS_PREFIX.length)),
      );
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
      this.startCycle();
    } catch (e) {
      console.warn(e);
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.stopCycle();
    this.clearSaleTimer();
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
    // A running sale takes the box for as long as it runs: no rotation and
    // no dismiss, so it's there every time the player looks.
    if (runningSales(this.cosmetics, this.announcedSales).length > 0) {
      return html`<sale-banner
        linked
        .cosmetics=${this.cosmetics}
        .only=${this.announcedSales}
        @open-sale=${() => this.openSale()}
      ></sale-banner>`;
    }
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
