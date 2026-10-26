// Small laptops, phones and Poki-sized frames. Same bounds as the `compact` variant
// in styles.css, where open pages fill the screen; homepage extras (the stream panels)
// stay off there to leave room for the game.
export function isCompactViewport(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(max-height: 800px), (max-width: 1023px)").matches
  );
}
