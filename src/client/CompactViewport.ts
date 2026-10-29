// Small laptops, phones and Poki-sized frames. Same bounds as the `compact` variant
// in styles.css, where open pages fill the screen; homepage extras (the stream panels)
// stay off there to leave room for the game.
const COMPACT_QUERY = "(max-height: 800px), (max-width: 1023px)";

// The live query, to follow changes (e.g. Poki's fullscreen toggle); null where
// matchMedia is missing, which counts as not compact.
export function compactViewportQuery(): MediaQueryList | null {
  return typeof window.matchMedia === "function"
    ? window.matchMedia(COMPACT_QUERY)
    : null;
}

export function isCompactViewport(): boolean {
  return compactViewportQuery()?.matches ?? false;
}
