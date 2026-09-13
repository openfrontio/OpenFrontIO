import { stripVersionPrefix } from "../core/ServerList";

// The `/v/<commit>/` prefix this document was LOADED under, captured once at
// boot (docs/MultiServer.md, "Server list v2").
//
// Being pinned is a property of the BUNDLE the page is running, not of what
// the address bar happens to say. Those two part company on the one flow
// that creates pinned pages: opening a game whose server runs an older
// build lands on `/v/<commit>/game/<id>`, and then the join rewrites the
// address bar to the deliberately version-free share URL
// (Main.updateJoinUrlForShare -> history.replaceState). Every guard that
// re-read `window.location.pathname` after that saw "not pinned" and took
// the ordinary update-and-reload branch, which lands on `latest`, which
// re-pins to the same older build: exactly the loop those guards exist to
// prevent, on exactly the flow that reaches them.
//
// Captured lazily so a module that merely imports this doesn't force a
// location read at import time (tests stub location per case), and reset
// explicitly at boot so the value is taken before the first history write.
let captured: string | null | undefined;

/**
 * The commit this page is pinned to, or null when it was loaded at a
 * version-free path. Stable for the life of the document.
 */
export function pagePin(): string | null {
  if (captured === undefined) {
    try {
      captured = stripVersionPrefix(window.location.pathname).commit;
    } catch {
      // No location to read (a non-browser host): not pinned, same as the
      // guards did when they read it inline.
      captured = null;
    }
  }
  return captured;
}

/**
 * Take the pin now. Called at the very top of `Client.initialize()`, ahead
 * of `handleUrl()` and of every `history.replaceState`/`pushState` the
 * client performs, so the captured value is the URL the document was
 * actually served at.
 */
export function capturePagePin(): void {
  captured = undefined;
  pagePin();
}

/** Drop the captured pin so a test can stub a different location. */
export function resetPagePinForTests(): void {
  captured = undefined;
}
