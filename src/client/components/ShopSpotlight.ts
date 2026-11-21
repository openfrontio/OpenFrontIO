import type { UserMeResponse } from "@openfront/shared/ApiSchemas";
import type { Cosmetics } from "@openfront/shared/CosmeticSchemas";
import { LitElement, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { compactViewportQuery } from "../CompactViewport";
import {
  activeSale,
  currentPrice,
  fetchCosmetics,
  groupCosmeticVariants,
  isNew,
  newUntilMs,
  ResolvedCosmetic,
  resolveCosmetics,
} from "../Cosmetics";
import { lastUserMeResponse } from "../UserMeBroadcast";
import { translateText } from "../Utils";
import "./CapIcon";
import "./CosmeticPreview";
import { cosmeticDisplayName } from "./CosmeticPresentation";
import "./PlutoniumIcon";

const SPOTLIGHT_COUNT = 3;

// Kinds the store can deep-link to by item key (see subTabForItem in Store.ts).
const SPOTLIGHT_TYPES: ReadonlySet<ResolvedCosmetic["type"]> = new Set([
  "pattern",
  "skin",
  "flag",
  "crown",
]);

type PricedCosmetic = Parameters<typeof currentPrice>[0];

function hasPrice(resolved: ResolvedCosmetic): boolean {
  const priced = resolved.cosmetic as PricedCosmetic | null;
  if (priced === null) return false;
  return (
    currentPrice(priced, "hard") !== undefined ||
    currentPrice(priced, "soft") !== undefined
  );
}

/**
 * The store items the homepage spotlight shows: one per pattern (its palette
 * variants count as one), items on sale first, then new ones (newest first),
 * then a random pick of the rest the player doesn't own.
 */
export function pickSpotlightItems(
  items: readonly ResolvedCosmetic[],
  random: () => number = Math.random,
  now: number = Date.now(),
): ResolvedCosmetic[] {
  const groups = groupCosmeticVariants(
    items.filter(
      (r) =>
        r.relationship === "purchasable" &&
        SPOTLIGHT_TYPES.has(r.type) &&
        hasPrice(r),
    ),
  );
  // A group's face: the variant that earns it its place.
  const reps = groups.map(
    (group) =>
      group.find((r) => activeSale(r.cosmetic, now) !== null) ??
      group.find((r) => isNew(r.cosmetic, now)) ??
      group[0],
  );
  const onSale = reps.filter((r) => activeSale(r.cosmetic, now) !== null);
  const fresh = reps
    .filter((r) => !onSale.includes(r) && isNew(r.cosmetic, now))
    .sort(
      (a, b) => (newUntilMs(b.cosmetic) ?? 0) - (newUntilMs(a.cosmetic) ?? 0),
    );
  const rest = reps.filter((r) => !onSale.includes(r) && !fresh.includes(r));
  // Fisher-Yates, so every item is equally likely to fill the remaining slots.
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return [...onSale, ...fresh, ...rest].slice(0, SPOTLIGHT_COUNT);
}

export function storeItemHash(resolved: ResolvedCosmetic): string {
  return `#modal=store&tab=cosmetics&item=${encodeURIComponent(resolved.key)}`;
}

// Homepage "In the Store" panel: three store items, each opening the store on
// itself. Fills the Streaming Now slot while that panel is hidden (fewer than two
// live); play-page hides it (via group-has) whenever Streaming Now is showing. Desktop only, like Streaming Now.
@customElement("shop-spotlight")
export class ShopSpotlight extends LitElement {
  @state() private items: ResolvedCosmetic[] = [];
  private cosmetics: Cosmetics | null = null;
  private compactQuery: MediaQueryList | null = null;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.style.display = "none"; // hidden until there is something to show
    this.compactQuery = compactViewportQuery();
    this.compactQuery?.addEventListener("change", this.syncVisibility);
    // Ownership changes on login, logout and purchase: pick again.
    document.addEventListener("userMeResponse", this.onUserMe);
    void this.load();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.compactQuery?.removeEventListener("change", this.syncVisibility);
    this.compactQuery = null;
    document.removeEventListener("userMeResponse", this.onUserMe);
  }

  private onUserMe = (event: Event) => {
    this.pick((event as CustomEvent<UserMeResponse | false>).detail);
  };

  private async load() {
    // Already fetched (and cached) for the news box's sale banner.
    this.cosmetics = await fetchCosmetics();
    if (!this.isConnected) return;
    this.pick(lastUserMeResponse()?.response ?? false);
  }

  private pick(me: UserMeResponse | false) {
    if (this.cosmetics === null) return;
    this.items = pickSpotlightItems(resolveCosmetics(this.cosmetics, me, null));
    this.syncVisibility();
  }

  private syncVisibility = () => {
    const shown =
      this.items.length > 0 && !(this.compactQuery?.matches ?? false);
    this.style.display = shown ? "" : "none";
    // Lets play-page give the strip its 2-column grid while this is shown.
    this.classList.toggle("shop-spotlight-live", shown);
  };

  render() {
    if (this.items.length === 0) return nothing;
    return html`
      <div
        class="flex h-full flex-1 flex-col justify-center rounded-xl bg-surface px-3 py-2"
      >
        <div class="mb-2 flex items-center gap-2">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            class="h-3.5 w-3.5 text-amber-400"
            aria-hidden="true"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0"
            />
          </svg>
          <span
            class="text-xs font-bold uppercase tracking-wider text-white/70"
          >
            ${translateText("shop_spotlight.title")}
          </span>
          <a
            href="#modal=store&tab=cosmetics"
            class="ml-auto text-[11px] text-white/40 transition-colors hover:text-blue-300"
            >${translateText("shop_spotlight.browse")}</a
          >
        </div>
        <div class="grid grid-cols-3 gap-2">
          ${this.items.map((r) => this.renderItem(r))}
        </div>
      </div>
    `;
  }

  private renderItem(r: ResolvedCosmetic) {
    const name = cosmeticDisplayName(r);
    const priced = r.cosmetic as PricedCosmetic;
    const hard = currentPrice(priced, "hard");
    const soft = currentPrice(priced, "soft");
    const sale = activeSale(r.cosmetic);
    const badge = sale
      ? translateText("store.sale_percent_off", { percent: sale.percentOff })
      : isNew(r.cosmetic)
        ? translateText("store.new_badge")
        : null;
    return html`
      <a
        href="${storeItemHash(r)}"
        title="${name}"
        aria-label="${translateText("shop_spotlight.view", { name })}"
        class="group flex min-w-0 flex-col items-center gap-1 text-center"
      >
        <div
          class="relative h-12 w-12 overflow-hidden rounded-lg bg-white/5 ring-1 ring-white/15 transition-transform group-hover:scale-105"
        >
          <cosmetic-preview .resolved=${r}></cosmetic-preview>
          ${
            badge
              ? html`<span
                  class="absolute left-0 top-0 rounded-br-md px-1 text-[9px] font-bold leading-tight ${
                    sale ? "bg-red-500 text-white" : "bg-emerald-500 text-white"
                  }"
                  >${badge}</span
                >`
              : nothing
          }
        </div>
        <div
          class="w-full truncate text-[11px] font-medium text-white transition-colors group-hover:text-blue-300"
        >
          ${name}
        </div>
        <div
          class="flex items-center justify-center gap-1.5 text-[10px] text-white/60"
        >
          ${
            hard !== undefined
              ? html`<span class="flex items-center gap-0.5"
                  ><plutonium-icon .size=${10}></plutonium-icon
                  >${hard.toLocaleString()}</span
                >`
              : nothing
          }
          ${
            soft !== undefined
              ? html`<span class="flex items-center gap-0.5"
                  ><cap-icon .size=${10}></cap-icon
                  >${soft.toLocaleString()}</span
                >`
              : nothing
          }
        </div>
      </a>
    `;
  }
}
