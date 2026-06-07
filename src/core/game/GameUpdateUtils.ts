import type { PlayerState } from "../../client/render/types";
import type { EmojiMessage } from "./Game";
import {
  AllianceView,
  AttackUpdate,
  GameUpdateType,
  PlayerUpdate,
} from "./GameUpdates";

/**
 * Build a partial PlayerUpdate containing only fields whose value differs
 * between `prev` and `next`. Returns null if nothing changed.
 *
 * `type` and `id` are always included on the returned diff. Array/object
 * fields are compared by structural equality (length + per-element);
 * `embargoes` is compared as a set; primitive fields by `===`.
 *
 * WARNING: this diff is field-by-field by design (no JSON.stringify, for
 * perf — see tests/perf/DiffPlayerUpdatePerf.ts). When you add a field to
 * PlayerUpdate, you MUST add a matching setIfDifferent(...) line here, and an
 * apply line in applyStateUpdate below. A field missing here is never diffed,
 * so its changes silently never reach the main thread after the first update.
 */
export function diffPlayerUpdate(
  prev: PlayerUpdate,
  next: PlayerUpdate,
): PlayerUpdate | null {
  const diff: PlayerUpdate = { type: GameUpdateType.Player, id: next.id };
  let changed = false;

  const setIfDifferent = <K extends keyof PlayerUpdate>(
    key: K,
    equal: boolean,
  ) => {
    if (!equal) {
      (diff[key] as PlayerUpdate[K]) = next[key] as PlayerUpdate[K];
      changed = true;
    }
  };

  setIfDifferent("clientID", prev.clientID === next.clientID);
  setIfDifferent("name", prev.name === next.name);
  setIfDifferent("displayName", prev.displayName === next.displayName);
  setIfDifferent("team", prev.team === next.team);
  setIfDifferent("smallID", prev.smallID === next.smallID);
  setIfDifferent("playerType", prev.playerType === next.playerType);
  setIfDifferent("isAlive", prev.isAlive === next.isAlive);
  setIfDifferent("isDisconnected", prev.isDisconnected === next.isDisconnected);
  setIfDifferent("tilesOwned", prev.tilesOwned === next.tilesOwned);
  setIfDifferent("gold", prev.gold === next.gold);
  setIfDifferent("troops", prev.troops === next.troops);
  setIfDifferent("isTraitor", prev.isTraitor === next.isTraitor);
  setIfDifferent(
    "traitorRemainingTicks",
    prev.traitorRemainingTicks === next.traitorRemainingTicks,
  );
  setIfDifferent("hasSpawned", prev.hasSpawned === next.hasSpawned);
  setIfDifferent("spawnTile", prev.spawnTile === next.spawnTile);
  setIfDifferent("betrayals", prev.betrayals === next.betrayals);
  setIfDifferent(
    "lastDeleteUnitTick",
    prev.lastDeleteUnitTick === next.lastDeleteUnitTick,
  );
  setIfDifferent("isLobbyCreator", prev.isLobbyCreator === next.isLobbyCreator);
  setIfDifferent("allies", numberArrayEqual(prev.allies, next.allies));
  setIfDifferent("targets", numberArrayEqual(prev.targets, next.targets));
  setIfDifferent(
    "outgoingAllianceRequests",
    stringArrayEqual(
      prev.outgoingAllianceRequests,
      next.outgoingAllianceRequests,
    ),
  );
  setIfDifferent("embargoes", stringSetEqual(prev.embargoes, next.embargoes));
  setIfDifferent(
    "outgoingEmojis",
    emojiArrayEqual(prev.outgoingEmojis, next.outgoingEmojis),
  );
  setIfDifferent(
    "outgoingAttacks",
    attackArrayEqual(prev.outgoingAttacks, next.outgoingAttacks),
  );
  setIfDifferent(
    "incomingAttacks",
    attackArrayEqual(prev.incomingAttacks, next.incomingAttacks),
  );
  setIfDifferent(
    "alliances",
    allianceArrayEqual(prev.alliances, next.alliances),
  );

  return changed ? diff : null;
}

/**
 * Merge a partial PlayerUpdate into a long-lived PlayerState in place.
 *
 * Only fields present on `pu` are applied; `undefined` means "no change since
 * last emission". The first emission per player carries every field, so the
 * target state is fully populated after one merge of the initial update.
 */
export function applyStateUpdate(target: PlayerState, pu: PlayerUpdate): void {
  // smallID is identity — never changes for a given player.
  if (pu.isAlive !== undefined) target.isAlive = pu.isAlive;
  if (pu.isDisconnected !== undefined)
    target.isDisconnected = pu.isDisconnected;
  if (pu.tilesOwned !== undefined) target.tilesOwned = pu.tilesOwned;
  if (pu.gold !== undefined) target.gold = Number(pu.gold);
  if (pu.troops !== undefined) target.troops = pu.troops;
  if (pu.isTraitor !== undefined) target.isTraitor = pu.isTraitor;
  if (pu.traitorRemainingTicks !== undefined) {
    target.traitorRemainingTicks = Math.max(0, pu.traitorRemainingTicks);
  }
  if (pu.betrayals !== undefined) target.betrayals = pu.betrayals;
  if (pu.hasSpawned !== undefined) target.hasSpawned = pu.hasSpawned;
  if (pu.spawnTile !== undefined) target.spawnTile = pu.spawnTile;
  if (pu.lastDeleteUnitTick !== undefined) {
    target.lastDeleteUnitTick = pu.lastDeleteUnitTick;
  }
  // Slice() to detach from the wire object — accumulated state mustn't share
  // mutable arrays with per-tick update payloads.
  if (pu.allies !== undefined) target.allies = pu.allies.slice();
  if (pu.targets !== undefined) target.targets = pu.targets.slice();
  if (pu.outgoingAllianceRequests !== undefined) {
    target.outgoingAllianceRequests = pu.outgoingAllianceRequests.slice();
  }
  if (pu.outgoingAttacks !== undefined) {
    target.outgoingAttacks = pu.outgoingAttacks;
  }
  if (pu.incomingAttacks !== undefined) {
    target.incomingAttacks = pu.incomingAttacks;
  }
  if (pu.alliances !== undefined) target.alliances = pu.alliances;
  if (pu.outgoingEmojis !== undefined)
    target.outgoingEmojis = pu.outgoingEmojis;
}

function numberArrayEqual(a?: number[], b?: number[]): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function stringArrayEqual(a?: string[], b?: string[]): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function stringSetEqual(a?: Set<string>, b?: Set<string>): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

function attackArrayEqual(a?: AttackUpdate[], b?: AttackUpdate[]): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.attackerID !== y.attackerID ||
      x.targetID !== y.targetID ||
      x.troops !== y.troops ||
      x.id !== y.id ||
      x.retreating !== y.retreating
    ) {
      return false;
    }
  }
  return true;
}

function allianceArrayEqual(a?: AllianceView[], b?: AllianceView[]): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.id !== y.id ||
      x.other !== y.other ||
      x.createdAt !== y.createdAt ||
      x.expiresAt !== y.expiresAt ||
      x.hasExtensionRequest !== y.hasExtensionRequest
    ) {
      return false;
    }
  }
  return true;
}

function emojiArrayEqual(a?: EmojiMessage[], b?: EmojiMessage[]): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.message !== y.message ||
      x.senderID !== y.senderID ||
      x.recipientID !== y.recipientID ||
      x.createdAt !== y.createdAt
    ) {
      return false;
    }
  }
  return true;
}
