import type { JingleJamFeed } from "@openfront/shared/ApiSchemas";
import { getJingleJam } from "./Api";
import { isDesktopShell } from "./DesktopShell";
import { FeedPoller } from "./FeedPoller";
import { gamePortal } from "./GamePortal";

export const JINGLE_JAM_OFF: JingleJamFeed = {
  mode: "off",
  updatedAt: "1970-01-01T00:00:00.000Z",
  copy: "default",
  liveStreams: [],
  rewards: [],
};

// Shared by the homepage banner and the lobby tracker, so the lobby wait reuses the
// homepage's answer instead of fetching again. Stops in-game like the streams feed.
export const jingleJamFeed = new FeedPoller<JingleJamFeed>({
  name: "jingle-jam-feed",
  fetch: getJingleJam,
  empty: JINGLE_JAM_OFF,
});

// Off the open web the event isn't shown at all: portals don't allow outside links,
// and the Steam shell keeps to the same no-outside-promotions rule as the featured
// stream. Neither component subscribes there, so no request is made either.
export function jingleJamAllowedHere(): boolean {
  return !gamePortal.isOnGamePortal() && !isDesktopShell();
}

// Whole pounds, en-GB grouping: 1823250 -> "£18,233". Rounds to the nearest pound —
// the banner is a headline, not a receipt.
export function formatGbp(pence: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(Math.round(pence / 100));
}

// How full the match bar is, 0–100. A zero cap (no match this year) reads as empty
// rather than dividing by zero.
export function matchPercent(matchPence: number, capPence: number): number {
  if (capPence <= 0) return 0;
  return Math.min(100, Math.max(0, (matchPence / capPence) * 100));
}
