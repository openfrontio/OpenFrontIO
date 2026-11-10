import type { Cosmetics, Promotion } from "@openfront/shared/CosmeticSchemas";
import type { TemplateResult } from "lit";
import { html, LitElement, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { translateText } from "../Utils";
import "./SaleCountdown";

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

/**
 * Whether a sale covers every priced item in the catalog, so the banner can
 * say "store-wide" rather than "selected items".
 */
export function saleCoversEverything(
  cosmetics: Cosmetics | null,
  promotionId: string,
): boolean {
  if (cosmetics === null) return false;
  const items: { priceHard?: number; promotion?: { id: string } }[] = [
    ...Object.values(cosmetics.patterns ?? {}),
    ...Object.values(cosmetics.flags ?? {}),
    ...Object.values(cosmetics.crowns ?? {}),
    ...Object.values(cosmetics.skins ?? {}),
    ...Object.values(cosmetics.packs ?? {}),
    ...Object.values(cosmetics.effects ?? {}).flatMap((byName) =>
      Object.values(byName ?? {}),
    ),
  ];
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
   * A flash sale as a slim row under another sale's strip: what it is and a
   * clock to the next item.
   */
  private renderFlashRow(sale: Promotion): TemplateResult {
    const content = html`<span
        class="shrink-0 uppercase tracking-wider text-aquarius"
        >${translateText("store.flash_sale")}</span
      >
      <span class="min-w-0 truncate font-semibold text-dawn-blue"
        >${translateText("store.flash_sale_row", {
          percent: sale.percentOff,
        })}</span
      >
      <span class="ml-auto flex shrink-0 items-center gap-1.5 tabular-nums">
        <span class="hidden font-semibold text-dawn-blue sm:inline"
          >${translateText("store.flash_next_in")}</span
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
   * A flash sale running alone: one item at a time, with a clock to the next.
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
          >${translateText("store.flash_sale_banner", {
            percent: sale.percentOff,
          })}</span
        >
      </span>
      <span
        class="flex shrink-0 items-center gap-1.5 rounded-md bg-deep-navy/60 px-2 py-1 text-xs font-bold tabular-nums text-white"
      >
        <span class="hidden sm:inline"
          >${translateText("store.flash_next_in")}</span
        >
        <sale-countdown format="clock" .endsAt=${sale.endsAt}></sale-countdown>
      </span>`;
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
