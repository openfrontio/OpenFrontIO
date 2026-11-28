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

const STREAMS_MAX_AGE_MS = 15 * 60_000;
const TOTALS_MAX_AGE_MS = 60 * 60_000;

// `updatedAt` is when the API last read Tiltify, and the API deliberately keeps the
// last good total up through a Tiltify outage, so an old feed is downgraded, never
// turned off: after 15 minutes the live streams are dropped (who was live then may not
// be now), and after an hour a live total is dropped too, which leaves the static
// banner and Donate. An ended feed's total is final, so its age doesn't matter.
// A fetched feed plus when this client received it (client-only, not in the schema).
export type ReceivedJingleJamFeed = JingleJamFeed & { receivedAt?: number };

export function acceptJingleJam(
  feed: ReceivedJingleJamFeed,
  now: number,
): ReceivedJingleJamFeed {
  if (feed.mode !== "live" && feed.mode !== "static") return feed;
  // Measured on the server's clock when it says what that is: a player whose own
  // clock is hours out would otherwise lose a healthy total (fast clock) or keep a
  // stale one (slow clock). The time since it arrived is added on, so a feed held
  // while polling is paused (a long game) keeps ageing when it is re-checked.
  const reference = feed.servedAt
    ? Date.parse(feed.servedAt) + Math.max(0, now - (feed.receivedAt ?? now))
    : now;
  const age = reference - Date.parse(feed.updatedAt);
  let out = feed;
  if (age > STREAMS_MAX_AGE_MS) {
    out = { ...out, liveStreams: [], pinned: undefined };
  }
  if (out.mode === "live" && age > TOTALS_MAX_AGE_MS) {
    out = { ...out, mode: "static", totals: undefined };
  }
  return out;
}

// Shared by the homepage banner and the lobby tracker, so the lobby wait reuses the
// homepage's answer instead of fetching again. Stops in-game like the streams feed.
export const jingleJamFeed = new FeedPoller<ReceivedJingleJamFeed>({
  name: "jingle-jam-feed",
  fetch: async () => ({ ...(await getJingleJam()), receivedAt: Date.now() }),
  empty: JINGLE_JAM_OFF,
  accept: acceptJingleJam,
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
