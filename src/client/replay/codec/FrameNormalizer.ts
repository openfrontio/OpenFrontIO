/**
 * FrameNormalizer turns the worker's per-tick GameUpdateViewData into the
 * full per-tick state the encoder writes.
 *
 * The worker's update stream is incremental. A PlayerUpdate has every
 * field on a player's first update and only the changed fields after
 * that. tilesOwned, gold, troops, goldEarned and attack troop counts come
 * on the separate packedPlayerUpdates / packedAttackUpdates channels, and
 * playerNameViewData only shows up on ticks where name placement is
 * rebuilt. This merges that stream with the same functions GameView uses
 * (applyStateUpdate, and the packed-channel, embargo and motion plan code
 * in src/client/view), so the replay holds exactly what a live client
 * would have shown. Unlike GameView it never changes a state it has handed
 * out: frames keep theirs.
 */

import type { PlayerID } from "../../../core/game/Game";
import { applyStateUpdate } from "../../../core/game/GameUpdateUtils";
import {
  GameUpdateType,
  type GameUpdateViewData,
  type PlayerUpdate,
  type UnitUpdate,
} from "../../../core/game/GameUpdates";
import {
  unpackMotionPlans,
  type MotionPlanRecord,
} from "../../../core/game/MotionPlans";
import type {
  NameEntry,
  PlayerState,
  PlayerStatic,
  UnitState,
} from "../../render/types";
import {
  applyPackedAttackTroops,
  applyPackedPlayerStats,
  embargoSmallIDs,
  playerStateFromUpdate,
  playerStaticFromUpdate,
  unitStateFromUpdate,
} from "../../view/EntityState";
import { MotionPlanResolver } from "../../view/MotionPlanResolver";
import type { MiscUpdates } from "./ReplayTypes";

/**
 * How each GameUpdateType gets into the replay:
 *   entity: folded into the per-tick player, unit and tile state
 *   events: collected into an event list (EventCollector)
 *   misc: stored as-is in the frame's misc updates, keyed by name
 *   dropped: not needed in a replay (sync hashes, local-player-only FX)
 *
 * Keyed by enum name, so a new GameUpdateType won't compile until someone
 * decides how replays handle it.
 */
export const UPDATE_TYPE_ROUTING: Record<
  keyof typeof GameUpdateType,
  "entity" | "events" | "misc" | "dropped"
> = {
  Tile: "entity",
  Unit: "entity",
  Player: "entity",
  DisplayEvent: "misc",
  DisplayChatEvent: "misc",
  AllianceRequest: "misc",
  AllianceRequestReply: "misc",
  BrokeAlliance: "misc",
  AllianceExpired: "misc",
  AllianceExtension: "misc",
  TargetPlayer: "misc",
  Emoji: "misc",
  Win: "misc",
  Hash: "dropped",
  UnitIncoming: "misc",
  BonusEvent: "misc",
  RailroadDestructionEvent: "events",
  RailroadConstructionEvent: "events",
  RailroadSnapEvent: "events",
  ConquestEvent: "dropped",
  EmbargoEvent: "misc",
  SpawnPhaseEnd: "events",
  GamePaused: "misc",
  DonateEvent: "misc",
};

/**
 * Where each GameUpdateViewData field is read:
 *   normalizer: FrameNormalizer.push
 *   events: EventCollector
 *   dropped: not needed in a replay (worker timing, turn backlog)
 *
 * Same idea as UPDATE_TYPE_ROUTING. State has moved out of `updates`
 * before (player stats, attack troops), and a codec that didn't notice
 * would record stale values. A new field won't compile until it's routed.
 */
export const VIEW_DATA_ROUTING: Record<
  keyof GameUpdateViewData,
  "normalizer" | "events" | "dropped"
> = {
  tick: "normalizer",
  updates: "normalizer",
  packedTileUpdates: "normalizer",
  packedMotionPlans: "normalizer",
  packedPlayerUpdates: "normalizer",
  packedAttackUpdates: "normalizer",
  playerNameViewData: "normalizer",
  packedNukeImpacts: "events",
  tickExecutionDuration: "dropped",
  pendingTurns: "dropped",
};

export interface NormalizedFrame {
  tick: number;
  source: GameUpdateViewData;
  /** `[tileRef, state]` pairs, as delivered by the worker. */
  tiles: Uint32Array;
  /**
   * Every known player's state after this tick. Snapshots are never
   * mutated, and a player that didn't change keeps last tick's object, so
   * `prev === curr` means unchanged.
   */
  players: ReadonlyMap<number, PlayerState>;
  /** Players seen for the first time this tick. */
  newPlayers: PlayerStatic[];
  /**
   * Units that changed this tick, from an update or by moving along a
   * motion plan. Includes units that went inactive this tick. Each unit
   * appears at most once.
   */
  units: UnitState[];
  /** The state before this tick of each unit in `units` that existed. */
  previousUnits: ReadonlyMap<number, UnitState>;
  /** Every active unit after this tick. Only valid until the next push. */
  activeUnits: ReadonlyMap<number, UnitState>;
  /** Motion plan records delivered this tick. */
  motionPlans: MotionPlanRecord[];
  /** Accumulated name placements (keyed by PlayerID). */
  names: ReadonlyMap<string, NameEntry>;
  /** True when any name placement changed (after rounding) this tick. */
  namesChanged: boolean;
  misc: MiscUpdates | null;
}

export class FrameNormalizer {
  /** Mutated in place, never handed out. */
  private live = new Map<number, PlayerState>();
  private snapshots = new Map<number, PlayerState>();
  private smallIDs = new Map<PlayerID, number>();
  private names = new Map<string, NameEntry>();
  /** Accumulated active units. */
  private units = new Map<number, UnitState>();
  private plans = new MotionPlanResolver();

  push(gu: GameUpdateViewData): NormalizedFrame {
    const touched = new Set<number>();
    const newPlayers: PlayerStatic[] = [];
    const playerUpdates = gu.updates[GameUpdateType.Player] as PlayerUpdate[];

    // Pass 1: create / diff-apply players.
    for (const pu of playerUpdates) {
      const smallID = this.smallIDs.get(pu.id);
      if (smallID === undefined) {
        const state = playerStateFromUpdate(pu);
        this.live.set(state.smallID, state);
        this.smallIDs.set(pu.id, state.smallID);
        const info = playerStaticFromUpdate(pu);
        // A nation's flag comes on its first update. Players' own
        // cosmetics are in the game start info.
        if (pu.nationFlag) info.flag = `/flags/${pu.nationFlag}.svg`;
        newPlayers.push(info);
        touched.add(state.smallID);
      } else {
        applyStateUpdate(this.live.get(smallID)!, pu);
        touched.add(smallID);
      }
    }

    // Pass 2: embargoes come as a Set<PlayerID> but the renderer wants
    // smallIDs. Done after pass 1 so players first seen this tick resolve.
    for (const pu of playerUpdates) {
      if (pu.embargoes === undefined) continue;
      this.live.get(this.smallIDs.get(pu.id)!)!.embargoes = embargoSmallIDs(
        pu.embargoes,
        (id) => this.smallIDs.get(id),
      );
    }

    // The packed stats and attack troop counts. Attack entries are copied
    // before they change, since an earlier snapshot may still point at them.
    const liveState = (smallID: number) => this.live.get(smallID);
    const touch = (smallID: number) => touched.add(smallID);
    applyPackedPlayerStats(gu.packedPlayerUpdates, liveState, touch);
    applyPackedAttackTroops(gu.packedAttackUpdates, liveState, {
      copy: true,
      applied: touch,
    });

    for (const smallID of touched) {
      this.snapshots.set(smallID, snapshotPlayer(this.live.get(smallID)!));
    }

    const motionPlans =
      gu.packedMotionPlans !== undefined
        ? unpackMotionPlans(gu.packedMotionPlans)
        : [];

    const previousUnits = new Map<number, UnitState>();
    return {
      tick: gu.tick,
      source: gu,
      tiles: gu.packedTileUpdates,
      players: this.snapshots,
      newPlayers,
      units: this.applyUnits(gu, motionPlans, previousUnits),
      previousUnits,
      activeUnits: this.units,
      motionPlans,
      names: this.names,
      namesChanged: this.applyNames(gu),
      misc: miscUpdatesOf(gu),
    };
  }

  /** Same order as GameView.update: plans, then unit updates, then advance. */
  private applyUnits(
    gu: GameUpdateViewData,
    motionPlans: MotionPlanRecord[],
    previous: Map<number, UnitState>,
  ): UnitState[] {
    this.plans.applyRecords(motionPlans);
    const changed = new Map<number, UnitState>();
    const touch = (id: number, state: UnitState) => {
      if (!changed.has(id)) {
        const before = this.units.get(id);
        if (before !== undefined) previous.set(id, before);
      }
      changed.set(id, state);
    };
    for (const u of gu.updates[GameUpdateType.Unit] as UnitUpdate[]) {
      const next = unitStateFromUpdate(u);
      // UnitImpl.toUpdate hands out its live missileTimerQueue array. The
      // client gets a structured clone, but in the processor the array
      // would keep changing under older states and hide the deltas.
      next.missileTimerQueue = next.missileTimerQueue.slice();
      const prev = this.units.get(u.id);
      if (prev !== undefined && this.plans.hasGridPlan(u.id)) {
        // The plan decides the position, the update's value lags behind.
        next.pos = prev.pos;
        next.lastPos = prev.lastPos;
      }
      touch(u.id, next);
      if (next.isActive) {
        this.units.set(u.id, next);
      } else {
        this.units.delete(u.id);
        this.plans.unitRemoved(u.id);
      }
    }
    // Moves replace the unit's state, so earlier frames keep theirs.
    const move = (id: number, state: UnitState) => {
      touch(id, state);
      this.units.set(id, state);
    };
    this.plans.advance(gu.tick, {
      tileOf: (id) => {
        const u = this.units.get(id);
        return u?.isActive ? u.pos : undefined;
      },
      move: (id, tile) => {
        const u = this.units.get(id)!;
        move(id, { ...u, lastPos: u.pos, pos: tile });
      },
      rest: (id) => {
        const u = this.units.get(id)!;
        if (u.lastPos !== u.pos) move(id, { ...u, lastPos: u.pos });
      },
    });
    return [...changed.values()];
  }

  private applyNames(gu: GameUpdateViewData): boolean {
    const data = gu.playerNameViewData;
    if (data === undefined) return false;
    let changed = false;
    for (const [playerID, nv] of Object.entries(data)) {
      const x = Math.round(nv.x);
      const y = Math.round(nv.y);
      const size = Math.round(nv.size);
      const prev = this.names.get(playerID);
      if (
        prev === undefined ||
        prev.x !== x ||
        prev.y !== y ||
        prev.size !== size
      ) {
        this.names.set(playerID, { playerID, x, y, size });
        changed = true;
      }
    }
    return changed;
  }
}

/**
 * A copy of a player's state. applyStateUpdate replaces arrays instead of
 * mutating them, and attack entries are copied before they change, so a
 * shallow copy is enough.
 */
function snapshotPlayer(s: PlayerState): PlayerState {
  return {
    ...s,
    outgoingAttacks: s.outgoingAttacks.slice(),
    incomingAttacks: s.incomingAttacks.slice(),
  };
}

function miscUpdatesOf(gu: GameUpdateViewData): MiscUpdates | null {
  let out: MiscUpdates | null = null;
  for (const [key, arr] of Object.entries(gu.updates)) {
    const name = GameUpdateType[Number(key)] as keyof typeof GameUpdateType;
    if (UPDATE_TYPE_ROUTING[name] !== "misc") continue;
    if (!Array.isArray(arr) || arr.length === 0) continue;
    out ??= {};
    out[name] = arr.map((u) => {
      const payload: Record<string, unknown> = { ...(u as object) };
      delete payload.type;
      return payload;
    });
  }
  return out;
}
