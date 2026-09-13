/**
 * Blocks the page-level pinch-to-zoom gesture on Safari / WebKit.
 *
 * iOS Safari has ignored the `user-scalable=no` viewport hint since iOS 10,
 * so setting it on the viewport meta tag is not enough to stop two-finger
 * pinch zoom. The only reliable way to prevent the page from zooming is to
 * listen for WebKit's non-standard `gesturestart`, `gesturechange` and
 * `gestureend` events and call `preventDefault()` on them.
 *
 * The game's own pinch-to-zoom on the map canvas is driven by pointer
 * events (see {@link ../InputHandler}), which are unaffected by blocking
 * these WebKit-only events. Browsers that do not fire `GestureEvent`
 * (Chrome, Firefox, every Android browser) treat the listeners as a no-op,
 * so it is safe to install them unconditionally.
 *
 * The listeners live for the document's lifetime; the browser releases them
 * when the page is torn down, so no disposer is needed.
 *
 * @param target - The EventTarget to attach the listeners to. Defaults to
 *   `document`, which is the scope Safari uses to decide whether to zoom
 *   the page.
 *
 * @see https://github.com/openfrontio/OpenFrontIO/issues/2330
 */
export function installSafariPinchZoomBlocker(
  target: EventTarget = document,
): void {
  const block = (e: Event) => {
    e.preventDefault();
  };

  const events = ["gesturestart", "gesturechange", "gestureend"] as const;
  for (const type of events) {
    target.addEventListener(type, block);
  }
}

/** Two taps this close together in time and space form a double-tap. */
const DOUBLE_TAP_WINDOW_MS = 350;
const DOUBLE_TAP_RADIUS_PX = 30;

const INTERACTIVE_TARGET_SELECTOR =
  "a[href], button, input, label, select, summary, textarea, [contenteditable], [role='button']";

function tapsInteractiveElement(e: Event): boolean {
  return e
    .composedPath()
    .some(
      (el) => el instanceof Element && el.matches(INTERACTIVE_TARGET_SELECTOR),
    );
}

/**
 * Blocks the page-level double-tap "smart zoom" gesture on Safari / WebKit.
 *
 * Like pinch zoom, double-tap zoom ignores `user-scalable=no` on iOS.
 * `touch-action: manipulation` (set on `html`/`body` in index.html) is the
 * declarative fix, but WebKit still zooms in some cases when the double-tap
 * lands on HUD chrome, leaving the page stuck at a zoom level the game's own
 * controls cannot undo. As a fallback, cancel the `touchend` that completes
 * a double-tap — the event whose default action triggers the zoom.
 *
 * Cancelling `touchend` also suppresses the synthesized `click` for that
 * tap, so the guard skips taps on interactive elements: rapid taps on
 * buttons keep clicking, and WebKit does not smart-zoom clickable targets
 * anyway. Map input is unaffected either way — the canvas overlay sets
 * `touch-action: none` and is driven by pointer events (see
 * {@link ../InputHandler}), which still fire for cancelled touches.
 *
 * @param target - The EventTarget to attach the listener to. Defaults to
 *   `document`.
 *
 * @see https://github.com/openfrontio/OpenFrontIO/issues/4609
 */
export function installDoubleTapZoomBlocker(
  target: EventTarget = document,
): void {
  let lastTapTime = Number.NEGATIVE_INFINITY;
  let lastTapX = 0;
  let lastTapY = 0;

  target.addEventListener(
    "touchend",
    (e) => {
      const touch = (e as TouchEvent).changedTouches?.[0];
      const x = touch?.clientX ?? 0;
      const y = touch?.clientY ?? 0;
      const isDoubleTap =
        e.timeStamp - lastTapTime <= DOUBLE_TAP_WINDOW_MS &&
        Math.hypot(x - lastTapX, y - lastTapY) <= DOUBLE_TAP_RADIUS_PX;
      lastTapTime = e.timeStamp;
      lastTapX = x;
      lastTapY = y;
      if (isDoubleTap && e.cancelable && !tapsInteractiveElement(e)) {
        e.preventDefault();
      }
    },
    { passive: false },
  );
}

/**
 * Blocks the page-level pinch-to-zoom gesture in browsers that deliver it as
 * a ctrl+wheel event — i.e. everything that is not Safari.
 *
 * {@link installSafariPinchZoomBlocker} covers WebKit, which reports a pinch
 * through `GestureEvent`. Chrome and Firefox instead synthesize a `wheel`
 * event with `ctrlKey` set, and the only listener for that lives on the map
 * canvas (see {@link ../InputHandler}). HUD overlays are stacked above the
 * canvas rather than nested inside it, so a pinch over the leaderboard, the
 * build menu or any other panel never reaches that listener, nothing calls
 * `preventDefault()`, and the browser zooms the whole page instead of the
 * map.
 *
 * The listener is registered in the capture phase on purpose: HUD components
 * such as `PlayerPanel` and `EmojiTable` call `stopPropagation()` on `wheel`
 * to keep their own scrolling, which would stop a bubble-phase listener on
 * `document` from ever running.
 *
 * Only ctrl+wheel is cancelled. A plain wheel keeps scrolling the panels that
 * are `overflow-y-auto`, and the canvas listener still receives the event and
 * zooms the map, because cancelling the browser's default action does not
 * stop the event from propagating.
 *
 * The listener lives for the document's lifetime; the browser releases it
 * when the page is torn down, so no disposer is needed.
 *
 * @param target - The EventTarget to attach the listener to. Defaults to
 *   `document`.
 *
 * @see https://github.com/openfrontio/OpenFrontIO/issues/5098
 */
export function installCtrlWheelZoomBlocker(
  target: EventTarget = document,
): void {
  target.addEventListener(
    "wheel",
    (e) => {
      if ((e as WheelEvent).ctrlKey) {
        e.preventDefault();
      }
    },
    { capture: true, passive: false },
  );
}
