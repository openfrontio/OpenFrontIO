import type { PlayerState, PlayerStatusData, UnitState } from "../../types";
import { NUKE_TYPES, UT_MIRV_WARHEAD } from "../../types";

/** Unit types that indicate an active nuke is in flight. */
const NUKE_ACTIVE_TYPES: ReadonlySet<string> = new Set([
  ...NUKE_TYPES,
  UT_MIRV_WARHEAD,
]);

const OWNER_MASK = 0xfff;

export interface ComputePlayerStatusOptions {
  /**
   * Local player smallID for computing relative flags. Omit (or set to 0)
   * for replay mode — relative flags will all be false.
   */
  localPlayerID?: number;
  /**
   * Tile state buffer (the same Uint16Array exposed via FrameData.tileState).
   * Used to determine if a nuke's target tile is owned by the local player
   * for the `nukeTargetsMe` flag. If omitted, `nukeTargetsMe` stays false.
   */
  tileState?: Uint16Array;
}

/**
 * Compute per-player status flags for the name/status-icon pass.
 *
 * Without `opts.localPlayerID`: replay-path mode. Crown/traitor/disconnected/
 * nukeActive are populated; relative flags (alliance/target/embargo/
 * nukeTargetsMe) are all false.
 *
 * With `opts.localPlayerID`: live mode. Relative flags compare each player
 * against the local player's state to determine alliance/target/embargo;
 * if `opts.tileState` is also given, `nukeTargetsMe` is set for players
 * whose in-flight nuke is targeting one of the local player's tiles.
 *
 * `allianceReq` and `allianceFraction` are not computed yet — they need
 * additional context (the local player's PlayerID string for outgoing
 * requests, and the current tick for fraction). Left as `false`/`0` until
 * those use cases need them.
 */
export function computePlayerStatus(
  players: ReadonlyMap<number, PlayerState>,
  units: ReadonlyMap<number, UnitState>,
  opts: ComputePlayerStatusOptions = {},
): Map<number, PlayerStatusData> {
  const result = new Map<number, PlayerStatusData>();
  const localPlayerID = opts.localPlayerID ?? 0;
  const tileState = opts.tileState;
  const localPlayer =
    localPlayerID > 0 ? players.get(localPlayerID) : undefined;

  // Nuke owners: players who have an active nuke in flight.
  // Also collect which of those nukes target a tile owned by the local player.
  const nukeOwners = new Set<number>();
  const nukeAimedAtMe = new Set<number>();
  for (const u of units.values()) {
    if (!u.isActive || !NUKE_ACTIVE_TYPES.has(u.unitType)) continue;
    nukeOwners.add(u.ownerID);
    if (
      localPlayer !== undefined &&
      tileState !== undefined &&
      u.targetTile !== null
    ) {
      const tileOwner = tileState[u.targetTile] & OWNER_MASK;
      if (tileOwner === localPlayerID) {
        nukeAimedAtMe.add(u.ownerID);
      }
    }
  }

  // Crown: alive player with most tiles owned.
  let crownSmallID = -1;
  let maxTiles = 0;
  for (const ps of players.values()) {
    if (!ps.isAlive) continue;
    if (ps.tilesOwned > maxTiles) {
      maxTiles = ps.tilesOwned;
      crownSmallID = ps.smallID;
    }
  }

  // Relative-flag sets seeded from the local player's state. Looking them
  // up once outside the per-player loop is O(1) per player rather than O(n)
  // per .includes(); doesn't matter at small scale but keeps the loop tidy.
  const allySet = localPlayer ? new Set(localPlayer.allies) : null;
  const targetSet = localPlayer ? new Set(localPlayer.targets) : null;
  const myEmbargoes = localPlayer ? new Set(localPlayer.embargoes) : null;

  for (const ps of players.values()) {
    if (!ps.isAlive) continue;
    const sid = ps.smallID;
    const crown = sid === crownSmallID;
    const traitor = ps.isTraitor;
    const disconnected = ps.isDisconnected;
    const traitorRemainingTicks = ps.traitorRemainingTicks;
    const nukeActive = nukeOwners.has(sid);

    // Relative flags — only meaningful when there's a local player AND we're
    // not looking at the local player itself.
    let alliance = false;
    let target = false;
    let embargo = false;
    let nukeTargetsMe = false;
    if (localPlayer !== undefined && sid !== localPlayerID) {
      alliance = allySet!.has(sid);
      target = targetSet!.has(sid);
      // Embargo is bilateral: either side embargoes the other.
      embargo = myEmbargoes!.has(sid) || ps.embargoes.includes(localPlayerID);
      nukeTargetsMe = nukeAimedAtMe.has(sid);
    }

    if (
      crown ||
      traitor ||
      disconnected ||
      traitorRemainingTicks > 0 ||
      nukeActive ||
      alliance ||
      target ||
      embargo ||
      nukeTargetsMe
    ) {
      result.set(sid, {
        crown,
        traitor,
        disconnected,
        alliance,
        allianceReq: false,
        target,
        embargo,
        nukeActive,
        nukeTargetsMe,
        traitorRemainingTicks,
        allianceFraction: 0,
      });
    }
  }
  return result;
}
