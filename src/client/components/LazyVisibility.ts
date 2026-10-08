// How far outside the visible area an element counts as "near". rootMargin
// only widens the viewport; modal grids scroll inside their own container,
// which clips targets before the viewport margin applies, so scrollMargin is
// what actually buys the prefetch there. Browsers without scrollMargin
// support just reveal things as they scroll in.
const NEAR_MARGIN = "400px";

type NearCallback = (near: boolean) => void;

const callbacks = new Map<Element, NearCallback>();
let observer: IntersectionObserver | null | undefined;

function sharedObserver(): IntersectionObserver | null {
  if (observer !== undefined) return observer;
  if (typeof IntersectionObserver === "undefined") {
    observer = null;
    return observer;
  }
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        callbacks.get(entry.target)?.(entry.isIntersecting);
      }
    },
    { rootMargin: NEAR_MARGIN, scrollMargin: NEAR_MARGIN },
  );
  return observer;
}

export function canObserveNear(): boolean {
  return sharedObserver() !== null;
}

/**
 * Reports whether `element` is within NEAR_MARGIN of being on screen, now
 * and on every change, until the returned function is called. Without
 * IntersectionObserver everything reports near at once, so content is never
 * withheld just because visibility can't be measured.
 */
export function observeNear(
  element: Element,
  callback: NearCallback,
): () => void {
  const io = sharedObserver();
  if (io === null) {
    callback(true);
    return () => {};
  }
  callbacks.set(element, callback);
  io.observe(element);
  return () => {
    if (callbacks.get(element) !== callback) return;
    callbacks.delete(element);
    io.unobserve(element);
  };
}
