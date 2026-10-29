import {
  GameMapType,
  listedMaps,
  MapInfo,
} from "@openfront/engine-api/game/GameTypes";
import { assetUrl } from "@openfront/shared/AssetUrls";
import { html, LitElement, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import {
  loadCachedManifest,
  terrainMapFileLoader,
} from "../../TerrainMapFileLoader";
import { translateText } from "../../Utils";
import {
  EARTH_MAP_HEIGHT,
  EARTH_MAP_WIDTH,
  projectEarth,
} from "./EarthProjection";
import { type MapStats, mapStats, renderMapDetails } from "./MapDetails";

interface EarthPin {
  map: MapInfo;
  x: number;
  y: number;
  continental: boolean;
}

// Continental pins first, so the regional pins drawn over them stay clickable.
const pins: EarthPin[] = listedMaps
  .flatMap((map) => {
    if (map.location === undefined) return [];
    const [x, y] = projectEarth(map.location.lat, map.location.lon);
    return [{ map, x, y, continental: map.categories.includes("continental") }];
  })
  .sort((a, b) => Number(b.continental) - Number(a.continental));

const continents = pins.filter((pin) => pin.continental);

// Labels go above their ring, unless another continent's ring sits just above.
const labelsBelow = new Set(
  continents.filter((pin) =>
    continents.some(
      (other) =>
        other.y < pin.y &&
        pin.y - other.y < 30 &&
        Math.abs(other.x - pin.x) < 60,
    ),
  ),
);

const ASPECT = EARTH_MAP_HEIGHT / EARTH_MAP_WIDTH;
const MIN_VIEW_WIDTH = EARTH_MAP_WIDTH / 10;
const BUTTON_ZOOM = 1.6;
// Pointer travel, in pixels, after which a press pans instead of clicking.
const DRAG_THRESHOLD = 5;

let landPath: Promise<string> | null = null;

function loadLandPath(): Promise<string> {
  landPath ??= fetch(assetUrl("images/EarthMap.svg"))
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.text();
    })
    .then(
      (svg) =>
        new DOMParser()
          .parseFromString(svg, "image/svg+xml")
          .querySelector("path")
          ?.getAttribute("d") ?? "",
    )
    .catch((error: unknown) => {
      landPath = null;
      throw error;
    });
  return landPath;
}

@customElement("earth-map")
export class EarthMap extends LitElement {
  @property({ type: String }) selectedMap: GameMapType = GameMapType.World;
  @property({ type: Boolean }) useRandomMap = false;
  @property({ attribute: false }) onSelectMap?: (map: GameMapType) => void;
  @state() private landPath = "";
  @state() private view = { x: 0, y: 0, width: EARTH_MAP_WIDTH };
  @state() private hovered: EarthPin | null = null;
  @state() private stats = new Map<GameMapType, MapStats>();
  @query("[data-earth-frame]") private frame!: HTMLElement;
  private pointers = new Map<number, { x: number; y: number }>();
  private dragDistance = 0;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    loadLandPath()
      .then((path) => (this.landPath = path))
      .catch((error: unknown) =>
        console.warn("Failed to load the Earth map:", error),
      );
  }

  private get zoomed(): boolean {
    return this.view.width < EARTH_MAP_WIDTH;
  }

  private setView(x: number, y: number, width: number) {
    const height = width * ASPECT;
    this.view = {
      x: Math.min(EARTH_MAP_WIDTH - width, Math.max(0, x)),
      y: Math.min(EARTH_MAP_HEIGHT - height, Math.max(0, y)),
      width,
    };
  }

  /** Zooms to `width` keeping the point at frame fractions (fx, fy) still. */
  private zoomTo(width: number, fx = 0.5, fy = 0.5) {
    const { x, y, width: oldWidth } = this.view;
    const newWidth = Math.min(EARTH_MAP_WIDTH, Math.max(MIN_VIEW_WIDTH, width));
    this.setView(
      x + fx * (oldWidth - newWidth),
      y + fy * (oldWidth - newWidth) * ASPECT,
      newWidth,
    );
  }

  private frameFraction(clientX: number, clientY: number): [number, number] {
    const rect = this.frame.getBoundingClientRect();
    return [
      (clientX - rect.left) / rect.width,
      (clientY - rect.top) / rect.height,
    ];
  }

  private handleWheel(event: WheelEvent) {
    // Fully zoomed out, scrolling down scrolls the page instead.
    if (event.deltaY > 0 && !this.zoomed) return;
    event.preventDefault();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : 1);
    this.zoomTo(
      this.view.width * Math.exp(Math.max(-100, Math.min(100, delta)) / 250),
      ...this.frameFraction(event.clientX, event.clientY),
    );
  }

  private handlePointerDown(event: PointerEvent) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (event.pointerType === "touch" && !this.isOnPin(event)) {
      this.hovered = null;
    }
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size === 1) this.dragDistance = 0;
  }

  private handlePointerMove(event: PointerEvent) {
    const previous = this.pointers.get(event.pointerId);
    if (previous === undefined) return;
    const others = [...this.pointers].filter(([id]) => id !== event.pointerId);
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (others.length === 0) {
      const dx = event.clientX - previous.x;
      const dy = event.clientY - previous.y;
      this.dragDistance += Math.abs(dx) + Math.abs(dy);
      if (this.dragDistance <= DRAG_THRESHOLD) return;
      if (!this.frame.hasPointerCapture(event.pointerId)) {
        this.frame.setPointerCapture(event.pointerId);
        this.hovered = null;
      }
      const scale = this.view.width / this.frame.clientWidth;
      this.setView(
        this.view.x - dx * scale,
        this.view.y - dy * scale,
        this.view.width,
      );
      return;
    }

    const other = others[0][1];
    const before = Math.hypot(previous.x - other.x, previous.y - other.y);
    const after = Math.hypot(event.clientX - other.x, event.clientY - other.y);
    this.dragDistance = Infinity;
    this.hovered = null;
    if (before > 0 && after > 0) {
      this.zoomTo(
        (this.view.width * before) / after,
        ...this.frameFraction(
          (event.clientX + other.x) / 2,
          (event.clientY + other.y) / 2,
        ),
      );
    }
  }

  private handlePointerUp(event: PointerEvent) {
    this.pointers.delete(event.pointerId);
  }

  private isOnPin(event: Event): boolean {
    return (event.target as Element).closest("[data-earth-pin]") !== null;
  }

  private hover(pin: EarthPin) {
    this.hovered = pin;
    const map = pin.map.type;
    if (this.stats.has(map)) return;
    loadCachedManifest(map)
      .then((manifest) => {
        this.stats = new Map(this.stats).set(map, mapStats(manifest));
      })
      .catch((error: unknown) =>
        console.warn("Failed to load map stats:", error),
      );
  }

  private selectPin(pin: EarthPin) {
    if (this.dragDistance > DRAG_THRESHOLD) return;
    this.hover(pin);
    this.onSelectMap?.(pin.map.type);
  }

  private position(pin: EarthPin): [number, number] {
    return [
      ((pin.x - this.view.x) / this.view.width) * 100,
      ((pin.y - this.view.y) / (this.view.width * ASPECT)) * 100,
    ];
  }

  private renderPin(pin: EarthPin) {
    const [left, top] = this.position(pin);
    if (left < -2 || left > 102 || top < -2 || top > 102) return nothing;
    const selected = !this.useRandomMap && pin.map.type === this.selectedMap;
    const name = translateText(pin.map.translationKey);
    return html`<button
      type="button"
      tabindex="-1"
      data-earth-pin=${pin.map.id}
      aria-label=${name}
      aria-pressed=${selected}
      class="group/pin absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center ${
        selected ? "z-10" : ""
      }"
      style="left: ${left}%; top: ${top}%"
      @pointerenter=${() => this.hover(pin)}
      @pointerleave=${(event: PointerEvent) => {
        if (event.pointerType !== "touch" && this.hovered === pin) {
          this.hovered = null;
        }
      }}
      @click=${() => this.selectPin(pin)}
    >
      ${
        pin.continental
          ? html`<span
              class="flex h-4 w-4 items-center justify-center rounded-full border-2 bg-black/40 transition-transform duration-150 group-hover/pin:scale-125 ${
                selected
                  ? "border-cyber-yellow shadow-[0_0_10px_rgba(255,215,0,0.7)]"
                  : "border-aquarius"
              }"
            >
              <span
                class="h-1.5 w-1.5 rounded-full ${
                  selected ? "bg-cyber-yellow" : "bg-aquarius"
                }"
              ></span>
            </span>`
          : html`<span
              class="rounded-full ring-2 ring-black/50 transition-transform duration-150 group-hover/pin:scale-150 ${
                selected
                  ? "h-3.5 w-3.5 bg-cyber-yellow shadow-[0_0_10px_rgba(255,215,0,0.8)]"
                  : "h-2.5 w-2.5 bg-emerald-400"
              }"
            ></span>`
      }
    </button>`;
  }

  private renderContinentLabel(pin: EarthPin) {
    const [left, top] = this.position(pin);
    if (left < 0 || left > 100 || top < 0 || top > 100) return nothing;
    return html`<span
      class="pointer-events-none absolute -translate-x-1/2 whitespace-nowrap text-[11px] font-bold text-aquarius [text-shadow:0_1px_3px_rgba(0,0,0,0.9)]"
      style="left: ${left}%; ${
        labelsBelow.has(pin)
          ? `top: calc(${top}% + 10px)`
          : `bottom: calc(${100 - top}% + 10px)`
      }"
    >
      ${translateText(pin.map.translationKey)}
    </span>`;
  }

  private renderTooltip() {
    const pin = this.hovered;
    if (pin === null) return nothing;
    const [left, top] = this.position(pin);
    const vertical =
      top < 50
        ? `top: calc(${top}% + 16px)`
        : `bottom: calc(${100 - top}% + 16px)`;
    return html`<div
      role="tooltip"
      class="pointer-events-none absolute z-30 flex w-56 flex-col gap-1 rounded-lg border border-white/10 bg-zinc-900/95 p-2 text-xs text-white/90 shadow-xl"
      style="left: clamp(4px, calc(${left}% - 7rem), calc(100% - 14rem - 4px)); ${vertical}"
    >
      <img
        src=${terrainMapFileLoader.getMapData(pin.map.type).webpPath}
        alt=""
        draggable="false"
        class="mb-1 aspect-[2/1] w-full rounded-md bg-black/30 object-contain"
      />
      <div class="text-sm font-bold uppercase tracking-wider text-white">
        ${translateText(pin.map.translationKey)}
      </div>
      ${renderMapDetails(pin.map, this.stats.get(pin.map.type))}
    </div>`;
  }

  private renderControls() {
    const buttonClass =
      "flex h-8 w-8 items-center justify-center text-lg font-bold text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent";
    return html`<div
      class="absolute right-2 top-2 z-20 flex flex-col overflow-hidden rounded-lg border border-white/10 bg-black/50 backdrop-blur-sm"
      @pointerdown=${(event: Event) => event.stopPropagation()}
    >
      <button
        type="button"
        class=${buttonClass}
        aria-label=${translateText("map_component.zoom_in")}
        title=${translateText("map_component.zoom_in")}
        ?disabled=${this.view.width <= MIN_VIEW_WIDTH}
        @click=${() => this.zoomTo(this.view.width / BUTTON_ZOOM)}
      >
        +
      </button>
      <button
        type="button"
        class=${buttonClass}
        aria-label=${translateText("map_component.zoom_out")}
        title=${translateText("map_component.zoom_out")}
        ?disabled=${!this.zoomed}
        @click=${() => this.zoomTo(this.view.width * BUTTON_ZOOM)}
      >
        −
      </button>
      ${
        this.zoomed
          ? html`<button
              type="button"
              class=${buttonClass}
              aria-label=${translateText("map_component.earth_reset")}
              title=${translateText("map_component.earth_reset")}
              @click=${() => this.setView(0, 0, EARTH_MAP_WIDTH)}
            >
              <svg
                viewBox="0 0 20 20"
                fill="currentColor"
                class="h-4 w-4"
                aria-hidden="true"
              >
                <path
                  fill-rule="evenodd"
                  d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H3.989a.75.75 0 00-.75.75v4.242a.75.75 0 001.5 0v-2.43l.31.31a7 7 0 0011.712-3.138.75.75 0 00-1.449-.39zm1.23-3.723a.75.75 0 00.219-.53V2.929a.75.75 0 00-1.5 0V5.36l-.31-.31A7 7 0 003.239 8.188a.75.75 0 101.448.389A5.5 5.5 0 0113.89 6.11l.311.31h-2.432a.75.75 0 000 1.5h4.243a.75.75 0 00.53-.219z"
                  clip-rule="evenodd"
                />
              </svg>
            </button>`
          : nothing
      }
    </div>`;
  }

  private renderLegend() {
    return html`<div
      class="pointer-events-none absolute bottom-2 left-2 z-20 flex items-center gap-3 rounded-lg bg-black/50 px-2.5 py-1.5 text-[11px] text-white/70 backdrop-blur-sm"
    >
      <span class="flex items-center gap-1.5">
        <span
          class="h-3 w-3 rounded-full border-2 border-aquarius bg-black/40"
        ></span>
        ${translateText("map_component.earth_continental")}
      </span>
      <span class="flex items-center gap-1.5">
        <span class="h-2.5 w-2.5 rounded-full bg-emerald-400"></span>
        ${translateText("map_component.earth_regional")}
      </span>
    </div>`;
  }

  render() {
    const { x, y, width } = this.view;
    return html`<div
      data-earth-frame
      class="relative w-full select-none overflow-hidden rounded-xl border border-white/10 bg-slate-950/60 ${
        this.zoomed ? "cursor-grab active:cursor-grabbing" : ""
      }"
      style="aspect-ratio: ${EARTH_MAP_WIDTH} / ${EARTH_MAP_HEIGHT}; touch-action: ${
        this.zoomed ? "none" : "pan-y"
      }"
      @wheel=${{
        handleEvent: (event: WheelEvent) => this.handleWheel(event),
        passive: false,
      }}
      @pointerdown=${this.handlePointerDown}
      @pointermove=${this.handlePointerMove}
      @pointerup=${this.handlePointerUp}
      @pointercancel=${this.handlePointerUp}
      @pointerleave=${this.handlePointerUp}
    >
      <svg
        class="absolute inset-0 h-full w-full ${
          this.landPath ? "" : "animate-pulse"
        }"
        viewBox="${x} ${y} ${width} ${width * ASPECT}"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path
          d=${this.landPath}
          fill-rule="evenodd"
          vector-effect="non-scaling-stroke"
          stroke-width="0.75"
          class="fill-slate-700/60 stroke-slate-400/30"
        ></path>
      </svg>
      ${continents.map((pin) => this.renderContinentLabel(pin))}
      ${pins.map((pin) => this.renderPin(pin))} ${this.renderTooltip()}
      ${this.renderControls()} ${this.renderLegend()}
    </div>`;
  }
}
