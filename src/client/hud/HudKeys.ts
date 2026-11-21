// The HUD control the Space now held went down on.
let spaceDownOn: EventTarget | null = null;

/** On a HUD control's keydown and keyup: Space and Enter press the control, so
 *  the game's own Space (alternate view) and Enter must not see them. A Space
 *  that went down elsewhere is the game's hold: its release ends the alternate
 *  view, so that one goes through. */
export function keepPressKeysFromGame(e: KeyboardEvent): void {
  const space = e.code === "Space" || e.key === " ";
  if (!space && e.key !== "Enter") return;
  const control = e.currentTarget;
  if (space && e.type === "keyup") {
    const ours = spaceDownOn !== null && spaceDownOn === control;
    spaceDownOn = null;
    if (!ours) return;
  } else if (space && !e.repeat) {
    spaceDownOn = control;
    // Focus that leaves before the release takes the release with it: a
    // Space that comes up here later went down somewhere else.
    control?.addEventListener(
      "focusout",
      () => {
        if (spaceDownOn === control) spaceDownOn = null;
      },
      { once: true },
    );
  }
  e.stopPropagation();
}

/** On mousedown: no focus left anywhere, so the next Space is the game's. */
export function pressWithoutFocus(e: MouseEvent): void {
  e.preventDefault();
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
}
