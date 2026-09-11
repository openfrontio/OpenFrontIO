import { EventBus } from "../../core/EventBus";
import { MessageType, UnitType } from "../../core/game/Game";
import { GameUpdateType } from "../../core/game/GameUpdates";
import { Controller } from "../Controller";
import { PlaySoundEffectEvent, SoundEffect } from "../sound/Sounds";
import { GameView, UnitView } from "../view";

// A MIRV rains hundreds of warheads over a few seconds; playing a boom per
// warhead churns the audio pipeline. Play at most one warhead boom per interval.
const MIRV_HIT_SOUND_INTERVAL_TICKS = 5;

// Structures a train station can be attached to (see TrainStationExecution).
const STATION_CAPABLE_TYPES = new Set<UnitType>([
  UnitType.City,
  UnitType.Factory,
  UnitType.Port,
]);

const NUKE_INBOUND_MESSAGES = new Set<MessageType>([
  MessageType.NUKE_INBOUND,
  MessageType.HYDROGEN_BOMB_INBOUND,
  MessageType.MIRV_INBOUND,
]);

export class SoundEffectController implements Controller {
  private lastMirvHitSoundTick = -Infinity;
  private spawnSoundPlayed = false;
  // A train station is a flag on an existing structure, not a unit — play the
  // build sound on the false→true edge only, so structures that already have
  // one when first seen (e.g. joining mid-game) stay silent.
  private hadTrainStation = new Map<number, boolean>();

  constructor(
    private readonly game: GameView,
    private readonly eventBus: EventBus,
  ) {}

  tick(): void {
    const updates = this.game.updatesSinceLastTick();
    if (!updates) return;

    for (const u of updates[GameUpdateType.Unit] ?? []) {
      const unit = this.game.unit(u.id);
      if (unit === undefined) continue;
      this.handleUnit(unit);
    }

    if ((updates[GameUpdateType.SpawnPhaseEnd] ?? []).length > 0) {
      this.emit("game-start");
    }

    const myPlayer = this.game.myPlayer();
    if (myPlayer === null) return;
    for (const c of updates[GameUpdateType.ConquestEvent] ?? []) {
      if (c.conquerorId === myPlayer.id()) {
        this.emit("ka-ching");
      }
    }

    if (
      !this.spawnSoundPlayed &&
      this.game.inSpawnPhase() &&
      myPlayer.hasSpawned()
    ) {
      this.spawnSoundPlayed = true;
      this.emit("spawn");
    }

    for (const u of updates[GameUpdateType.UnitIncoming] ?? []) {
      if (u.playerID !== myPlayer.smallID()) continue;
      if (NUKE_INBOUND_MESSAGES.has(u.messageType)) {
        this.emit("nuke-warning");
      }
    }
  }

  private handleUnit(unit: UnitView): void {
    if (unit.isActive() && unit.createdAt() === this.game.ticks()) {
      this.onCreated(unit);
    }
    if (STATION_CAPABLE_TYPES.has(unit.type())) {
      this.handleTrainStation(unit);
    }
    switch (unit.type()) {
      case UnitType.AtomBomb:
        this.onNukeDetonation(unit, "atom-hit");
        break;
      case UnitType.MIRVWarhead:
        this.onMirvWarheadDetonation(unit);
        break;
      case UnitType.HydrogenBomb:
        this.onNukeDetonation(unit, "hydrogen-hit");
        break;
    }
  }

  private onMirvWarheadDetonation(unit: UnitView): void {
    if (unit.isActive()) return;
    if (!unit.reachedTarget()) return;
    const tick = this.game.ticks();
    if (tick - this.lastMirvHitSoundTick < MIRV_HIT_SOUND_INTERVAL_TICKS) {
      return;
    }
    this.lastMirvHitSoundTick = tick;
    this.emit("atom-hit");
  }

  private onCreated(unit: UnitView): void {
    const myPlayer = this.game.myPlayer();
    switch (unit.type()) {
      case UnitType.AtomBomb:
        this.emit("atom-launch");
        break;
      case UnitType.HydrogenBomb:
        this.emit("hydrogen-launch");
        break;
      case UnitType.MIRV:
        this.emit("mirv-launch");
        break;
      case UnitType.Warship:
        if (unit.owner() === myPlayer) this.emit("build-warship");
        break;
      case UnitType.City:
        if (unit.owner() === myPlayer) this.emit("build-city");
        break;
      case UnitType.Port:
        if (unit.owner() === myPlayer) this.emit("build-port");
        break;
      case UnitType.DefensePost:
        if (unit.owner() === myPlayer) this.emit("build-defense-post");
        break;
      case UnitType.SAMLauncher:
        if (unit.owner() === myPlayer) this.emit("sam-built");
        break;
      case UnitType.MissileSilo:
        if (unit.owner() === myPlayer) this.emit("silo-built");
        break;
      case UnitType.Factory:
        if (unit.owner() === myPlayer) this.emit("build-factory");
        break;
      case UnitType.TransportShip:
        if (unit.owner() === myPlayer) this.emit("transport-ship");
        break;
    }
  }

  private handleTrainStation(unit: UnitView): void {
    if (!unit.isActive()) {
      this.hadTrainStation.delete(unit.id());
      return;
    }
    const hasStation = unit.hasTrainStation();
    const prev = this.hadTrainStation.get(unit.id());
    if (prev === false && hasStation && unit.owner() === this.game.myPlayer()) {
      this.emit("build-train-station");
    }
    this.hadTrainStation.set(unit.id(), hasStation);
  }

  private onNukeDetonation(unit: UnitView, sound: SoundEffect): void {
    if (unit.isActive()) return;
    if (!unit.reachedTarget()) return;
    this.emit(sound);
  }

  private emit(sound: SoundEffect): void {
    this.eventBus.emit(new PlaySoundEffectEvent(sound));
  }
}
