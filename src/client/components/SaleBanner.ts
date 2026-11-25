import type { Cosmetics, Promotion } from "@openfront/shared/CosmeticSchemas";
import type { TemplateResult } from "lit";
import { html, LitElement, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { ResolvedCosmetic } from "../Cosmetics";
import { activeSale, translateCosmetic } from "../Cosmetics";
import { isSteamShell } from "../DesktopShell";
import { exposureWatcher } from "../Experiments";
import { UserSettings } from "../UserSettings";
import { translateText } from "../Utils";
import "./SaleCountdown";

/**
 * The sales a banner shows: all of them, or none when the player, in the Steam
 * app, has turned the sale banners off in account settings (sales and flash
 * deals alike). The switch only exists in the Steam app, so the setting is
 * ignored anywhere else: on the web or the other apps, banners always show.
 */
export function bannerSales(
  sales: Promotion[],
  inSteamApp: boolean,
  hideBanners: boolean,
): Promotion[] {
  return inSteamApp && hideBanners ? [] : sales;
}

/** {@link bannerSales} for this client and its saved setting. */
export function visibleBannerSales(sales: Promotion[]): Promotion[] {
  return bannerSales(
    sales,
    isSteamShell(),
    new UserSettings().hideSaleBanners(),
  );
}

/** The catalog's sales that haven't ended yet, of `only` if given. */
export function runningSales(
  cosmetics: Cosmetics | null,
  only: ReadonlySet<string> | null = null,
  now: number = Date.now(),
): Promotion[] {
  return (cosmetics?.promotions ?? []).filter(
    (sale) =>
      new Date(sale.endsAt).getTime() > now &&
      (only === null || only.has(sale.id)),
  );
}

/** Every item in the catalog a sale can discount, effects unnested. */
function catalogItems(cosmetics: Cosmetics): object[] {
  return [
    ...Object.values(cosmetics.patterns ?? {}),
    ...Object.values(cosmetics.flags ?? {}),
    ...Object.values(cosmetics.crowns ?? {}),
    ...Object.values(cosmetics.skins ?? {}),
    ...Object.values(cosmetics.packs ?? {}),
    ...Object.values(cosmetics.effects ?? {}).flatMap((byName) =>
      Object.values(byName ?? {}),
    ),
  ];
}

/**
 * Every item a sale can be tagged on (every catalog section whose items can
 * carry a `promotion`): the cosmetics, plus the currency packs, subscriptions
 * and player card items, which the On sale tab doesn't list.
 */
function taggableItems(cosmetics: Cosmetics): object[] {
  return [
    ...catalogItems(cosmetics),
    ...Object.values(cosmetics.currencyPacks ?? {}),
    ...Object.values(cosmetics.subscriptions ?? {}),
    ...Object.values(cosmetics.playerCards ?? {}),
    ...Object.values(cosmetics.cardTrackers ?? {}),
    ...Object.values(cosmetics.cardBackgrounds ?? {}),
    ...Object.values(cosmetics.cardTitles ?? {}),
    ...Object.values(cosmetics.taunts ?? {}),
    ...Object.values(cosmetics.unlistedSubscriptions ?? {}),
  ];
}

/**
 * The kinds of item the Store's On sale tab lists (`cosmeticsGroups("sale")`).
 * A sale tagged only on anything else (a currency pack, a subscription) would
 * send the player to an empty tab.
 */
const ON_SALE_TAB_TYPES: ReadonlySet<ResolvedCosmetic["type"]> = new Set([
  "pattern",
  "skin",
  "flag",
  "crown",
  "effect",
  "cosmeticPack",
]);

const promotionIdOf = (item: unknown): string | undefined =>
  (item as { promotion?: { id: string } } | null)?.promotion?.id;

/**
 * The sales this player can buy something in. A sale whose discounted items
 * the player can't buy (a flash deal on an item they already own, say) would
 * send them to an On sale tab without it, so its banner is left out. A sale
 * the catalog tags no item with (an older or partial catalog) is kept. Only
 * what the On sale tab lists counts as buyable. `purchasable` is the catalog
 * resolved for the player, filtered to what the store would sell them.
 */
export function salesPlayerCanBuy(
  sales: Promotion[],
  cosmetics: Cosmetics | null,
  purchasable: readonly ResolvedCosmetic[],
  now: number = Date.now(),
): Promotion[] {
  if (cosmetics === null) return sales;
  const tagged = new Set(taggableItems(cosmetics).map(promotionIdOf));
  const buyable = new Set(
    purchasable
      .filter(
        (resolved) =>
          ON_SALE_TAB_TYPES.has(resolved.type) &&
          activeSale(resolved.cosmetic, now) !== null,
      )
      .map((resolved) => promotionIdOf(resolved.cosmetic)),
  );
  return sales.filter((sale) => !tagged.has(sale.id) || buyable.has(sale.id));
}

/**
 * Whether a sale covers every priced item in the catalog, so the banner can
 * say "store-wide" rather than "selected items".
 */
export function saleCoversEverything(
  cosmetics: Cosmetics | null,
  promotionId: string,
): boolean {
  if (cosmetics === null) return false;
  const items = catalogItems(cosmetics) as {
    priceHard?: number;
    promotion?: { id: string };
  }[];
  const priced = items.filter(
    (item) =>
      item.priceHard !== undefined ||
      (item as { priceSoft?: number }).priceSoft !== undefined,
  );
  return (
    priced.length > 0 &&
    priced.every((item) => item.promotion?.id === promotionId)
  );
}

/**
 * The display name of the item a flash sale is on, or null when the catalog
 * doesn't carry it (an older or partial catalog).
 */
export function flashSaleItemName(
  cosmetics: Cosmetics | null,
  promotionId: string,
): string | null {
  if (cosmetics === null) return null;
  type Item = {
    name: string;
    displayName?: string;
    promotion?: { id: string };
  };
  const on = (items: object | undefined): Item | undefined =>
    Object.values(items ?? {}).find(
      (item) => (item as Item).promotion?.id === promotionId,
    ) as Item | undefined;
  const pattern = on(cosmetics.patterns) ?? on(cosmetics.skins);
  if (pattern) {
    return translateCosmetic("territory_patterns.pattern", pattern.name);
  }
  const flag = on(cosmetics.flags);
  if (flag) return translateCosmetic("flags", flag.name);
  const crown = on(cosmetics.crowns);
  if (crown) return translateCosmetic("crowns", crown.name);
  for (const byName of Object.values(cosmetics.effects ?? {})) {
    const effect = on(byName);
    if (effect) return translateCosmetic("effects", effect.name);
  }
  const bundle = on(cosmetics.packs);
  if (bundle) {
    // Same casing as the bundle's card (cosmeticDisplayName).
    return (bundle.displayName ?? bundle.name).replace(
      /(^|[\s-])\p{L}/gu,
      (match) => match.toLocaleUpperCase(),
    );
  }
  return null;
}

/** A banner's closing arrow: on the home screen the banner opens the store. */
const OPEN_ARROW = html`<svg
  data-sale-open
  class="h-4 w-4 shrink-0 text-white/80"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="3"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d="m9 18 6-6-6-6" />
</svg>`;

const STRIP_CLASS =
  "overflow-hidden rounded-lg border border-aquarius/40 bg-gradient-to-r from-deep-navy via-malibu-blue/70 to-malibu-blue shadow-[0_4px_20px_rgba(63,169,245,0.3)]";
const FLASH_LINE_CLASS =
  "flex w-full items-center gap-3 rounded-lg border border-aquarius/60 bg-gradient-to-r from-deep-navy via-malibu-blue/70 to-malibu-blue px-3 py-2 text-left shadow-[0_4px_20px_rgba(63,169,245,0.3)]";
const FLASH_ROW_CLASS =
  "flex w-full items-center gap-2 border-t border-white/15 bg-deep-navy/50 px-3 py-1.5 text-left text-xs font-bold text-white";

/**
 * One strip per running sale: its % off, name, what it covers and a countdown.
 * A flash sale rides along the first sale's strip as a slim row, or takes the
 * strip itself when it runs alone. Fires `open-sale` (bubbling) when clicked:
 * on a flash sale's line, or anywhere when `linked` (the home screen, where
 * the banner leads into the store).
 */
@customElement("sale-banner")
export class SaleBanner extends LitElement {
  /**
   * The sales to show, from {@link runningSales}. The parent works them out on
   * each of its renders, so a sale that ends drops out the next time it renders
   * even if the catalog object hasn't changed.
   */
  @property({ attribute: false })
  sales: Promotion[] = [];

  /** The catalog, to tell a store-wide sale from one on selected items. */
  @property({ attribute: false })
  cosmetics: Cosmetics | null = null;

  /** The whole banner is one button, rather than only a flash sale's line. */
  @property({ type: Boolean })
  linked = false;

  createRenderRoot() {
    return this;
  }

  // On the home screen, the deal line is a store experiment exposure surface
  // (Experiments.ts): watched once it's on screen for a second. The store's
  // own (unlinked) banner isn't: there the flash card is the surface.
  protected updated(): void {
    if (!this.linked) return;
    const line = this.querySelector("[data-store-flash-banner]");
    if (line !== null) exposureWatcher.observe(line, "home_banner");
  }

  private openSale(): void {
    this.dispatchEvent(new CustomEvent("open-sale", { bubbles: true }));
  }

  render() {
    const sales = this.sales;
    if (sales.length === 0) return nothing;
    const flash = sales.find((sale) => sale.kind === "flash");
    const regular = sales.filter((sale) => sale.kind !== "flash");
    const strips =
      regular.length === 0 && flash
        ? this.renderFlashLine(flash)
        : regular.map((sale, index) =>
            this.renderStrip(sale, index === 0 ? flash : undefined),
          );
    if (this.linked) {
      return html`<button
        data-store-sale-banner
        class="flex w-full flex-col gap-1.5 text-left transition-[filter] hover:brightness-110"
        @click=${() => this.openSale()}
      >
        ${strips}
      </button>`;
    }
    return html`<div data-store-sale-banner class="flex flex-col gap-1.5">
      ${strips}
    </div>`;
  }

  private renderStrip(sale: Promotion, flash?: Promotion): TemplateResult {
    const endingSoon =
      new Date(sale.endsAt).getTime() - Date.now() < 86_400_000;
    return html`<div class=${STRIP_CLASS}>
      <div class="flex items-center gap-3 px-3 py-2">
        ${this.renderBadge(sale)}
        <div class="flex min-w-0 flex-1 flex-col leading-tight">
          <span
            class="flex min-w-0 items-center gap-1.5 text-base font-black uppercase tracking-wide text-white"
          >
            <svg
              class="h-4 w-4 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path
                d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z"
              />
              <circle cx="7.5" cy="7.5" r="1.5" fill="currentColor" />
            </svg>
            <span class="truncate">${sale.name}</span>
          </span>
          <span class="truncate text-xs font-semibold text-dawn-blue"
            >${translateText(
              saleCoversEverything(this.cosmetics, sale.id)
                ? "store.sale_store_wide"
                : "store.sale_selected_items",
              { percent: sale.percentOff },
            )}</span
          >
        </div>
        <span
          class="flex shrink-0 items-center gap-1.5 rounded-md bg-deep-navy/60 px-2 py-1 text-xs font-bold tabular-nums ${
            endingSoon ? "text-cyber-yellow" : "text-white"
          }"
          title=${new Date(sale.endsAt).toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        >
          <sale-countdown .endsAt=${sale.endsAt}></sale-countdown>
        </span>
        ${this.linked ? OPEN_ARROW : nothing}
      </div>
      ${flash ? this.renderFlashRow(flash) : nothing}
    </div>`;
  }

  private renderBadge(sale: Promotion): TemplateResult {
    return html`<span
      class="shrink-0 rounded-md bg-aquarius px-2 py-0.5 text-base font-black tabular-nums text-deep-navy shadow-md shadow-black/40"
      >${translateText("store.sale_percent_off", {
        percent: sale.percentOff,
      })}</span
    >`;
  }

  /**
   * What a flash sale is on: the item by name, or "one item" when the catalog
   * doesn't carry it.
   */
  private flashText(
    sale: Promotion,
    namedKey: string,
    unnamedKey: string,
  ): string {
    const name = flashSaleItemName(this.cosmetics, sale.id);
    return name === null
      ? translateText(unnamedKey, { percent: sale.percentOff })
      : translateText(namedKey, { name, percent: sale.percentOff });
  }

  /**
   * A flash sale as a slim row under another sale's strip: the item, and a
   * clock to the end of its deal.
   */
  private renderFlashRow(sale: Promotion): TemplateResult {
    const content = html`<span
        class="shrink-0 uppercase tracking-wider text-aquarius"
        >${translateText("store.flash_sale")}</span
      >
      <span class="min-w-0 truncate font-semibold text-dawn-blue"
        >${this.flashText(
          sale,
          "store.flash_sale_item_row",
          "store.flash_sale_row",
        )}</span
      >
      <span class="ml-auto flex shrink-0 items-center gap-1.5 tabular-nums">
        <span class="hidden font-semibold text-dawn-blue sm:inline"
          >${translateText("store.flash_ends_in")}</span
        >
        <sale-countdown format="clock" .endsAt=${sale.endsAt}></sale-countdown>
        <svg
          class="h-3 w-3 text-dawn-blue"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="3"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
      </span>`;
    // Inside a linked banner the whole banner is the button.
    return this.linked
      ? html`<div data-store-flash-banner class=${FLASH_ROW_CLASS}>
          ${content}
        </div>`
      : html`<button
          data-store-flash-banner
          class="${FLASH_ROW_CLASS} transition-colors hover:bg-deep-navy/70"
          @click=${() => this.openSale()}
        >
          ${content}
        </button>`;
  }

  /**
   * A flash sale running alone: the item, and a clock to the end of its deal
   * (when the next item's starts).
   */
  private renderFlashLine(sale: Promotion): TemplateResult {
    const content = html`${this.renderBadge(sale)}
      <span class="flex min-w-0 flex-1 flex-col leading-tight">
        <span
          class="flex min-w-0 items-center gap-1.5 text-base font-black uppercase tracking-wide text-white"
        >
          <span class="truncate">${translateText("store.flash_sale")}</span>
        </span>
        <span class="truncate text-xs font-semibold text-dawn-blue"
          >${this.flashText(
            sale,
            "store.flash_sale_item_banner",
            "store.flash_sale_banner",
          )}</span
        >
      </span>
      <span
        class="flex shrink-0 items-center gap-1.5 rounded-md bg-deep-navy/60 px-2 py-1 text-xs font-bold tabular-nums text-white"
      >
        <span class="hidden sm:inline"
          >${translateText("store.flash_ends_in")}</span
        >
        <sale-countdown format="clock" .endsAt=${sale.endsAt}></sale-countdown>
      </span>
      ${OPEN_ARROW}`;
    return this.linked
      ? html`<div data-store-flash-banner class=${FLASH_LINE_CLASS}>
          ${content}
        </div>`
      : html`<button
          data-store-flash-banner
          class="${FLASH_LINE_CLASS} transition-[filter] hover:brightness-110"
          @click=${() => this.openSale()}
        >
          ${content}
        </button>`;
  }
}
