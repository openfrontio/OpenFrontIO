/**
 * Decides which replay a "watch replay" click opens.
 *
 * The viewer, which can seek and plays the game while it's being processed
 * (LocalProcessing), is opt-in for now (the "new replay viewer" setting);
 * without it the classic client-side replay opens. A game from another build goes to
 * that build's versioned shell (#4934). The old client-side replay is the
 * fallback the viewer offers when it can't show a game.
 */

import type { GameRecord } from "@openfront/shared/WireSchemas";
import { ClientEnv } from "../ClientEnv";
import { UserSettings } from "../UserSettings";
import { currentPagePath } from "../Utils";
import { findVersionedShell, isReplayShellHost } from "../VersionedReplay";
import { handOverRecord } from "./ReplayRecord";

/**
 * The versioned shell URL for a game from another build, once a probe has
 * found it served. Null when there's no such shell, or when this page
 * already is one, since redirecting again would loop.
 */
export function versionedViewerUrl(gameID: string): Promise<string | null> {
  return findVersionedShell(
    ClientEnv.jwtAudience(),
    gameID,
    window.location.hostname,
  );
}

/**
 * Marks a game page the viewer sent back to the client-side replay.
 * Without it the "watch the old replay" button would open the game page,
 * and JoinLobbyModal would send it straight back to the viewer. It's in the
 * URL rather than in storage, which a tab may not have, so the fallback
 * can't loop. Opening the game from anywhere else tries the viewer again.
 */
const CLASSIC_PARAM = "classic-replay";

function onClassicReplayPage(): boolean {
  return new URLSearchParams(window.location.search).has(CLASSIC_PARAM);
}

/** Where the "watch the old replay" button goes (the game's page). */
export function classicReplayHref(gameID: string): string {
  // The /game/<id> shape only exists on the game-server origin. On a replay
  // shell the game's page is replay.<domain>/<gameId>.
  const page = isReplayShellHost(window.location.hostname)
    ? `/${encodeURIComponent(gameID)}`
    : currentPagePath(ClientEnv.gamePath(gameID));
  return `${page}?${CLASSIC_PARAM}`;
}

/** The page URL that opens the viewer for a game. */
export function replayViewerHref(gameID: string): string {
  return `${window.location.pathname}#replay-viewer=${encodeURIComponent(gameID)}`;
}

/**
 * Opens the viewer for a game this build can replay (the caller already
 * checked the build). Returns false if the player hasn't turned the viewer
 * on, or the viewer sent this game back, and the caller should use the
 * client-side replay.
 */
export function openReplayViewer(gameID: string, record: GameRecord): boolean {
  if (!new UserSettings().replayViewer()) return false;
  if (onClassicReplayPage()) return false;
  handOverRecord(gameID, record);
  const href = replayViewerHref(gameID);
  // Main opens the viewer on hashchange. Setting the same hash again
  // doesn't fire the event, so fire it ourselves.
  if (window.location.hash === new URL(href, window.location.href).hash) {
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else {
    window.location.assign(href);
  }
  return true;
}
