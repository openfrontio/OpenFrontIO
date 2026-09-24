/**
 * Decides which replay a "watch replay" click opens.
 *
 * The default is the viewer, which can seek and plays the game while it's
 * being processed (LocalProcessing). A game from another build goes to
 * that build's versioned shell (#4934). The old client-side replay is the
 * fallback the viewer offers when it can't show a game.
 */

import type { GameRecord } from "../../core/Schemas";
import { ClientEnv } from "../ClientEnv";
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
 * Games the viewer sent back to the client-side replay. Without this the
 * "watch the old replay" button would open the game page, and
 * JoinLobbyModal would send it straight back to the viewer. Kept per tab,
 * so the next visit tries the viewer again.
 */
const CLASSIC = "openfront.replay.classic";

function classicGames(): Set<string> {
  try {
    return new Set(
      JSON.parse(sessionStorage.getItem(CLASSIC) ?? "[]") as string[],
    );
  } catch {
    return new Set();
  }
}

/** Where the "watch the old replay" button goes (the game's page). */
export function classicReplayHref(gameID: string): string {
  const games = classicGames();
  games.add(gameID);
  try {
    sessionStorage.setItem(CLASSIC, JSON.stringify([...games]));
  } catch {
    // A tab without storage just gets routed back to the viewer.
  }
  // On a versioned shell the pathname is the game ID; /game/<id> 404s there.
  if (isReplayShellHost(window.location.hostname)) return `/${gameID}`;
  return currentPagePath(ClientEnv.gamePath(gameID));
}

/** The page URL that opens the viewer for a game. */
export function replayViewerHref(gameID: string): string {
  return `${window.location.pathname}#replay-viewer=${encodeURIComponent(gameID)}`;
}

/**
 * Opens the viewer for a game this build can replay (the caller already
 * checked the build). Returns false if the viewer sent this game back and
 * the caller should use the client-side replay.
 */
export function openReplayViewer(gameID: string, record: GameRecord): boolean {
  if (classicGames().has(gameID)) return false;
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
