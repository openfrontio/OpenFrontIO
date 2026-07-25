import { html, LitElement } from "lit";
import { customElement } from "lit/decorators.js";
import { assetUrl } from "../../../core/AssetUrls";
import { EventBus } from "../../../core/EventBus";
import { PlayerType } from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { Controller } from "../../Controller";
import { GoToPositionEvent } from "../../TransformHandler";
import { SendSpawnIntentEvent } from "../../Transport";
import { translateText } from "../../Utils";
import { GameView } from "../../view";

/** One country row in the picker. */
interface CountryEntry {
  id: number;
  name: string;
  /** 2-letter flag code; SVG lives at assetUrl(`flags/${code}.svg`). */
  flag: string;
  /** Deterministic representative tile — spawn target + camera pan target. */
  tile: TileRef;
}

type RowState = "available" | "selected" | "taken";

/**
 * Country-start spawn UI. During the spawn phase on a country-enabled map the
 * player picks a country from this scrollable side panel instead of clicking a
 * bare tile. Clicking a row claims that country (spawn intent at its canonical
 * tile) and pans the camera there; clicking countries directly on the map still
 * works too (ClientGameRunner). The panel hides the moment the spawn phase ends.
 */
@customElement("country-picker")
export class CountryPicker extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;

  private isVisible = false;
  private countries: CountryEntry[] = [];
  private built = false;
  private rowStates = new Map<number, RowState>();
  /** Last-rendered signature, so we only re-render when something changed. */
  private lastSignature = "";

  createRenderRoot() {
    // Light DOM so Tailwind classes apply; `display: contents` keeps the host
    // out of layout so only the fixed inner panel occupies space.
    this.style.display = "contents";
    return this;
  }

  private buildCountries(): void {
    if (this.built) return;
    const rm = this.game?.regionMap();
    if (rm === null || rm === undefined || !rm.hasCountries()) return;
    const list: CountryEntry[] = [];
    for (let id = 1; id <= rm.countryCount(); id++) {
      const tile = rm.countryCanonicalTile(id);
      if (tile === undefined) continue;
      list.push({
        id,
        name: rm.countryName(id),
        flag: rm.countryFlag(id),
        tile,
      });
    }
    list.sort((a, b) => a.name.localeCompare(b.name));
    this.countries = list;
    this.built = true;
  }

  private computeRowState(entry: CountryEntry): RowState {
    const owner = this.game.owner(entry.tile);
    if (!owner.isPlayer()) return "available";
    const me = this.game.myPlayer();
    if (me !== null && owner.id() === me.id()) return "selected";
    return owner.type() === PlayerType.Human ? "taken" : "available";
  }

  tick() {
    if (!this.game) return;

    const visible =
      this.game.inSpawnPhase() &&
      !this.game.config().isRandomSpawn() &&
      (this.game.regionMap()?.hasCountries() ?? false);

    if (visible) this.buildCountries();

    let signature = visible ? "1" : "0";
    if (visible) {
      this.rowStates.clear();
      for (const c of this.countries) {
        const state = this.computeRowState(c);
        this.rowStates.set(c.id, state);
        signature += `|${c.id}:${state}`;
      }
    }

    this.isVisible = visible;
    if (signature !== this.lastSignature) {
      this.lastSignature = signature;
      this.requestUpdate();
    }
  }

  private onPick(entry: CountryEntry): void {
    // Clicking the country you already hold is a no-op; picking another while
    // holding one relocates (the core returns the old country).
    if (this.rowStates.get(entry.id) === "selected") return;
    this.eventBus.emit(new SendSpawnIntentEvent(entry.tile));
    this.eventBus.emit(
      new GoToPositionEvent(this.game.x(entry.tile), this.game.y(entry.tile)),
    );
  }

  private renderRow(entry: CountryEntry) {
    const state = this.rowStates.get(entry.id) ?? "available";
    const taken = state === "taken";
    const selected = state === "selected";
    const base =
      "flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-left text-sm transition-colors";
    const stateClass = taken
      ? "opacity-40 cursor-not-allowed"
      : selected
        ? "bg-blue-600/80 hover:bg-blue-600"
        : "bg-gray-700/40 hover:bg-gray-600/70 cursor-pointer";
    return html`
      <button
        class=${`${base} ${stateClass}`}
        ?disabled=${taken}
        @click=${() => this.onPick(entry)}
        @contextmenu=${(e: Event) => e.preventDefault()}
      >
        <img
          src=${assetUrl(`flags/${encodeURIComponent(entry.flag)}.svg`)}
          alt=${entry.name}
          class="h-5 w-5 rounded-sm object-cover shrink-0"
          @error=${(e: Event) => {
            (e.target as HTMLImageElement).style.visibility = "hidden";
          }}
        />
        <span class="flex-1 min-w-0 truncate">${entry.name}</span>
        ${taken
          ? html`<span
              class="shrink-0 text-[10px] uppercase tracking-wide text-slate-300"
              >${translateText("country_picker.taken")}</span
            >`
          : ""}
      </button>
    `;
  }

  render() {
    if (!this.isVisible) return html``;
    return html`
      <aside
        class="fixed left-2 top-1/2 -translate-y-1/2 z-[900] flex flex-col w-56 max-w-[70vw] max-h-[70vh] p-2 gap-2 bg-gray-800/92 backdrop-blur-sm rounded-lg shadow-lg text-white"
        @contextmenu=${(e: Event) => e.preventDefault()}
      >
        <h2 class="text-sm font-semibold px-1 shrink-0">
          ${translateText("country_picker.title")}
        </h2>
        <div class="flex flex-col gap-1 overflow-y-auto pr-1">
          ${this.countries.map((c) => this.renderRow(c))}
        </div>
      </aside>
    `;
  }
}
