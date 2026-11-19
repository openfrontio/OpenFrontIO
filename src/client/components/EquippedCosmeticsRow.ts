import { UserMeResponse } from "@openfront/shared/ApiSchemas";
import { assetUrl } from "@openfront/shared/AssetUrls";
import {
  Cosmetics,
  Effect,
  isNukeExplosionEffect,
  ownsPlayerCard,
} from "@openfront/shared/CosmeticSchemas";
import { PlayerCosmetics } from "@openfront/shared/WireSchemas";
import { html, LitElement, nothing, TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { getUserMe } from "../Api";
import {
  fetchCosmetics,
  resolveCosmetics,
  translateCosmetic,
} from "../Cosmetics";
import {
  EquippedCosmetic,
  equippedCosmetics,
  storeRouteFor,
} from "../EquippedCosmetics";
import { translateText } from "../Utils";
import {
  type CardItem,
  type CardItemType,
  cardItemName,
} from "./card/CardItems";
import { formatTracker, type PlayerCardView } from "./card/PlayerCardModel";
import "./EffectPreview";
import { renderPatternPreview } from "./PatternPreview";

const rarityRing: Record<string, string> = {
  common: "ring-white/15",
  uncommon: "ring-green-400/50",
  rare: "ring-blue-400/50",
  epic: "ring-purple-300/50",
  legendary: "ring-orange-400/60",
};

// One paid item of a player's card, as a tile in the row.
interface CardTile {
  type: CardItemType;
  item: CardItem;
  // What the tile shows: the background art, a tracker's value, or (the card
  // itself) a small card shape.
  imageUrl: string | null;
  value: number | null;
  // Sold for Plutonium or caps and not owned by the viewer.
  buyable: boolean;
}

/**
 * The cosmetics a player has equipped, as a row of small tiles under their name.
 * Tiles the viewer doesn't own link to that item in the store, opened in a new
 * tab so the running game is left alone. With the player's `card` set (the
 * panel, for a card owner), the card's paid items join the row: the card
 * itself, its background and its trackers. Titles and taunts are held back.
 */
@customElement("equipped-cosmetics-row")
export class EquippedCosmeticsRow extends LitElement {
  @property({ attribute: false })
  cosmetics: PlayerCosmetics = {};
  // The player's card as this viewer may see it, or null.
  @property({ attribute: false })
  card: PlayerCardView | null = null;

  @state() private catalog: Cosmetics | null = null;
  @state() private userMe: UserMeResponse | false = false;

  createRenderRoot() {
    return this;
  }

  protected updated(): void {
    // Light DOM, so the host stays a flex item even when nothing renders and
    // would add a gap under the identity row for a player with no cosmetics.
    this.toggleAttribute("hidden", this.childElementCount === 0);
  }

  connectedCallback() {
    super.connectedCallback();
    void this.load();
  }

  private async load() {
    const [catalog, userMe] = await Promise.all([
      fetchCosmetics(),
      getUserMe(),
    ]);
    this.catalog = catalog;
    this.userMe = userMe;
  }

  private openStore(equipped: EquippedCosmetic) {
    const route = storeRouteFor(equipped);
    if (route === null) return;
    window.open(
      new URL(route, `${window.location.origin}/`).toString(),
      "_blank",
      "noopener",
    );
  }

  private displayName(equipped: EquippedCosmetic): string {
    if (equipped.type === "crown")
      return translateCosmetic("crowns", equipped.name);
    if (equipped.type === "effect")
      return translateCosmetic("effects", equipped.name);
    return translateCosmetic("territory_patterns.pattern", equipped.name);
  }

  private renderPreview(equipped: EquippedCosmetic): TemplateResult {
    if (equipped.pattern !== null) {
      return renderPatternPreview(equipped.pattern, 48, 48);
    }
    if (equipped.imageUrl !== null) {
      return html`<img
        src=${equipped.imageUrl}
        alt=""
        class="h-full w-full object-contain pointer-events-none"
        draggable="false"
        loading="lazy"
      />`;
    }
    const effect = equipped.resolved?.cosmetic as Effect | undefined;
    if (effect === undefined) {
      return html`<span class="text-xs font-bold text-white/40">?</span>`;
    }
    if (isNukeExplosionEffect(effect)) {
      return effect.attributes.type === "sparkles"
        ? html`<sparkles-swatch
            class="block h-full w-full"
            .explosion=${effect.attributes}
          ></sparkles-swatch>`
        : html`<shockwave-swatch
            class="block h-full w-full"
            .explosion=${effect.attributes}
          ></shockwave-swatch>`;
    }
    return html`<trail-swatch
      class="block h-full w-full"
      .trail=${effect.attributes}
    ></trail-swatch>`;
  }

  private renderTile(equipped: EquippedCosmetic): TemplateResult {
    const name = this.displayName(equipped);
    const buyable = storeRouteFor(equipped) !== null;
    const rarity = equipped.resolved?.cosmetic?.rarity ?? "";
    const ring = rarityRing[rarity] ?? "ring-white/15";
    const label = buyable
      ? translateText("player_panel.cosmetic_get_label", { name })
      : name;

    return html`
      <button
        type="button"
        class=${`relative h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-white/5 p-1 ring-1 ${ring}
          ${buyable ? "cursor-pointer transition hover:bg-white/10 active:scale-95" : "cursor-default"}`}
        title=${label}
        aria-label=${label}
        ?disabled=${!buyable}
        @click=${(e: Event) => {
          e.stopPropagation();
          this.openStore(equipped);
        }}
      >
        ${this.renderPreview(equipped)}
        ${
          buyable
            ? html`<span
                class="absolute bottom-0 right-0 rounded-tl bg-malibu-blue px-1 text-[10px] font-black leading-tight text-white"
                aria-hidden="true"
                >+</span
              >`
            : nothing
        }
      </button>
    `;
  }

  private cardTiles(): CardTile[] {
    const view = this.card;
    const catalog = this.catalog;
    if (view === null || catalog === null) return [];
    const flares =
      this.userMe === false ? [] : (this.userMe.player.flares ?? []);
    const tiles: CardTile[] = [];
    const add = (
      type: CardItemType,
      item: CardItem | undefined,
      owned: boolean,
      imageUrl: string | null,
      value: number | null,
    ) => {
      if (item === undefined) return;
      const earned = "unlockSource" in item && item.unlockSource != null;
      const sold = (item.priceHard ?? 0) > 0 || (item.priceSoft ?? 0) > 0;
      tiles.push({
        type,
        item,
        imageUrl,
        value,
        buyable: !owned && !earned && sold,
      });
    };
    add(
      "playerCard",
      Object.values(catalog.playerCards ?? {})[0] as CardItem | undefined,
      ownsPlayerCard(flares),
      null,
      null,
    );
    if (view.background !== null) {
      const bg = catalog.cardBackgrounds?.[view.background.name];
      add(
        "cardBackground",
        bg,
        bg !== undefined && flares.includes(`cardBackground:${bg.name}`),
        bg?.url ?? null,
        null,
      );
    }
    for (const t of view.trackers) {
      const tracker = catalog.cardTrackers?.[t.stat];
      add(
        "cardTracker",
        tracker,
        tracker !== undefined && flares.includes(`cardTracker:${tracker.name}`),
        null,
        t.value,
      );
    }
    return tiles;
  }

  private openCardStore(tile: CardTile) {
    if (!tile.buyable) return;
    const key = encodeURIComponent(`${tile.type}:${tile.item.name}`);
    window.open(
      new URL(
        `#modal=store&tab=cosmetics&item=${key}`,
        `${window.location.origin}/`,
      ).toString(),
      "_blank",
      "noopener",
    );
  }

  private renderCardPreview(tile: CardTile): TemplateResult {
    if (tile.imageUrl !== null) {
      return html`<img
        src=${assetUrl(tile.imageUrl)}
        alt=""
        class="h-full w-full rounded object-cover object-center pointer-events-none"
        draggable="false"
        loading="lazy"
      />`;
    }
    if (tile.value !== null) {
      return html`<span
        class="flex h-full w-full items-center justify-center text-[11px] font-black tabular-nums text-white"
        >${formatTracker(tile.value, true)}</span
      >`;
    }
    return html`<span
      class="flex h-full w-full items-center justify-center"
      aria-hidden="true"
      ><span
        class="block h-3.5 w-full rounded-sm border border-white/40 bg-[#132644]"
      ></span
    ></span>`;
  }

  private renderCardTile(tile: CardTile): TemplateResult {
    const name = cardItemName(tile.type, tile.item);
    const ring = rarityRing[String(tile.item.rarity)] ?? "ring-white/15";
    const label = tile.buyable
      ? translateText("player_panel.cosmetic_get_label", { name })
      : name;
    return html`
      <button
        type="button"
        data-card-item=${`${tile.type}:${tile.item.name}`}
        class=${`relative h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-white/5 p-1 ring-1 ${ring}
          ${tile.buyable ? "cursor-pointer transition hover:bg-white/10 active:scale-95" : "cursor-default"}`}
        title=${label}
        aria-label=${label}
        ?disabled=${!tile.buyable}
        @click=${(e: Event) => {
          e.stopPropagation();
          this.openCardStore(tile);
        }}
      >
        ${this.renderCardPreview(tile)}
        ${
          tile.buyable
            ? html`<span
                class="absolute bottom-0 right-0 rounded-tl bg-malibu-blue px-1 text-[10px] font-black leading-tight text-white"
                aria-hidden="true"
                >+</span
              >`
            : nothing
        }
      </button>
    `;
  }

  render() {
    const equipped = equippedCosmetics(
      this.cosmetics,
      resolveCosmetics(this.catalog, this.userMe, null),
    );
    const cardTiles = this.cardTiles();
    if (equipped.length === 0 && cardTiles.length === 0) return nothing;

    return html`
      <div class="flex items-center gap-2">
        <span
          class="text-xs font-semibold uppercase tracking-wider text-zinc-400"
        >
          ${translateText("player_panel.cosmetics")}
        </span>
        <div class="flex flex-wrap items-center gap-1.5">
          ${equipped.map((w) => this.renderTile(w))}
          ${cardTiles.map((t) => this.renderCardTile(t))}
        </div>
      </div>
    `;
  }
}
