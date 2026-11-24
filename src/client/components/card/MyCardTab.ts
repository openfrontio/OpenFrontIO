import type {
  StorePlacement,
  UserMeResponse,
} from "@openfront/shared/ApiSchemas";
import {
  type CardTracker,
  type Cosmetics,
  ownsPlayerCard,
} from "@openfront/shared/CosmeticSchemas";
import {
  MAX_CARD_TRACKERS,
  type TrackerStat,
} from "@openfront/shared/PlayerCardSchemas";
import { html, LitElement, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { CardLoadoutBody } from "../../CardLoadoutApi";
import {
  type CardSaveOutcome,
  type CardSavedDetail,
  cardSaveInFlight,
  cardSaveRunning,
  requestCardSave,
} from "../../CardSaveQueue";
import {
  fetchCosmetics,
  getPlayerCosmetics,
  purchaseCosmetic,
  type ResolvedCosmetic,
} from "../../Cosmetics";
import { translateText } from "../../Utils";
import "../CosmeticCard";
import "../PurchaseButton";
import {
  type CardItem,
  type CardItemType,
  cardItemName,
  isOfferedCardItem,
  cardPrices,
  cardRarityLabel,
} from "./CardItems";
import "./PlayerCard";
import { buildPlayerCardView } from "./PlayerCardModel";

// The Account page's My Card tab: a live preview of the player's card, then
// one grid per slot (background, flag, trackers). Titles and taunts are held
// back: a saved one is sent back unchanged with every save. An owned item
// equips with a click and saves at once (rolled back if the save fails); a
// paid one shows its price in Plutonium and/or caps and buys through the
// store's own purchase flow; an earned one shows how to unlock it. Without
// the card everything can be browsed and bought, nothing equipped, and a bar
// offers the card itself.

type Slot = "background" | "flag" | "trackers";
const SLOTS: Slot[] = ["background", "flag", "trackers"];

type ItemState = "equipped" | "owned" | "buy" | "locked";

const SECTION: Record<
  Exclude<Slot, "flag">,
  { key: keyof Cosmetics; type: CardItemType }
> = {
  background: { key: "cardBackgrounds", type: "cardBackground" },
  trackers: { key: "cardTrackers", type: "cardTracker" },
};

const EMPTY: CardLoadoutBody = {
  background: null,
  title: null,
  taunt: null,
  trackers: [],
};

@customElement("my-card-tab")
export class MyCardTab extends LitElement {
  @property({ attribute: false }) userMe: UserMeResponse | null = null;
  @property({ attribute: false }) cosmetics: Cosmetics | null = null;
  /** Sent with each purchase: the Inventory's Player card tab sets it; the
   * Account modal sends none. */
  @property({ attribute: false }) placement: StorePlacement | undefined =
    undefined;

  @state() private activeSlot: Slot = "background";
  // What is equipped now (optimistically), and what the server last
  // confirmed. Saves run one at a time in CardSaveQueue, shared with any
  // other tab: a click made meanwhile is sent on top of the save in flight.
  @state() private loadout: CardLoadoutBody = EMPTY;
  @state() private saved: CardLoadoutBody = EMPTY;
  // The save run this tab is waiting on.
  private following: Promise<CardSaveOutcome> | null = null;
  // The account `initial` was seeded for.
  private initialFor: string | null = null;
  // The loadout the tab opened with: what Reset goes back to. Opened mid-save,
  // it's the save in flight (`initialRun`) until that run ends.
  @state() private initial: CardLoadoutBody = EMPTY;
  private initialRun: Promise<CardSaveOutcome> | null = null;
  @state() private saveError = false;
  @state() private flag: string | undefined = undefined;
  // Tracker values the server last sent, for the preview.
  private values = new Map<TrackerStat, number>();
  private seededFrom: UserMeResponse | null = null;

  createRenderRoot() {
    return this;
  }

  connectedCallback(): void {
    super.connectedCallback();
    void getPlayerCosmetics()
      .then((c) => (this.flag = c.flag))
      .catch(() => {});
    // The catalogue, unless the host passed one in.
    if (this.cosmetics === null) {
      void fetchCosmetics()
        .then((c) => {
          this.cosmetics ??= c;
        })
        .catch(() => {});
    }
  }

  protected willUpdate(): void {
    // Take the saved loadout from each new /users/@me.
    if (this.userMe === this.seededFrom) return;
    this.seededFrom = this.userMe;
    const card = this.userMe?.player.card ?? null;
    this.values = new Map(
      (card?.trackers ?? []).map((t) => [t.stat, t.value] as const),
    );
    this.saved = {
      background: card?.background ?? null,
      title: card?.title ?? null,
      taunt: card?.taunt ?? null,
      trackers: (card?.trackers ?? []).map((t) => t.stat),
    };
    // Mid-save (from this tab, or one closed before it answered), show the
    // newest loadout asked for: the server will hold it, and the next click
    // builds on it.
    const publicId = this.userMe?.player.publicId ?? null;
    const inFlight = publicId === null ? null : cardSaveInFlight(publicId);
    const run = publicId === null ? null : cardSaveRunning(publicId);
    this.loadout = inFlight ?? this.saved;
    // Reset goes back to what the tab opened with (for this account), not to
    // the last save.
    if (publicId !== null && this.initialFor !== publicId) {
      this.initialFor = publicId;
      this.initial = this.loadout;
      this.initialRun = inFlight !== null ? run : null;
    }
    if (inFlight !== null && run !== null) void this.follow(run);
  }

  private get flares(): string[] {
    return this.userMe?.player.flares ?? [];
  }

  private get ownsCard(): boolean {
    return ownsPlayerCard(this.flares);
  }

  private items(slot: Exclude<Slot, "flag">): CardItem[] {
    const section = this.cosmetics?.[SECTION[slot].key] as
      | Record<string, CardItem>
      | undefined;
    return Object.values(section ?? {}).filter((item) =>
      isOfferedCardItem(SECTION[slot].type, item),
    );
  }

  private equippedName(slot: Exclude<Slot, "flag" | "trackers">) {
    return this.loadout[slot];
  }

  private stateOf(slot: Exclude<Slot, "flag">, item: CardItem): ItemState {
    const type = SECTION[slot].type;
    if (this.flares.includes(`${type}:${item.name}`)) {
      if (slot === "trackers") {
        return this.loadout.trackers.includes((item as CardTracker).stat)
          ? "equipped"
          : "owned";
      }
      return this.equippedName(slot) === item.name ? "equipped" : "owned";
    }
    const priced = (item.priceHard ?? 0) > 0 || (item.priceSoft ?? 0) > 0;
    return priced && !("unlockSource" in item && item.unlockSource)
      ? "buy"
      : "locked";
  }

  private save(next: CardLoadoutBody): void {
    this.loadout = next;
    this.saveError = false;
    const publicId = this.userMe?.player.publicId;
    if (publicId === undefined) return;
    void this.follow(requestCardSave(publicId, next));
  }

  // Wait for a save run, then take what the server holds after it.
  private async follow(run: Promise<CardSaveOutcome>): Promise<void> {
    if (this.following === run) return;
    this.following = run;
    const publicId = this.userMe?.player.publicId ?? "";
    const { result, saved } = await run;
    if (this.following === run) this.following = null;
    // Signed out, or into another account, since: the host ignores a save
    // for another account, and this tab now shows that account's card.
    const sameAccount = this.userMe?.player.publicId === publicId;
    if (!result.ok && result.error === "cancelled") {
      // A run dropped at sign-out or an account change. Even back in the
      // same account, a newer run or the next /users/@me owns the card now:
      // what this one stored is neither taken nor handed up.
      // Reset then goes to what the server confirmed, never to the dropped
      // loadout.
      if (this.initialRun === run) {
        this.initialRun = null;
        if (sameAccount) this.initial = this.saved;
      }
      // Nothing newer in flight here: show the last confirmed loadout
      // rather than the dropped clicks.
      if (sameAccount && this.following === null) this.loadout = this.saved;
      return;
    }
    if (saved !== null) {
      // Stored, whether or not the /users/@me refresh after it got through:
      // tell the host, which keeps its copy (and so the next tab it makes)
      // in step.
      if (sameAccount) this.saved = saved;
      this.dispatchEvent(
        new CustomEvent<CardSavedDetail>("card-saved", {
          detail: { publicId, loadout: saved },
          bubbles: true,
          composed: true,
        }),
      );
    }
    if (!sameAccount) return;
    // On success that's the newest loadout asked for; on failure, back to
    // what the server holds (clicks queued behind it go too).
    this.loadout = this.saved;
    if (!result.ok) this.saveError = true;
    // Opened on this run's save: Reset now goes to what the server holds.
    if (this.initialRun === run) {
      this.initialRun = null;
      if (!result.ok) this.initial = this.saved;
    }
  }

  private onItem(slot: Exclude<Slot, "flag">, item: CardItem): void {
    if (!this.ownsCard) return;
    const state = this.stateOf(slot, item);
    if (state !== "owned" && state !== "equipped") return;
    if (slot === "trackers") {
      const stat = (item as CardTracker).stat;
      const trackers = this.loadout.trackers.includes(stat)
        ? this.loadout.trackers.filter((s) => s !== stat)
        : [...this.loadout.trackers, stat];
      this.save({ ...this.loadout, trackers });
      return;
    }
    // Clicking the equipped item takes it off.
    const name = state === "equipped" ? null : item.name;
    this.save({ ...this.loadout, [slot]: name });
  }

  private resolved(type: CardItemType, item: CardItem): ResolvedCosmetic {
    return {
      type,
      cosmetic: item,
      colorPalette: null,
      relationship: "purchasable",
      key: `${type}:${item.name}`,
    };
  }

  private renderPrice(type: CardItemType, item: CardItem): TemplateResult {
    const r = this.resolved(type, item);
    const prices = cardPrices(item);
    return html`<purchase-button
      .priceHard=${prices.hard?.price ?? null}
      .priceSoft=${prices.soft?.price ?? null}
      .listPriceHard=${prices.hard?.listPrice ?? null}
      .listPriceSoft=${prices.soft?.listPrice ?? null}
      .promotion=${prices.promotion ?? null}
      .rarity=${String(item.rarity)}
      .itemName=${cardItemName(type, item)}
      .onPurchaseHard=${() => purchaseCosmetic(r, "hard", this.placement)}
      .onPurchaseSoft=${() => purchaseCosmetic(r, "soft", this.placement)}
    ></purchase-button>`;
  }

  private renderPreviewArt(
    slot: Exclude<Slot, "flag">,
    item: CardItem,
  ): TemplateResult {
    if (slot === "background" && "url" in item && item.url) {
      return html`<player-card
        size="thumb"
        .view=${buildPlayerCardView(
          {
            username: "",
            clanTag: null,
            badge: null,
            card: { background: item.name, trackers: [] },
          },
          this.cosmetics,
        )}
      ></player-card>`;
    }
    return html`<div
      class="grid h-16 w-40 place-items-center rounded-lg bg-black/30 px-2 text-center text-sm font-bold"
    >
      ${cardItemName(SECTION[slot].type, item)}
    </div>`;
  }

  private renderTile(slot: Exclude<Slot, "flag">, item: CardItem) {
    const type = SECTION[slot].type;
    const state = this.stateOf(slot, item);
    const trackersFull =
      slot === "trackers" &&
      state === "owned" &&
      this.loadout.trackers.length >= MAX_CARD_TRACKERS;
    const disabled =
      (!this.ownsCard && (state === "owned" || state === "equipped")) ||
      trackersFull;
    const unlock =
      "unlockSource" in item && item.unlockSource
        ? item.unlockSource.label
        : translateText("my_card.not_available");
    return html`<button
      type="button"
      data-card-item=${`${type}:${item.name}`}
      data-state=${state}
      ?disabled=${disabled}
      data-cosmetic-shell
      data-cosmetic-rarity=${String(item.rarity)}
      class="flex w-44 flex-col items-stretch gap-1.5 rounded-xl border-2 p-2 text-left text-white disabled:opacity-50 ${
        state === "equipped" ? "ring-2 ring-sky-400" : ""
      }"
      @click=${() => this.onItem(slot, item)}
    >
      ${this.renderPreviewArt(slot, item)}
      <span
        data-my-card-rarity
        class="text-[10px] font-bold uppercase tracking-wider text-white/50"
        >${cardRarityLabel(String(item.rarity))}</span
      >
      <span class="truncate text-sm font-bold"
        >${cardItemName(type, item)}</span
      >
      ${
        state === "equipped"
          ? html`<span
              class="rounded-md bg-sky-500/30 py-1 text-center text-xs font-bold"
              >${translateText("my_card.equipped")}</span
            >`
          : state === "owned"
            ? html`<span
                class="rounded-md bg-white/10 py-1 text-center text-xs font-bold"
                >${translateText("my_card.owned")}</span
              >`
            : state === "buy"
              ? this.renderPrice(type, item)
              : html`<span
                  class="rounded-md border border-dashed border-white/30 py-1 text-center text-xs font-bold text-white/70"
                  >🔒 ${unlock}</span
                >`
      }
    </button>`;
  }

  private renderFlagSlot(): TemplateResult {
    return html`<div class="flex flex-col items-start gap-3">
      <p class="text-sm text-white/70">${translateText("my_card.flag_note")}</p>
      <button
        type="button"
        data-my-card-change-flag
        class="rounded-lg bg-sky-600 px-4 py-2 text-sm font-bold text-white hover:bg-sky-500"
        @click=${() =>
          this.dispatchEvent(
            new CustomEvent("change-flag", { bubbles: true, composed: true }),
          )}
      >
        ${translateText("my_card.change_flag")}
      </button>
    </div>`;
  }

  private renderGetCard(): TemplateResult | typeof nothing {
    if (this.ownsCard) return nothing;
    const card = Object.values(this.cosmetics?.playerCards ?? {})[0] as
      | CardItem
      | undefined;
    return html`<div
      data-my-card-get-card
      class="flex flex-col items-center justify-between gap-3 rounded-xl border border-amber-300/40 bg-amber-300/10 p-4 sm:flex-row"
    >
      <span class="text-sm font-bold text-amber-100"
        >${translateText("my_card.get_card")}</span
      >
      ${card === undefined ? nothing : this.renderPrice("playerCard", card)}
    </div>`;
  }

  render() {
    const me = this.userMe;
    if (me === null) return nothing;
    const progress = me.player.progress;
    const view = buildPlayerCardView(
      {
        username: me.player.username ?? me.player.publicId ?? "",
        clanTag: null,
        flag: this.flag,
        badge: progress
          ? {
              level: progress.level,
              prestige: progress.prestige,
              legend: progress.legend,
            }
          : null,
        card: {
          background: this.loadout.background ?? undefined,
          trackers: this.loadout.trackers.map((stat) => ({
            stat,
            value: this.values.get(stat) ?? 0,
          })),
        },
      },
      this.cosmetics,
    );
    const changed =
      JSON.stringify(this.loadout) !== JSON.stringify(this.initial);
    const currency = me.player.currency;
    return html`<div class="flex flex-col gap-4">
      <player-card size="account" .view=${view}></player-card>
      ${this.renderGetCard()}
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex flex-wrap gap-2">
          ${SLOTS.map(
            (s) =>
              html`<button
                type="button"
                data-my-card-slot=${s}
                class="rounded-lg px-3 py-1.5 text-sm font-bold ${
                  this.activeSlot === s
                    ? "bg-sky-600 text-white"
                    : "bg-white/10 text-white/80 hover:bg-white/15"
                }"
                @click=${() => (this.activeSlot = s)}
              >
                ${translateText(`my_card.slot_${s}`)}
              </button>`,
          )}
          <button
            type="button"
            data-my-card-reset
            class="rounded-lg px-3 py-1.5 text-sm font-bold text-white/70 hover:text-white"
            ?hidden=${!changed}
            @click=${() => this.save(this.initial)}
          >
            ${translateText("my_card.reset")}
          </button>
        </div>
        <div
          data-my-card-balance
          class="flex gap-3 text-sm font-bold tabular-nums"
        >
          <span class="text-emerald-300"
            >☢ ${(currency?.hard ?? 0).toLocaleString()}</span
          >
          <span class="text-amber-300"
            >⛁ ${(currency?.soft ?? 0).toLocaleString()}</span
          >
        </div>
      </div>
      ${
        this.saveError
          ? html`<div data-my-card-error class="text-sm text-rose-300">
              ${translateText("my_card.save_failed")}
            </div>`
          : nothing
      }
      ${
        this.activeSlot === "flag"
          ? this.renderFlagSlot()
          : html`<div class="flex flex-wrap gap-3">
              ${this.items(this.activeSlot).map((item) =>
                this.renderTile(this.activeSlot as Exclude<Slot, "flag">, item),
              )}
            </div>`
      }
      <p class="text-xs text-white/50">
        ${this.ownsCard ? nothing : html`${translateText("my_card.needs_card")} · `}
        ${translateText("my_card.earned_note")}
        ${translateText("my_card.staff_note")}
      </p>
    </div>`;
  }
}
