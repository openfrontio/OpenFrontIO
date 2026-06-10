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
