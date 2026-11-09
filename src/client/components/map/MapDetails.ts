import { MapInfo } from "@openfront/engine-api/game/GameTypes";
import { MapManifest } from "@openfront/engine-api/game/MapManifest";
import { mapPlayerCounts } from "@openfront/shared/MapPlayerCounts";
import { html, LitElement, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { translateText } from "../../Utils";

export interface MapStats {
  width: number;
  height: number;
  landPercent: number;
  nations: number;
  players: number;
}

export function mapStats(manifest: MapManifest): MapStats {
  const { width, height, num_land_tiles } = manifest.map;
  return {
    width,
    height,
    landPercent: Math.round((num_land_tiles / (width * height)) * 100),
    nations: manifest.nations.length,
    players: mapPlayerCounts(num_land_tiles)[0],
  };
}

export function hasMapDetails(map: MapInfo | undefined): map is MapInfo {
  return map?.author !== undefined || map?.descriptionKey !== undefined;
}

export function renderMapDetails(map: MapInfo, stats?: MapStats) {
  return html`${
    map.descriptionKey !== undefined
      ? html`<div>${translateText(map.descriptionKey)}</div>`
      : nothing
  }
  ${
    stats !== undefined
      ? html`<div
          data-map-stats
          class="grid grid-cols-[repeat(auto-fit,minmax(5.5rem,1fr))] gap-x-4 whitespace-nowrap text-[11px] text-white/60"
        >
          <span>${stats.width}×${stats.height}</span>
          <span>
            ${translateText("map_component.stat_nations", {
              count: stats.nations,
            })}
          </span>
          <span>
            ${translateText("map_component.stat_land", {
              percent: stats.landPercent,
            })}
          </span>
          <span>
            ${translateText("map_component.stat_players", {
              count: stats.players,
            })}
          </span>
        </div>`
      : nothing
  }
  ${
    map.author !== undefined
      ? html`<div class="text-[11px] text-white/60">
          ${translateText("map_component.by_author", { author: map.author })}
        </div>`
      : nothing
  }`;
}

/** The "?" on a map card that shows the map's description, stats and author. */
@customElement("map-details")
export class MapDetails extends LitElement {
  @property({ attribute: false }) map?: MapInfo;
  @property({ attribute: false }) stats?: MapStats;

  createRenderRoot() {
    return this;
  }

  private isHovered = false;
  private isFocused = false;

  private onPointerEnter = () => {
    this.isHovered = true;
    this.clampTooltip();
  };

  private onPointerLeave = () => {
    this.isHovered = false;
    if (!this.isFocused) {
      this.resetTooltip();
    }
  };

  private onFocusIn = () => {
    this.isFocused = true;
    this.clampTooltip();
  };

  private onFocusOut = () => {
    this.isFocused = false;
    if (!this.isHovered) {
      this.resetTooltip();
    }
  };

  private clampTooltip = () => {
    const tooltip = this.querySelector<HTMLElement>('[role="tooltip"]');
    if (!tooltip) return;
    tooltip.style.transform = "";

    const tooltipRect = tooltip.getBoundingClientRect();
    if (tooltipRect.width === 0) return;

    let container = this.parentElement;
    let minLeft = 8;
    let maxRight = window.innerWidth - 8;

    while (container && container !== document.body) {
      const style = window.getComputedStyle(container);
      if (
        style.overflowX === "auto" ||
        style.overflowX === "scroll" ||
        style.overflowX === "hidden" ||
        style.overflowY === "auto" ||
        style.overflowY === "scroll"
      ) {
        const rect = container.getBoundingClientRect();
        minLeft = Math.max(minLeft, rect.left + 8);
        maxRight = Math.min(maxRight, rect.right - 8);
        break;
      }
      container = container.parentElement;
    }

    let shift = 0;
    if (tooltipRect.left < minLeft) {
      shift = minLeft - tooltipRect.left;
    } else if (tooltipRect.right > maxRight) {
      shift = maxRight - tooltipRect.right;
    }

    if (shift !== 0) {
      tooltip.style.transform = `translateX(${shift}px)`;
    }
  };

  private resetTooltip = () => {
    const tooltip = this.querySelector<HTMLElement>('[role="tooltip"]');
    if (tooltip) tooltip.style.transform = "";
  };

  render() {
    const map = this.map;
    if (map === undefined || (!hasMapDetails(map) && !this.stats)) {
      return nothing;
    }
    return html`<div
      class="group/map-details pointer-events-none absolute inset-x-3 top-3 z-10 flex p-1.5"
      @click=${(event: Event) => event.stopPropagation()}
      @keydown=${(event: Event) => event.stopPropagation()}
      @pointerenter=${this.onPointerEnter}
      @pointerleave=${this.onPointerLeave}
      @focusin=${this.onFocusIn}
      @focusout=${this.onFocusOut}
    >
      <button
        type="button"
        aria-label=${translateText("map_component.info")}
        class="pointer-events-auto flex h-7 w-7 cursor-help items-center justify-center rounded-full bg-black/40 text-xs font-black text-white backdrop-blur-sm opacity-0 transition-opacity duration-200 hover:bg-black/70 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 group-hover:opacity-100 pointer-coarse:opacity-100"
      >
        ?
      </button>
      <div
        role="tooltip"
        class="pointer-events-none absolute left-1/2 top-10 hidden w-72 sm:w-80 max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-col gap-1 whitespace-normal rounded-lg border border-white/10 bg-zinc-900 px-3 py-2 text-left text-xs normal-case tracking-normal text-white/90 shadow-xl group-hover/map-details:flex group-focus-within/map-details:flex"
      >
        ${renderMapDetails(map, this.stats)}
      </div>
    </div>`;
  }
}
