## Description:

This PR resolves a housekeeping `TODO` in `NameLayer.ts` to remove the disabled shield icon logic. 

**Changes Included:**
- Removed the SVG image import for `shieldIcon` (`ShieldIconBlack.svg`).
- Deleted the `shieldIconImage` HTMLImageElement class property and removed its instantiation within the class constructor.
- Removed the disabled `if (false)` block that manually constructed the `.player-shield` DOM elements (img, text span).
- Stripped out the `renderPlayerInfo` render loop logic which attempted to locate the shield elements and apply sizing and text rendering.
- Removed the `density` calculation from the render loop entirely, which was formerly calculated per player as `troops() / numTilesOwned()` solely to display on the removed shield icon.

**Impact:**
- Streamlines the `NameLayer` construct logic.
- Avoids an unnecessary performance drag recalculating unit `density` for every player on the screen every render frame when it's not rendered.
- Cleans up the project tree and reduces minor payload/memory overhead visually and programmatically.

## Please complete the following:

- [x] I have added screenshots for all UI updates (N/A - the element was already disabled and invisible)
- [x] I process any text displayed to the user through translateText() and I've added it to the en.json file (N/A)
- [x] I have added relevant tests to the test directory (N/A - code removal only)
- [x] I confirm I have thoroughly tested these changes and take full responsibility for any bugs introduced

## Please put your Discord username so you can be contacted if a bug or regression is found:

Antigravity
