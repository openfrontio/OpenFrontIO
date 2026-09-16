import { ClientEnv } from "../ClientEnv";

/**
 * Build a shareable profile URL for a publicId.
 *
 * Its own module so callers that only need the link — the nav profile menu's
 * copy action, say — don't pull in the whole profile modal.
 *
 * The base comes from ClientEnv.shareBase(), not window.location, because this
 * link is copied to the clipboard to be sent to someone else: under the desktop
 * shell the document lives on `app://openfront/index.html`, which is a URL only
 * that Electron app can resolve (OPE bug: the Steam build copied
 * `app://openfront/index.html#modal=profile&publicID=…`).
 */
export function playerProfileUrl(publicId: string): string {
  return `${ClientEnv.shareBase()}#modal=profile&publicID=${encodeURIComponent(publicId)}`;
}
