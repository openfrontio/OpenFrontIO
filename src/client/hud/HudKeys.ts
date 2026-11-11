/** On a HUD button's keydown and keyup: Space and Enter press the button, so
 *  the game's own Space (alternate view) and Enter must not see them. */
export function keepPressKeysFromGame(e: KeyboardEvent): void {
  if (e.code === "Space" || e.key === " " || e.key === "Enter") {
    e.stopPropagation();
  }
}
