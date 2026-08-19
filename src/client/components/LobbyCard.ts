import { html, TemplateResult } from "lit";
import { GameMapType } from "../../core/game/Game";
import { PublicGameInfo } from "../../core/Schemas";
import { terrainMapFileLoader } from "../TerrainMapFileLoader";
import { getMapName, getModifierLabels } from "../Utils";

/**
 * The map-image lobby card used on the homepage and in the detailed lobby
 * browser: map art behind modifier pills, a countdown pill, the player count
 * and a bottom bar naming the map and mode.
 */

/**
 * Aspect ratios keyed by map, loaded lazily from each map's manifest. Shared
 * so the second component to render a map doesn't refetch it.
 */
class MapAspectRatioCache {
  private ratios = new Map<GameMapType, number>();
  private pending = new Set<GameMapType>();

  get(mapType: GameMapType | undefined): number | undefined {
    return mapType === undefined ? undefined : this.ratios.get(mapType);
  }

  /**
   * Fetch the ratio for `mapType` if it isn't known yet, calling `onLoaded`
   * once it lands so the caller can re-render. Safe to call every render.
   */
  ensure(mapType: GameMapType | undefined, onLoaded: () => void): void {
    if (mapType === undefined) return;
    if (this.ratios.has(mapType) || this.pending.has(mapType)) return;
    this.pending.add(mapType);
    terrainMapFileLoader
      .getMapData(mapType)
      .manifest()
      .then((manifest: any) => {
        if (manifest?.map?.width && manifest?.map?.height) {
          this.ratios.set(mapType, manifest.map.width / manifest.map.height);
          onLoaded();
        }
      })
      .catch((e) => console.error(`Failed to load manifest for ${mapType}`, e))
      .finally(() => this.pending.delete(mapType));
  }
}

export const mapAspectRatios = new MapAspectRatioCache();

export interface LobbyCardOptions {
  lobby: PublicGameInfo;
  /** Bottom-bar subtitle: the game mode, e.g. "FFA" or "5 teams of 20". */
  subtitle: string | TemplateResult;
  /** Right-hand pill: countdown, "Starting…", or a status word. */
  timeDisplay: string;
  timeDisplayUppercase?: boolean;
  onClick: () => void;
  disabled?: boolean;
  /**
   * Gated rather than disabled: the card dims and reports `aria-disabled`, but
   * stays clickable, so `onClick` still runs and can refuse the action itself
   * (the desktop update bar's attention animation is triggered from there).
   * `disabled` would swallow the click -- it also sets pointer-events-none --
   * leaving a gated card that looks broken instead of explaining itself.
   */
  blocked?: boolean;
  /** Card height; defaults to the homepage's fill-the-grid-cell sizing. */
  heightClass?: string;
  /**
   * When set, a corner expand control is drawn over the card's bottom-right.
   * It sits outside the card button (buttons can't nest) and swallows the
   * click so expanding never joins the lobby.
   */
  onExpand?: () => void;
  /** Accessible name for the expand control; required alongside `onExpand`. */
  expandLabel?: string;
}

export function lobbyCard({
  lobby,
  subtitle,
  timeDisplay,
  timeDisplayUppercase = false,
  onClick,
  disabled = false,
  blocked = false,
  heightClass = "h-44 sm:h-full",
  onExpand,
  expandLabel,
}: LobbyCardOptions): TemplateResult {
  const mapType = lobby.gameConfig!.gameMap as GameMapType;
  const mapImageSrc = terrainMapFileLoader.getMapData(mapType).webpPath;
  const aspectRatio = mapAspectRatios.get(mapType);
  // Use object-contain for extreme aspect ratios (e.g. Amazon River ~20:1) so
  // the full map is visible instead of being cropped by object-cover.
  const useContain =
    aspectRatio !== undefined && (aspectRatio > 4 || aspectRatio < 0.25);
  const mapName = getMapName(lobby.gameConfig?.gameMap);
  // A featured lobby names itself; the map drops to the subtitle line so
  // nothing is lost. Lit interpolates it as text, never markup.
  const featuredLabel = lobby.featured ? lobby.label : undefined;
  const title = featuredLabel ?? mapName;
  const subtitleLine = featuredLabel
    ? [mapName, subtitle].filter(Boolean).join(" · ")
    : subtitle;

  // Hosted lobbies don't always advertise a cap; showing "3/" reads as a
  // missing number, so drop the separator when there's nothing to divide by.
  const capacity = lobby.gameConfig?.maxPlayers;
  const playerCount =
    capacity === undefined
      ? String(lobby.numClients)
      : `${lobby.numClients}/${capacity}`;

  const modifierLabels = getModifierLabels(
    lobby.gameConfig?.publicGameModifiers,
    lobby.gameConfig?.doomsdayClock?.speed,
  );
  // Sort by length for visual consistency (shorter labels first)
  if (modifierLabels.length > 1) {
    modifierLabels.sort((a, b) => a.length - b.length);
  }

  return html`
    <div class="relative w-full ${heightClass}">
      <button
        @click=${onClick}
        ?disabled=${disabled}
        aria-disabled=${blocked}
        class="group relative w-full h-full text-white uppercase rounded-2xl transition-shadow duration-200 bg-surface hover:shadow-[var(--shadow-lobby-card-hover)] ${disabled
          ? "opacity-50 cursor-not-allowed pointer-events-none"
          : blocked
            ? "opacity-50 cursor-not-allowed"
            : ""}"
      >
        <!-- Image clipped separately so overflow-hidden doesn't block absolute children -->
        <div
          class="absolute inset-0 rounded-2xl overflow-hidden pointer-events-none"
        >
          ${mapImageSrc
            ? html`<img
                src="${mapImageSrc}"
                alt="${mapName ?? lobby.gameConfig?.gameMap ?? "map"}"
                draggable="false"
                class="absolute inset-0 w-full h-full transition-transform duration-200 ${useContain
                  ? "object-contain group-hover:scale-105"
                  : "object-cover object-center scale-[1.05] group-hover:scale-[1.12]"} [image-rendering:auto]"
              />`
            : null}
        </div>
        <!-- Top row: modifiers + timer -->
        <div
          class="absolute inset-x-2 top-2 flex items-start justify-between gap-2"
        >
          ${modifierLabels.length > 0
            ? html`<div
                class="flex flex-col items-start gap-1 mt-[2px] min-w-0 max-w-[65%]"
              >
                ${modifierLabels.map(
                  (label) =>
                    html`<span
                      class="px-2 py-1 rounded text-xs font-bold uppercase tracking-widest bg-malibu-blue text-white shadow-[var(--shadow-malibu-blue-pill)]"
                      >${label}</span
                    >`,
                )}
              </div>`
            : html`<div></div>`}
          <div class="shrink-0">
            <span
              class="text-xs font-bold tracking-widest ${timeDisplayUppercase
                ? "uppercase"
                : "normal-case"} bg-malibu-blue text-white px-2 py-1 rounded"
              >${timeDisplay}</span
            >
          </div>
        </div>
        <!-- Bottom bar: map name + mode, with player count floating above -->
        <div
          class="absolute bottom-0 left-0 right-0 flex flex-col px-3 py-2 bg-black/55 backdrop-blur-sm rounded-b-2xl"
          style="overflow: visible;"
        >
          <span
            class="absolute bottom-full right-2 mb-1 flex items-center gap-1 text-xs font-bold tracking-widest bg-black/70 backdrop-blur-sm px-2 py-0.5 rounded"
          >
            ${playerCount}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-4 w-4 inline-block"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z"
              ></path>
            </svg>
          </span>
          ${title
            ? html`<p
                class="text-sm sm:text-base font-bold uppercase tracking-wider text-left leading-tight"
              >
                ${title}
              </p>`
            : ""}
          <h3
            class="text-xs text-white/70 uppercase tracking-wider text-left ${onExpand
              ? "pr-9"
              : ""}"
          >
            ${subtitleLine}
          </h3>
        </div>
      </button>
      ${onExpand
        ? html`<button
            @click=${(e: Event) => {
              e.stopPropagation();
              onExpand();
            }}
            ?disabled=${disabled}
            aria-label=${expandLabel ?? ""}
            title=${expandLabel ?? ""}
            class="absolute bottom-2 right-2 z-10 flex items-center justify-center size-8 rounded-lg bg-black/70 backdrop-blur-sm text-white/90 hover:text-white hover:bg-black/85 transition-colors ${disabled
              ? "opacity-50 cursor-not-allowed pointer-events-none"
              : ""}"
          >
            <!-- Expand icon by Proicon from the Noun Project; see CREDITS.md -->
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 100 100"
              fill="currentColor"
              class="size-5"
              aria-hidden="true"
            >
              <path
                fill-rule="evenodd"
                d="m39.199 91.039h51.84v-82.078h-82.078v51.84h-5.7617v-57.602h93.602v93.602h-57.602zm0.84375-35.156 4.0703 4.0703 31.328-31.32v13.445h5.7617l-0.003906-23.277h-23.281v5.7617h13.445zm-31.082 35.156h18.238v-18.238h-18.238zm21.117 5.7617h2.8789l0.003907-29.762h-29.762v29.762z"
              />
            </svg>
          </button>`
        : null}
    </div>
  `;
}
