import { ClientEnv } from "../ClientEnv";

// The profile's tabs, as `?tab=` on a profile link names them.
export const PLAYER_PROFILE_TABS: readonly string[] = [
  "stats",
  "games",
  "clans",
  "progression",
];

// Public ids are short url-safe tokens (the API stores at most 22
// characters). Anything else in a profile path is not a link to a player.
const PUBLIC_ID = /^[A-Za-z0-9_-]{1,22}$/;

// `/player/<id>`, with an optional trailing slash, behind the optional
// prefixes any page path can carry: `/v/<commit>` (a version's own page) and
// `/w<n>` (a game server's worker).
const PROFILE_PATH = /^(?:\/v\/[^/]+)?(?:\/w\d+)?\/player\/([^/]+)\/?$/;

/**
 * Build a shareable profile URL for a publicId: `https://<site>/player/<id>`,
 * the canonical link the site unfurls into a profile card.
 *
 * Its own module so callers that only need the link — the nav profile menu's
 * copy action, say — don't pull in the whole profile modal.
 *
 * The origin comes from ClientEnv.shareOrigin(), not window.location, because
 * this link is copied to the clipboard to be sent to someone else: under the
 * desktop shell the document lives on `app://openfront/index.html`, which is
 * a URL only that Electron app can resolve (OPE bug: the Steam build copied
 * `app://openfront/index.html#modal=profile&publicID=…`).
 */
export function playerProfileUrl(publicId: string): string {
  return `${ClientEnv.shareOrigin()}/player/${encodeURIComponent(publicId)}`;
}

/** The publicId a profile path names, or null for any other path. */
export function parsePlayerProfilePath(pathname: string): string | null {
  const match = PROFILE_PATH.exec(pathname);
  if (match === null || !PUBLIC_ID.test(match[1])) return null;
  return match[1];
}

/**
 * The profile a page URL opens, as the profile modal's open() args: the
 * publicId from the path, and the tab from `?tab=` when it names one.
 */
export function playerProfileRouteArgs(location: {
  pathname: string;
  search: string;
}): { publicID: string; tab?: string } | null {
  const publicID = parsePlayerProfilePath(location.pathname);
  if (publicID === null) return null;
  const tab = new URLSearchParams(location.search).get("tab");
  return tab !== null && PLAYER_PROFILE_TABS.includes(tab)
    ? { publicID, tab }
    : { publicID };
}
