/**
 * Build a shareable profile URL for a publicId.
 *
 * Its own module so callers that only need the link — the nav profile menu's
 * copy action, say — don't pull in the whole profile modal.
 */
export function playerProfileUrl(publicId: string): string {
  return `${window.location.origin}${window.location.pathname}#modal=profile&publicID=${encodeURIComponent(publicId)}`;
}
