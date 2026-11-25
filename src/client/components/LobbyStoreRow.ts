import type { StorePlacement } from "@openfront/shared/ApiSchemas";
import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { getUserMe } from "../Api";
import {
  fetchCosmetics,
  purchaseCosmetic,
  type ResolvedCosmetic,
  resolveCosmetics,
} from "../Cosmetics";
import { COSMETICS_CHANGED } from "../Experiments";
import { featuredSections } from "../FeaturedPicks";
import { type PricedItem, shownPrice } from "../ShownPrice";
import { StoreTracker } from "../StoreTracking";
import { translateText } from "../Utils";
import { cosmeticSelectionLabel } from "./CosmeticPresentation";
import "./CosmeticCard";
import "./PurchaseButton";

// The join lobby's store row: the treatment arm of the lobby_store ui test
// (infra docs/ui-experiments.md). The store's Featured picks (the flash deal,
// then new, then on sale), bought in place, every event and purchase placed
// as join_lobby.

const PLACEMENT: StorePlacement = { kind: "join_lobby" };
const ROW_LENGTH = 3;
// What purchaseCosmetic buys in place. Bundles and currency packs check out
// through their own flows, which belong in the store.
const ROW_TYPES = new Set<ResolvedCosmetic["type"]>([
  "pattern",
  "skin",
  "flag",
  "crown",
  "effect",
]);

/** The row's items: the Featured picks in order, at most ROW_LENGTH. */
export function lobbyStorePicks(
  items: readonly ResolvedCosmetic[],
): ResolvedCosmetic[] {
  const sellable = items.filter(
    (r) => r.relationship === "purchasable" && ROW_TYPES.has(r.type),
  );
  const { deal, new: fresh, sale } = featuredSections(sellable, ROW_LENGTH);
  return [...(deal ? [deal] : []), ...fresh, ...sale]
    .slice(0, ROW_LENGTH)
    .map((group) => group[0]);
}

@customElement("lobby-store-row")
export class LobbyStoreRow extends LitElement {
  @state() private picks: ResolvedCosmetic[] = [];

  private tracker: StoreTracker | null = null;
  private loadSeq = 0;

  createRenderRoot() {
    return this;
  }

  connectedCallback(): void {
    super.connectedCallback();
    this.tracker = new StoreTracker();
    document.addEventListener(COSMETICS_CHANGED, this.onChanged);
    document.addEventListener("userMeResponse", this.onChanged);
    void this.load();
  }

  disconnectedCallback(): void {
    document.removeEventListener(COSMETICS_CHANGED, this.onChanged);
    document.removeEventListener("userMeResponse", this.onChanged);
    this.tracker?.flush();
    this.tracker?.dispose();
    this.tracker = null;
    super.disconnectedCallback();
  }

  // A refetched catalog (new prices) or a new profile (a purchase owns the
  // item now) picks again.
  private onChanged = (): void => {
    void this.load();
  };

  private async load(): Promise<void> {
    const seq = ++this.loadSeq;
    try {
      const [cosmetics, me] = await Promise.all([
        fetchCosmetics(),
        getUserMe(),
      ]);
      if (seq !== this.loadSeq) return;
      this.picks = lobbyStorePicks(resolveCosmetics(cosmetics, me, null));
    } catch {
      // The lobby never breaks for the store: no row.
      if (seq === this.loadSeq) this.picks = [];
    }
  }

  protected updated(): void {
    const tracker = this.tracker;
    if (tracker === null || typeof IntersectionObserver === "undefined") return;
    tracker.releaseDetached();
    for (const el of this.querySelectorAll<HTMLElement>(
      "[data-lobby-store-item][data-cosmetic-key]",
    )) {
      tracker.observe(el, el.dataset.cosmeticKey!, PLACEMENT);
    }
  }

  private trackClick(resolved: ResolvedCosmetic): void {
    try {
      this.tracker?.click(resolved.key, PLACEMENT);
    } catch {
      // Analytics must never break the click.
    }
  }

  private renderAction(resolved: ResolvedCosmetic) {
    const priced = resolved.cosmetic as
      | (PricedItem & { rarity?: string })
      | null;
    const hard = priced ? shownPrice(priced, "hard") : null;
    const soft = priced ? shownPrice(priced, "soft") : null;
    // With the price this button shows: the server refuses to charge more.
    return html`<purchase-button
      @click=${() => this.trackClick(resolved)}
      .priceHard=${hard?.price ?? null}
      .priceSoft=${soft?.price ?? null}
      .listPriceHard=${hard?.listPrice ?? null}
      .listPriceSoft=${soft?.listPrice ?? null}
      .promotion=${priced?.promotion ?? null}
      .rarity=${priced?.rarity ?? "common"}
      .itemName=${cosmeticSelectionLabel(resolved)}
      .onPurchaseHard=${
        hard !== null
          ? () => purchaseCosmetic(resolved, "hard", PLACEMENT, hard.price)
          : undefined
      }
      .onPurchaseSoft=${
        soft !== null
          ? () => purchaseCosmetic(resolved, "soft", PLACEMENT, soft.price)
          : undefined
      }
    ></purchase-button>`;
  }

  render() {
    if (this.picks.length === 0) return nothing;
    return html`
      <section data-lobby-store class="mt-6">
        <h3
          class="mb-3 text-[10px] font-bold uppercase tracking-widest text-white/40"
        >
          ${translateText("public_lobby.store_row_title")}
        </h3>
        <div class="grid grid-cols-3 gap-3">
          ${this.picks.map(
            (resolved) => html`
              <cosmetic-card
                data-lobby-store-item
                data-cosmetic-key=${resolved.key}
                class="block h-full min-w-0"
                showNewBadge
                .showSwatches=${false}
                .interactive=${false}
                .resolved=${resolved}
                .actionContent=${this.renderAction(resolved)}
              ></cosmetic-card>
            `,
          )}
        </div>
      </section>
    `;
  }
}
