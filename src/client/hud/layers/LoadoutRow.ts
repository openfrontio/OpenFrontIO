import type { StorePlacement } from "@openfront/shared/ApiSchemas";
import { html, LitElement, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { currentPublicId } from "../../Auth";
import "../../components/CosmeticCard";
import "../../components/PurchaseButton";
import { cardItemName } from "../../components/card/CardItems";
import {
  checkInPlacePurchase,
  type PurchaseResult,
  purchaseCosmeticInPlace,
  type ResolvedCosmetic,
} from "../../Cosmetics";
import { showInGameAlert, showInGameConfirm } from "../../InGameModal";
import { type PricedItem, shownPrice } from "../../ShownPrice";
import { translateText } from "../../Utils";
import { HUD_LABEL } from "../HudModal";

// "Get the look" on the end screen, in the promo box's place: for each player
// (the one who eliminated you, then looks saved from the player panel), up to
// three things on their card. Paid items buy in Plutonium or caps like the
// store; earned ones show how to unlock them and can't be bought. A viewer
// without the card is offered the card itself, under the first name.

import type { LoadoutItem } from "../../components/card/LoadoutItems";
import type { LookRow } from "../../components/card/SavedLooks";

export {
  type LoadoutItem,
  loadoutItems,
} from "../../components/card/LoadoutItems";

const PLACEMENT: StorePlacement = { kind: "card_loadout" };

interface ShownPrices {
  priceHard: number | null;
  priceSoft: number | null;
  listPriceHard: number | null;
  listPriceSoft: number | null;
  // The sale behind them: <purchase-button> switches to the list price the
  // moment it ends, without a re-render from here.
  promotion: PricedItem["promotion"] | null;
}

/**
 * An item's prices as the Store shows them now (shownPrice): while its own
 * sale runs, the sale price with the list price to strike through; once the
 * sale has ended, the list price alone. Read at render, as a look saved
 * mid-game is shown minutes later.
 */
export function shownPrices(entry: LoadoutItem): ShownPrices {
  const item = entry.item as PricedItem;
  const shown = (currency: "hard" | "soft") => {
    const s = shownPrice(item, currency);
    return s !== null && s.price > 0 ? s : null;
  };
  const hard = shown("hard");
  const soft = shown("soft");
  return {
    priceHard: hard?.price ?? null,
    priceSoft: soft?.price ?? null,
    listPriceHard: hard?.listPrice ?? null,
    listPriceSoft: soft?.listPrice ?? null,
    promotion: item.promotion ?? null,
  };
}

export interface PromoInput {
  isWin: boolean;
  gamesPlayed: number;
  inIframe: boolean;
  canWishlist: boolean;
  rand: number;
  // There is a look to get (the killer's or a saved one).
  hasLooks: boolean;
}

export type PromoChoice =
  | "tutorial"
  | "steam"
  | "discord"
  | "loadout"
  | "skins";

// The end screen's promo box, as before, except that a look to get (the
// "Get the look" block) takes it from every other promo. An iframe keeps
// today's choice: no shopping there.
export function promoChoice(p: PromoInput): PromoChoice {
  if (p.inIframe) return p.canWishlist ? "steam" : "discord";
  if (p.hasLooks) return "loadout";
  if (!p.isWin && p.gamesPlayed < 3) return "tutorial";
  if (p.rand < 0.25 && p.canWishlist) return "steam";
  if (p.rand < 0.5) return "discord";
  return "skins";
}

// The part of StoreTracker the row uses (a test passes its own).
export interface LoadoutTracker {
  observe(el: Element, key: string, placement: StorePlacement): void;
  click(key: string, placement: StorePlacement): void;
  releaseDetached(): void;
  dispose(): void;
}

/**
 * The end screen's "Get the look" block, in the promo slot: a name switcher
 * (chips: the killer first, then looks saved this game, newest first) over
 * one row of the selected player's items. Never taller than one player's
 * row: the chips sit in the title's place. On a phone it folds to one line as
 * before; opened, the items scroll sideways instead of stacking.
 */
@customElement("loadout-row")
export class LoadoutRow extends LitElement {
  @property({ attribute: false }) looks: readonly LookRow[] = [];
  @property({ attribute: false }) tracker: LoadoutTracker | null = null;
  // Item keys the viewer owns now: bought here, they read Owned ✓.
  @property({ attribute: false }) owned: ReadonlySet<string> = new Set();
  // Signed out: "Sign in to buy" in place of the buy buttons.
  @property({ type: Boolean }) signedIn = true;
  // The player whose chip is shown (their clientID); null: the first.
  @state() private selected: string | null = null;
  // On a phone the row starts collapsed to one line; tapping opens it.
  @state() private open = false;
  private ownTracker = false;
  // The account each item's tap check confirmed, by item key: the buy from
  // that confirm is sent only as this account (purchaseCosmeticInPlace).
  // `publicId` null: no account was known then, so the buy is refused.
  private confirmedAs = new Map<string, { publicId: string | null }>();

  createRenderRoot() {
    return this;
  }

  async connectedCallback(): Promise<void> {
    super.connectedCallback();
    if (this.tracker === null && typeof IntersectionObserver !== "undefined") {
      const { StoreTracker } = await import("../../StoreTracking");
      // Removed (or given a tracker) while the module loaded: none to make.
      if (!this.isConnected || this.tracker !== null) return;
      this.tracker = new StoreTracker();
      this.ownTracker = true;
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    // A disposed tracker sends nothing: drop it, so reattaching makes a new one.
    if (this.ownTracker) {
      this.tracker?.dispose();
      this.tracker = null;
      this.ownTracker = false;
    }
  }

  protected updated(): void {
    const tracker = this.tracker;
    if (tracker === null) return;
    for (const el of this.querySelectorAll<HTMLElement>(
      "[data-loadout-item]",
    )) {
      tracker.observe(el, el.dataset.loadoutItem!, PLACEMENT);
    }
    tracker.releaseDetached();
  }

  private resolved(entry: LoadoutItem): ResolvedCosmetic {
    return {
      type: entry.type,
      cosmetic: entry.item,
      colorPalette: null,
      relationship: "purchasable",
      key: `${entry.type}:${entry.item.name}`,
    };
  }

  // Buys in place (purchaseCosmeticInPlace): a reload would end the game.
  // Owned (or already owned): tells the end screen, which marks it Owned ✓
  // here and drops it elsewhere. A shortfall goes back to the button's box.
  private async buy(
    entry: LoadoutItem,
    method: "hard" | "soft",
    shownAmount?: number,
  ): Promise<PurchaseResult> {
    const key = `${entry.type}:${entry.item.name}`;
    this.tracker?.click(key, PLACEMENT);
    // Before the fresh profile's broadcast (purchaseCosmeticInPlace), so the
    // end screen never renders it owned but not bought here.
    let told = false;
    const tellOwned = () => {
      if (told) return;
      told = true;
      this.dispatchEvent(
        new CustomEvent("look-owned", { detail: { key }, bubbles: true }),
      );
    };
    // No tap check (never the case here): the account signed in now.
    const confirmed = this.confirmedAs.get(key);
    const signedInAs =
      confirmed === undefined ? currentPublicId() : confirmed.publicId;
    this.confirmedAs.delete(key);
    const outcome = await purchaseCosmeticInPlace(
      this.resolved(entry),
      method,
      PLACEMENT,
      tellOwned,
      signedInAs,
      // What the confirm box showed: the server refuses to charge more.
      shownAmount,
    );
    switch (outcome.kind) {
      case "owned":
        tellOwned();
        if (outcome.notice) await showInGameAlert(outcome.notice);
        return;
      case "signed_out":
        // Signed out since the screen opened: the sign-in prompt, never a
        // tap that does nothing.
        await this.signIn();
        return;
      case "unreachable":
        await showInGameAlert(translateText("win_modal.server_unreachable"));
        return;
      case "unconfirmed":
        await showInGameAlert(translateText("win_modal.purchase_unconfirmed"));
        return;
      case "insufficient":
        return outcome.info;
      case "failed":
        await showInGameAlert(
          translateText("win_modal.purchase_failed_not_charged"),
        );
        return;
      default:
        return;
    }
  }

  // The tap check: a profile that can't be read is never a dead tap.
  private async check(entry: LoadoutItem, method: "hard" | "soft") {
    const result = await checkInPlacePurchase(this.resolved(entry), method);
    // The confirm opens now: remember who it was opened as.
    const key = `${entry.type}:${entry.item.name}`;
    if (result.ok) this.confirmedAs.set(key, { publicId: currentPublicId() });
    if (!result.ok && result.reason === "signed_out") void this.signIn();
    if (!result.ok && result.reason === "unreachable") {
      void showInGameAlert(translateText("win_modal.server_unreachable"));
    }
    return result;
  }

  // Signing in leaves the game: say so first.
  private async signIn(): Promise<void> {
    const go = await showInGameConfirm(
      translateText("win_modal.sign_in_leaves_game"),
      {
        variant: "warning",
        confirmText: translateText("win_modal.sign_in_to_buy"),
      },
    );
    if (go) window.location.href = "/#modal=account";
  }

  private renderBuy(entry: LoadoutItem, key: string): TemplateResult {
    if (this.owned.has(key)) {
      return html`<span
        data-look-owned
        class="flex min-h-11 items-center justify-center rounded-lg border border-emerald-400/40 bg-emerald-500/15 text-sm font-bold text-emerald-300"
        >${translateText("win_modal.look_owned")}</span
      >`;
    }
    if (!this.signedIn) {
      return html`<button
        type="button"
        data-look-sign-in
        class="min-h-11 rounded-lg border border-blue-500/40 bg-blue-500/20 px-2 text-sm font-bold text-blue-200 transition hover:bg-blue-600 hover:text-white"
        @click=${() => void this.signIn()}
      >
        ${translateText("win_modal.sign_in_to_buy")}
      </button>`;
    }
    const prices = shownPrices(entry);
    return html`<purchase-button
      .priceHard=${prices.priceHard}
      .priceSoft=${prices.priceSoft}
      .listPriceHard=${prices.listPriceHard}
      .listPriceSoft=${prices.listPriceSoft}
      .promotion=${prices.promotion}
      .preflight=${(method: "hard" | "soft") => this.check(entry, method)}
      .busyKey=${key}
      .rarity=${String(entry.item.rarity)}
      .itemName=${cardItemName(entry.type, entry.item)}
      .onPurchaseHard=${(shown?: number) => this.buy(entry, "hard", shown)}
      .onPurchaseSoft=${(shown?: number) => this.buy(entry, "soft", shown)}
    ></purchase-button>`;
  }

  private renderItem(entry: LoadoutItem): TemplateResult {
    const key = `${entry.type}:${entry.item.name}`;
    return html`<div
      data-loadout-item=${key}
      data-cosmetic-shell
      data-cosmetic-rarity=${String(entry.item.rarity)}
      class="flex w-40 flex-col gap-1.5 rounded-xl border-2 p-2 text-left text-white"
    >
      <span class=${HUD_LABEL}
        >${translateText(`win_modal.loadout_type_${entry.type}`)}</span
      >
      <span class="truncate text-sm font-bold"
        >${cardItemName(entry.type, entry.item)}</span
      >
      ${
        entry.state === "buy"
          ? this.renderBuy(entry, key)
          : html`<span
              class="rounded-md border border-dashed border-white/30 py-1 text-center text-xs font-bold text-white/70"
              >🔒 ${entry.unlockLabel}</span
            >`
      }
    </div>`;
  }

  render() {
    if (this.looks.length === 0) return nothing;
    // By player, not position: a look saved while the screen is open goes in
    // ahead of older ones and would move an index onto someone else. Gone
    // (or none picked yet): the first.
    const found = this.looks.findIndex((l) => l.clientID === this.selected);
    const index = found === -1 ? 0 : found;
    const look = this.looks[index];
    const chips = this.looks.map(
      (l, i) =>
        html`<button
          type="button"
          data-look-chip=${l.clientID}
          aria-pressed=${i === index ? "true" : "false"}
          class="group flex min-h-11 shrink-0 items-center"
          @click=${() => (this.selected = l.clientID)}
        >
          <span
            class="whitespace-nowrap rounded-full px-3 py-1 text-sm font-bold transition ${
              i === index
                ? "bg-malibu-blue text-white"
                : "bg-white/10 text-white/80 group-hover:bg-white/20"
            }"
            >${l.name}</span
          >
        </button>`,
    );
    return html`<div
      data-loadout-row
      data-look-block
      class="mb-6 rounded-sm bg-black/30 p-2.5 text-center"
    >
      <button
        type="button"
        data-look-fold
        class="flex min-h-11 w-full items-center justify-between text-sm font-bold text-white sm:hidden"
        @click=${() => (this.open = !this.open)}
      >
        <span>${translateText("win_modal.get_the_look")}</span>
        <span class="text-white/60"
          >${translateText("win_modal.get_look_players", {
            n: this.looks.length,
          })}
          ›</span
        >
      </button>
      <div
        data-loadout-title
        class="${this.open ? "mt-3 flex" : "hidden"} mb-3 items-center gap-2 overflow-x-auto sm:flex sm:justify-center"
      >
        <span class="hidden shrink-0 text-xl font-semibold text-white sm:inline"
          >${translateText("win_modal.get_the_look")}</span
        >
        ${chips}
      </div>
      <div
        data-look-items
        class="${this.open ? "flex" : "hidden"} flex-nowrap justify-start gap-3 overflow-x-auto sm:flex sm:flex-wrap sm:justify-center"
      >
        ${look.items.map((i) => this.renderItem(i))}
      </div>
    </div>`;
  }
}
