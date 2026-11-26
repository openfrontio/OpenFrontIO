// Where the player edits their card: the Inventory's Player card tab. The
// Account header, the end screen's "Edit my card" and the old Account → My
// Card route (redirected in ModalRouter) all go here.

export const EDIT_CARD_HASH = "modal=inventory&tab=card";

/** From inside a game: a full path, so it also leaves the game. */
export const EDIT_CARD_HREF = `/#${EDIT_CARD_HASH}`;
