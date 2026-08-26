import { html, svg, TemplateResult } from "lit";
import { UserMeResponse } from "../../core/ApiSchemas";
import { GameMapType } from "../../core/game/Game";
import { PublicGameInfo } from "../../core/Schemas";
import { terrainMapFileLoader } from "../TerrainMapFileLoader";
import { getMapName, getModifierLabels, translateText } from "../Utils";

/**
 * Whether the signed-in player may join trusted-only lobbies, from the
 * userMeResponse Main dispatches. Logged out, an API without the field, and a
 * failed computation (null) all read as untrusted.
 */
export function viewerIsTrusted(userMe: UserMeResponse | false): boolean {
  return userMe !== false && userMe.player.trustTier === "trusted";
}

/**
 * The map-image lobby card used on the homepage and in the More Games lobby
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
  /**
   * Whether the viewer's account is trusted (viewerIsTrusted). Only matters
   * for a trusted-only lobby, whose card shows a closed lock when the viewer
   * can't join it and an open one when they can.
   */
  viewerTrusted?: boolean;
  /** Card height; defaults to the homepage's fill-the-grid-cell sizing. */
  heightClass?: string;
}

export function lobbyCard({
  lobby,
  subtitle,
  timeDisplay,
  timeDisplayUppercase = false,
  onClick,
  disabled = false,
  blocked = false,
  viewerTrusted = false,
  heightClass = "h-44 sm:h-full",
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

  const trustedOnly = lobby.gameConfig?.trusted === true;

  return html`
    <button
      @click=${onClick}
      ?disabled=${disabled}
      aria-disabled=${blocked}
      class="group relative w-full ${heightClass} text-white uppercase rounded-2xl transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] bg-surface hover:shadow-[var(--shadow-lobby-card-hover)] ${disabled
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
              class="absolute inset-0 w-full h-full ${useContain
                ? "object-contain"
                : "object-cover object-center scale-[1.05]"} [image-rendering:auto]"
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
        <div class="shrink-0 flex items-center gap-1">
          ${trustedOnly ? trustLockIcon(viewerTrusted) : null}
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
        <h3 class="text-xs text-white/70 uppercase tracking-wider text-left">
          ${subtitleLine}
        </h3>
      </div>
    </button>
  `;
}

// Closed lock: the viewer can't join this trusted-only lobby. Open lock: they
// can. Heroicons mini lock-closed / lock-open.
function trustLockIcon(viewerTrusted: boolean): TemplateResult {
  const label = translateText(
    viewerTrusted
      ? "public_lobby.trusted_unlocked"
      : "public_lobby.trusted_locked",
  );
  return html`<span
    class="flex items-center bg-black/70 backdrop-blur-sm px-1.5 py-1 rounded"
    title=${label}
    aria-label=${label}
    data-trust=${viewerTrusted ? "unlocked" : "locked"}
  >
    <svg
      xmlns="http://www.w3.org/2000/svg"
      class="h-4 w-4"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      ${viewerTrusted
        ? svg`<path
            d="M14.5 1A4.5 4.5 0 0 0 10 5.5V9H3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-1.5V5.5a3 3 0 1 1 6 0v2.75a.75.75 0 0 0 1.5 0V5.5A4.5 4.5 0 0 0 14.5 1Z"
          ></path>`
        : svg`<path
            fill-rule="evenodd"
            d="M10 1a4.5 4.5 0 0 0-4.5 4.5V9H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-.5V5.5A4.5 4.5 0 0 0 10 1Zm3 8V5.5a3 3 0 1 0-6 0V9h6Z"
            clip-rule="evenodd"
          ></path>`}
    </svg>
  </span>`;
}
