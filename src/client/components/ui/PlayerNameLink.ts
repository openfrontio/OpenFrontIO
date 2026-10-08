import { html, TemplateResult } from "lit";
import "../PlayerName";

// Shared look for a clickable player name in a list row. No size class — every
// row that uses it sits at the ambient 16px.
const NAME_CLASS = "font-bold text-blue-300 truncate hover:underline";

/**
 * Raises the `view-profile` request from a list row. The row's owning modal
 * (account, clan, …) listens for it and opens the player profile modal, so the
 * profile's Back button can return to whichever surface asked for it.
 */
export function dispatchViewProfile(host: HTMLElement, publicId: string): void {
  host.dispatchEvent(
    new CustomEvent<{ publicId: string }>("view-profile", {
      detail: { publicId },
      bubbles: true,
      composed: true,
    }),
  );
}

/**
 * Player identity that opens their profile on click — `<player-name>` wired to
 * dispatchViewProfile from `host`.
 */
export function playerNameLink(
  host: HTMLElement,
  username: string | null | undefined,
  publicId: string,
): TemplateResult {
  return html`<player-name
    .username=${username}
    .publicId=${publicId}
    .nameClass=${NAME_CLASS}
    .onNameClick=${() => dispatchViewProfile(host, publicId)}
  ></player-name>`;
}
