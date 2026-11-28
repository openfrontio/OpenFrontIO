import { LiveStream, StreamsFeed } from "@openfront/shared/ApiSchemas";
import { getStreams } from "./Api";
import { FeedPoller } from "./FeedPoller";

// The streams feed behind both homepage streaming features (the featured panel and
// Streaming Now). The polling rules live in FeedPoller.

const MAX_AGE_MS = 10 * 60_000; // matches the API's snapshot TTL

const EMPTY_FEED: StreamsFeed = {
  verifiedAt: "1970-01-01T00:00:00.000Z",
  featured: [],
  live: [],
};

// A feed older than the snapshot TTL means the cron is dead and the edge is serving
// something stale — treat it as "nothing is live" rather than showing a corpse.
export function isFeedFresh(verifiedAt: string, now: number): boolean {
  const built = Date.parse(verifiedAt);
  return Number.isFinite(built) && now - built <= MAX_AGE_MS;
}

// Identity of one broadcast. `startedAt` is what makes a restart distinguishable from
// the same stream, so suppressing a dead broadcast cannot suppress a later genuine one.
export function broadcastKey(stream: LiveStream): string {
  return `${stream.platform}:${stream.channel}:${stream.startedAt}`;
}

// Where to send someone who clicks a stream: the explicit url if the API supplied one,
// otherwise derived from the platform. Lives here rather than in either panel so both use
// the same rule — a Twitch-only fallback would send YouTube viewers to the wrong site.
export function watchUrl(stream: LiveStream): string {
  if (stream.url) return stream.url;
  return stream.platform === "youtube"
    ? `https://www.youtube.com/${stream.channel}`
    : `https://www.twitch.tv/${stream.channel}`;
}

export const streamsFeed = new FeedPoller<StreamsFeed>({
  name: "streams-feed",
  fetch: getStreams,
  empty: EMPTY_FEED,
  // A feed older than the snapshot TTL means the cron is dead: show nothing.
  accept: (feed, now) =>
    isFeedFresh(feed.verifiedAt, now) ? feed : EMPTY_FEED,
});
