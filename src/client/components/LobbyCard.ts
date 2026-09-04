import { html, nothing, svg, TemplateResult } from "lit";
import { UserMeResponse } from "../../core/ApiSchemas";
import { GameMapType } from "../../core/game/Game";
import { PublicGameInfo } from "../../core/Schemas";
import { responseHasLinkedIdentity } from "../AccountIdentity";
import { terrainMapFileLoader } from "../TerrainMapFileLoader";
import { getMapName, getModifierLabels, translateText } from "../Utils";
import "./ConfirmDialog";

/**
 * Whether the signed-in player may join trusted-only lobbies, from the
 * userMeResponse Main dispatches. Logged out, an API without the field, and a
 * failed computation (null) all read as untrusted.
 */
export function viewerIsTrusted(userMe: UserMeResponse | false): boolean {
  return userMe !== false && userMe.player.trustTier === "trusted";
}

/**
 * Whether the viewer has an account to become trusted on. A guest session
 * still resolves to a UserMeResponse, so a linked identity (Discord, Google,
 * Steam, email) is what counts. Callers on CrazyGames must OR in the SDK
 * profile themselves; it isn't on the API response.
 */
export function viewerIsSignedIn(userMe: UserMeResponse | false): boolean {
  return responseHasLinkedIdentity(userMe);
}

/** Whether the viewer may join `lobby`: it is open, or they are trusted. */
export function canJoinTrustedLobby(
  lobby: PublicGameInfo,
  viewerTrusted: boolean,
): boolean {
  return lobby.gameConfig?.trusted !== true || viewerTrusted;
}

/**
 * Popup shown instead of attempting to join a trusted-only lobby the viewer
 * can't get into (the server would refuse them anyway). Tells them how to
 * become trusted rather than letting the join fail: a signed-out viewer is
 * told to sign in first, since trust only attaches to an account.
 */
export function trustRequiredDialog(
  signedIn: boolean,
  onClose: () => void,
): TemplateResult {
  return html`<confirm-dialog
    .heading=${translateText("public_lobby.trust_required_title")}
    .message=${translateText(
      signedIn
        ? "public_lobby.trust_required_body"
        : "public_lobby.trust_required_body_signed_out",
    )}
    variant="warning"
    .showClose=${true}
    .buttons=${"confirmOnly"}
    .confirmText=${translateText("public_lobby.trust_required_ok")}
    @cancel=${onClose}
    @confirm=${onClose}
  ></confirm-dialog>`;
}

/**
 * The map-image lobby card used on the homepage and in the More Games lobby
 * browser: map art behind modifier pills, a countdown pill, the player count
 * and a bottom bar naming the map and mode.
 */

/**
 * One class for both of the top row's pills so they can't drift apart. Keep
 * them direct flex children of the row: wrapped in a block, a pill picks up a
 * line box and renders 4px short and 2px low.
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
   * Gated rather than disabled: the card dims and reports `aria-disabled` but
   * stays clickable, so `onClick` still runs and can refuse the action itself.
   * `disabled` would swallow the click (it also sets pointer-events-none).
   */
  blocked?: boolean;
  /** Only matters for a trusted-only lobby, which shows an open or closed lock. */
  viewerTrusted?: boolean;
  /** Card height; defaults to the homepage's fill-the-grid-cell sizing. */
  heightClass?: string;
}

const PILL =
  "rounded bg-malibu-blue px-2 py-1 text-xs font-bold tracking-widest text-white";
const BADGE = "rounded bg-black/70 backdrop-blur-sm";

/** Extreme aspect ratios (Amazon River is ~20:1) show whole rather than cropped. */
function fitsByContain(mapType: GameMapType): boolean {
  const ratio = mapAspectRatios.get(mapType);
  return ratio !== undefined && (ratio > 4 || ratio < 0.25);
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
  const mapName = getMapName(lobby.gameConfig?.gameMap);
  // A featured lobby names itself; the map drops to the subtitle line.
  const title = (lobby.featured ? lobby.label : undefined) ?? mapName;
  const subtitleLine =
    title === mapName || mapName === undefined
      ? subtitle
      : subtitle
        ? html`${mapName} · ${subtitle}`
        : mapName;
  // Hosted lobbies don't always advertise a cap; "3/" reads as a missing number.
  const capacity = lobby.gameConfig?.maxPlayers;
  const playerCount =
    capacity === undefined
      ? String(lobby.numClients)
      : `${lobby.numClients}/${capacity}`;
  // Longest first, so on a short card the pills that say the most stay legible.
  const modifiers = getModifierLabels(
    lobby.gameConfig?.publicGameModifiers,
    lobby.gameConfig?.doomsdayClock?.speed,
  ).sort((a, b) => b.length - a.length);
  const trustedOnly = lobby.gameConfig?.trusted === true;

  const state = disabled
    ? "opacity-50 cursor-not-allowed pointer-events-none"
    : blocked
      ? "opacity-50 cursor-not-allowed"
      : "";
  // Cover images sit at 1.05 to hide their edges, so they zoom from there.
  const image = fitsByContain(mapType)
    ? "object-contain group-hover:scale-105"
    : "object-cover scale-[1.05] group-hover:scale-[1.12]";

  return html`
    <button
      @click=${onClick}
      ?disabled=${disabled}
      aria-disabled=${blocked}
      class="group relative block w-full ${heightClass} overflow-hidden rounded-2xl bg-surface text-left uppercase text-white transition-shadow duration-200 hover:shadow-[var(--shadow-lobby-card-hover)] ${state}"
    >
      <img
        src=${terrainMapFileLoader.getMapData(mapType).webpPath}
        alt=${mapName ?? mapType}
        draggable="false"
        class="pointer-events-none absolute inset-0 size-full select-none transition-transform duration-200 ${image}"
      />

      <div
        class="absolute inset-x-2 top-2 flex items-start justify-between gap-2"
      >
        <div class="flex min-w-0 flex-col items-start gap-1">
          ${modifiers.map((label) => html`<span class=${PILL}>${label}</span>`)}
        </div>
        <span
          class="${PILL} shrink-0 ${timeDisplayUppercase ? "" : "normal-case"}"
          >${timeDisplay}</span
        >
      </div>

      <div
        class="absolute inset-x-0 bottom-0 flex flex-col bg-black/55 px-3 py-2 backdrop-blur-sm ${trustedOnly
          ? "pr-10"
          : ""}"
      >
        <span
          class="${BADGE} absolute bottom-full right-2 mb-1 flex items-center gap-1 px-2 py-0.5 text-xs font-bold tracking-widest"
        >
          ${playerCount}
          <svg
            class="size-4"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z"
            />
          </svg>
        </span>
        ${trustedOnly ? trustLockIcon(viewerTrusted) : nothing}
        ${title
          ? html`<p
              class="text-sm font-bold leading-tight tracking-wider sm:text-base"
            >
              ${title}
            </p>`
          : nothing}
        <h3 class="text-xs tracking-wider text-white/70">${subtitleLine}</h3>
      </div>
    </button>
  `;
}

/** Bottom-right lock: red and closed when the viewer can't join, green and open when they can. */
function trustLockIcon(viewerTrusted: boolean): TemplateResult {
  const label = translateText(
    viewerTrusted
      ? "public_lobby.trusted_unlocked"
      : "public_lobby.trusted_locked",
  );
  return html`<span
    class="${BADGE} absolute bottom-2 right-2 flex items-center px-1.5 py-1 ${viewerTrusted
      ? "text-green-400"
      : "text-red-400"}"
    title=${label}
    aria-label=${label}
    data-trust=${viewerTrusted ? "unlocked" : "locked"}
  >
    <svg
      class="size-4"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      ${viewerTrusted
        ? svg`<path
            d="M14.5 1A4.5 4.5 0 0 0 10 5.5V9H3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-1.5V5.5a3 3 0 1 1 6 0v2.75a.75.75 0 0 0 1.5 0V5.5A4.5 4.5 0 0 0 14.5 1Z"
          />`
        : svg`<path
            fill-rule="evenodd"
            d="M10 1a4.5 4.5 0 0 0-4.5 4.5V9H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-.5V5.5A4.5 4.5 0 0 0 10 1Zm3 8V5.5a3 3 0 1 0-6 0V9h6Z"
            clip-rule="evenodd"
          />`}
    </svg>
  </span>`;
}
