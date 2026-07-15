/**
 * AttackingTroopsController — pushes attack troop labels to the WebGL
 * WorldTextPass. Replaces the DOM-based AttackingTroopsOverlay.
 *
 * Per-tick (200ms) it polls the worker for clustered front-line positions of
 * each active attack involving the local player. Between polls it interpolates
 * smoothly from the previously-rendered position to the new target — the
 * worker poll cadence (200ms) and the animation duration (250ms) are matched
 * to what the old CSS transition did.
 */
import { EventBus } from "../../core/EventBus";
import { Cell, PlayerType } from "../../core/game/Game";
import { UserSettings } from "../../core/game/UserSettings";
import { Controller } from "../Controller";
import { AlternateViewEvent } from "../InputHandler";
import { MapRenderer } from "../render/gl";
import type { AttackTroopLabel } from "../render/gl/passes/WorldTextPass";
import { renderTroops } from "../Utils";
import { GameView } from "../view";

// Aquarius (#3fa9f5) for outgoing, red-400 (#f87171) for incoming.
const OUTGOING_R = 0x3f / 255;
const OUTGOING_G = 0xa9 / 255;
const OUTGOING_B = 0xf5 / 255;
const INCOMING_R = 0xf8 / 255;
const INCOMING_G = 0x71 / 255;
const INCOMING_B = 0x71 / 255;

/** Animation duration for cluster shifts — matches old CSS transition. */
const ANIM_MS = 250;
/** Snap (no animation) when the worker reports a jump larger than this. */
const SNAP_DISTANCE = 200;

export interface Slot {
  /** Last-rendered (interpolated) position. */
  curX: number;
  curY: number;
  /** Animation start position. */
  srcX: number;
  srcY: number;
  /** Animation target position. */
  dstX: number;
  dstY: number;
  /** Animation start time (performance.now). */
  startMs: number;
}

interface AttackEntry {
  text: string;
  isIncoming: boolean;
  slots: Slot[];
}

export function alignClusterOrder(next: Cell[], prev: Slot[]): void {
  if (next.length !== 2 || prev.length !== 2) return;
  const dist = (a: number, b: number, c: Cell) =>
    Math.abs(c.x - a) + Math.abs(c.y - b);
  const direct =
    dist(prev[0].dstX, prev[0].dstY, next[0]) +
    dist(prev[1].dstX, prev[1].dstY, next[1]);
  const swapped =
    dist(prev[0].dstX, prev[0].dstY, next[1]) +
    dist(prev[1].dstX, prev[1].dstY, next[0]);
  if (swapped < direct) [next[0], next[1]] = [next[1], next[0]];
}

export class AttackingTroopsController implements Controller {
  private attacks = new Map<string, AttackEntry>();
  private inFlightRequest = false;
  private alternateView = false;
  /** Reused buffer pushed to the view each frame. */
  private labelBuf: AttackTroopLabel[] = [];

  constructor(
    private readonly game: GameView,
    private readonly eventBus: EventBus,
    private readonly userSettings: UserSettings,
    private readonly view: MapRenderer,
  ) {}

  init() {
    this.eventBus.on(AlternateViewEvent, (e) => {
      this.alternateView = e.alternateView;
    });

    const drive = () => {
      this.pushLabels();
      requestAnimationFrame(drive);
    };
    requestAnimationFrame(drive);
  }

  getTickIntervalMs() {
    return 200;
  }

  tick() {
    if (!this.userSettings.attackingTroopsOverlay() || this.alternateView) {
      if (this.attacks.size > 0) this.attacks.clear();
      return;
    }

    const myPlayer = this.game.myPlayer();
    if (!myPlayer) {
      this.attacks.clear();
      return;
    }

    const activeIDs = new Set<string>();

    // Outgoing: only label attacks targeting another player.
    for (const attack of myPlayer.outgoingAttacks()) {
      if (!attack.targetID) continue;
      const defender = this.game.playerBySmallID(attack.targetID);
      if (!defender || !defender.isPlayer()) continue;
      activeIDs.add(attack.id);
      this.ensureEntry(attack.id, attack.troops, false);
    }

    // Incoming: only label attacks coming from another player; skip tribes.
    for (const attack of myPlayer.incomingAttacks()) {
      const attacker = this.game.playerBySmallID(attack.attackerID);
      if (
        !attacker ||
        !attacker.isPlayer() ||
        attacker.type() === PlayerType.Bot
      ) {
        continue;
      }
      activeIDs.add(attack.id);
      this.ensureEntry(attack.id, attack.troops, true);
    }

    for (const id of this.attacks.keys()) {
      if (!activeIDs.has(id)) this.attacks.delete(id);
    }

    // Single worker request per tick; skip if the previous one is still in flight.
    if (this.inFlightRequest) return;
    this.inFlightRequest = true;

    void myPlayer
      .attackClusteredPositions()
      .then((attacks) => {
        const now = performance.now();
        for (const { id, positions } of attacks) {
          const entry = this.attacks.get(id);
          if (!entry) continue;
          this.reconcileSlots(entry, positions, now);
        }
      })
      .catch(() => {
        // On error, hide all labels until the next successful response.
        this.attacks.clear();
      })
      .finally(() => {
        this.inFlightRequest = false;
      });
  }

  private ensureEntry(attackID: string, troops: number, isIncoming: boolean) {
    const text = renderTroops(troops);
    const existing = this.attacks.get(attackID);
    if (existing) {
      existing.text = text;
      existing.isIncoming = isIncoming;
      return;
    }
    this.attacks.set(attackID, { text, isIncoming, slots: [] });
  }

  private reconcileSlots(
    entry: AttackEntry,
    positions: Cell[],
    now: number,
  ): void {
    alignClusterOrder(positions, entry.slots);

    // Trim extra slots.
    if (entry.slots.length > positions.length) {
      entry.slots.length = positions.length;
    }

    for (let i = 0; i < positions.length; i++) {
      const next = positions[i];
      const slot = entry.slots[i];
      if (!slot) {
        // New slot — snap to position (no animation).
        entry.slots.push({
          curX: next.x,
          curY: next.y,
          srcX: next.x,
          srcY: next.y,
          dstX: next.x,
          dstY: next.y,
          startMs: now,
        });
        continue;
      }
      // Compute the current (interpolated) position so animations chain from
      // wherever the label is right now, not from the previous target.
      const t = Math.min(1, (now - slot.startMs) / ANIM_MS);
      const curX = slot.srcX + (slot.dstX - slot.srcX) * t;
      const curY = slot.srcY + (slot.dstY - slot.srcY) * t;

      const jump = Math.hypot(next.x - curX, next.y - curY);
      if (jump > SNAP_DISTANCE) {
        slot.curX = next.x;
        slot.curY = next.y;
        slot.srcX = next.x;
        slot.srcY = next.y;
        slot.dstX = next.x;
        slot.dstY = next.y;
        slot.startMs = now;
      } else {
        slot.srcX = curX;
        slot.srcY = curY;
        slot.curX = curX;
        slot.curY = curY;
        slot.dstX = next.x;
        slot.dstY = next.y;
        slot.startMs = now;
      }
    }
  }

  private pushLabels(): void {
    if (this.alternateView || this.attacks.size === 0) {
      if (this.labelBuf.length > 0) {
        this.labelBuf = [];
        this.view.setAttackTroopLabels(this.labelBuf);
      }
      return;
    }

    const now = performance.now();
    const out: AttackTroopLabel[] = [];

    for (const entry of this.attacks.values()) {
      const r = entry.isIncoming ? INCOMING_R : OUTGOING_R;
      const g = entry.isIncoming ? INCOMING_G : OUTGOING_G;
      const b = entry.isIncoming ? INCOMING_B : OUTGOING_B;
      for (const slot of entry.slots) {
        const t = Math.min(1, (now - slot.startMs) / ANIM_MS);
        slot.curX = slot.srcX + (slot.dstX - slot.srcX) * t;
        slot.curY = slot.srcY + (slot.dstY - slot.srcY) * t;
        out.push({
          x: slot.curX,
          y: slot.curY,
          text: entry.text,
          colorR: r,
          colorG: g,
          colorB: b,
        });
      }
    }

    this.labelBuf = out;
    this.view.setAttackTroopLabels(out);
  }
}
