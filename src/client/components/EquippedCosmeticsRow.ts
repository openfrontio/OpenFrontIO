import type { ClientID, GameID } from "@openfront/engine-api/Schemas";
import { UserMeResponse } from "@openfront/shared/ApiSchemas";
import { assetUrl } from "@openfront/shared/AssetUrls";
import {
  Cosmetics,
  Effect,
  isNukeExplosionEffect,
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
import { type LoadoutItem, loadoutItems } from "./card/LoadoutItems";
import type { PlayerCardView } from "./card/PlayerCardModel";
import {
  hasSomethingToBuy,
  isLookSaved,
  saveLook,
  unsaveLook,
} from "./card/SavedLooks";
import "./EffectPreview";
import { renderPatternPreview } from "./PatternPreview";

const rarityRing: Record<string, string> = {
  common: "ring-white/15",
  uncommon: "ring-green-400/50",
  rare: "ring-blue-400/50",
  epic: "ring-purple-300/50",
  legendary: "ring-orange-400/60",
};

/**
 * The cosmetics a player has equipped, as a row of small tiles under their name.
 * Tiles the viewer doesn't own link to that item in the store, opened in a new
 * tab so the running game is left alone. With another player's `card` set
 * (the panel, for a card owner), one "Get the look" tile joins the row: it
 * saves their look for the end screen (SavedLooks) instead of opening the
 * Store, as a purchase reloads the page and would end the game.
 */
@customElement("equipped-cosmetics-row")
export class EquippedCosmeticsRow extends LitElement {
  @property({ attribute: false })
  cosmetics: PlayerCosmetics = {};
  // The player's card as this viewer may see it, or null.
  @property({ attribute: false })
  card: PlayerCardView | null = null;
  // Whose look the tile saves, and in which game. Null on the viewer's own
  // panel: there is no tile there.
  @property({ attribute: false })
  lookGameID: GameID | null = null;
  @property({ attribute: false })
  lookClientID: ClientID | null = null;

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

  // What the look offers the viewer (the end screen's loadout: what they
  // don't own yet), or [] when there is no tile to show: also when nothing in
  // it can be bought (earned items alone).
  private lookItems(): LoadoutItem[] {
    const view = this.card;
    if (
      view === null ||
      this.catalog === null ||
      this.lookGameID === null ||
      this.lookClientID === null
    ) {
      return [];
    }
    const flares =
      this.userMe === false ? [] : (this.userMe.player.flares ?? []);
    const items = loadoutItems(view, this.catalog, flares);
    return hasSomethingToBuy(items) ? items : [];
  }

  private toggleLook(items: LoadoutItem[]) {
    const gameID = this.lookGameID;
    const clientID = this.lookClientID;
    if (gameID === null || clientID === null || this.card === null) return;
    if (isLookSaved(gameID, clientID)) {
      unsaveLook(gameID, clientID);
    } else {
      saveLook(gameID, { clientID, name: this.card.username, items });
    }
    this.requestUpdate();
  }

  private renderLookTile(items: LoadoutItem[]): TemplateResult {
    const view = this.card!;
    const saved = isLookSaved(this.lookGameID!, this.lookClientID!);
    const ring = rarityRing[view.background?.rarity ?? ""] ?? "ring-white/15";
    const hint = translateText(
      saved ? "player_panel.look_saved_hint" : "player_panel.get_the_look_hint",
      { name: view.username },
    );
    return html`
      <button
        type="button"
        data-get-look
        class=${`flex h-11 shrink-0 items-center gap-2 overflow-hidden rounded-lg bg-white/5 p-1 pr-2.5 ring-1 ${ring} cursor-pointer transition hover:bg-white/10 active:scale-95
          ${saved ? "bg-malibu-blue/25 ring-sky-400/70" : ""}`}
        title=${hint}
        aria-label=${hint}
        aria-pressed=${saved ? "true" : "false"}
        @click=${(e: Event) => {
          e.stopPropagation();
          this.toggleLook(items);
        }}
      >
        ${
          view.background === null
            ? html`<span
                class="flex h-9 w-9 shrink-0 items-center justify-center"
                aria-hidden="true"
                ><span
                  class="block h-3.5 w-full rounded-sm border border-white/40 bg-[#132644]"
                ></span
              ></span>`
            : html`<img
                src=${assetUrl(view.background.url)}
                alt=""
                class="h-9 w-9 shrink-0 rounded object-cover object-center pointer-events-none"
                draggable="false"
                loading="lazy"
              />`
        }
        <span class="whitespace-nowrap text-xs font-bold text-white"
          >${
            saved
              ? html`✓ ${translateText("player_panel.look_saved")}`
              : translateText("player_panel.get_the_look")
          }</span
        >
      </button>
    `;
  }

  render() {
    const equipped = equippedCosmetics(
      this.cosmetics,
      resolveCosmetics(this.catalog, this.userMe, null),
    );
    const lookItems = this.lookItems();
    if (equipped.length === 0 && lookItems.length === 0) return nothing;

    return html`
      <div class="flex items-center gap-2">
        <span
          class="text-xs font-semibold uppercase tracking-wider text-zinc-400"
        >
          ${translateText("player_panel.cosmetics")}
        </span>
        <div class="flex flex-wrap items-center gap-1.5">
          ${equipped.map((w) => this.renderTile(w))}
          ${lookItems.length === 0 ? nothing : this.renderLookTile(lookItems)}
        </div>
      </div>
    `;
  }
}
