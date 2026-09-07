// The two launch policies for the Steam subscription rail (infra OPE-230;
// lead decisions of 6 Sept 2026, pending Josh). One module so the panel and
// the store read the SAME switch and cannot disagree about what the player
// may do.

/**
 * S1: may a Steam subscriber change tier in-app? BLOCKED at launch. The only
 * mechanism Valve offers is a new billing agreement whose approval switches
 * the old one off — unmeasured, and on the money path — so the server
 * refuses it too (`STEAM_TIER_CHANGE_ENABLED` unset → 409). Mirrored here so
 * neither the panel's Change Tier button nor the store's tier card starts a
 * checkout whose only outcome is that refusal. Flip alongside the server
 * var, never on its own.
 */
export const STEAM_TIER_CHANGE_IN_APP = false;

/**
 * S2: does the panel offer Cancel on the Steam rail? HIDDEN. Steam has no
 * un-cancel and no pause, so an in-app Cancel would be a one-way door with
 * no Reactivate beside it; Manage opens the Steam account page, where
 * cancelling lives. The server accepts a cancel either way.
 */
export const STEAM_CANCEL_IN_APP = false;
