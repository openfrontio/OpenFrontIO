import { EventBus } from "../../core/EventBus";
import { UnitType } from "../../core/game/Game";
import {
  ConquestUpdate,
  GameUpdateType,
  UnitUpdate,
} from "../../core/game/GameUpdates";
import { GameView } from "../../core/game/GameView";
import { Controller } from "../Controller";
import { PlaySoundEffectEvent, SoundUpdateEvent } from "../sound/Sounds";

export class SoundController implements Controller {
  constructor(
    private eventBus: EventBus,
    private view: GameView,
  ) {}

  init() {
    this.eventBus.on(SoundUpdateEvent, (e) => this.handleGameUpdate(e));
  }

  private handleGameUpdate(e: SoundUpdateEvent) {
    const gu = e.gu;
    if ((gu.pendingTurns ?? 0) > 1 || this.view.ticks() <= 0) return;

    const myPlayer = this.view.myPlayer();

    // 1. Process Conquests
    if (myPlayer) {
      gu.updates[GameUpdateType.ConquestEvent]?.forEach(
        (cu: ConquestUpdate) => {
          if (cu.conquerorId === myPlayer.id()) {
            this.eventBus.emit(new PlaySoundEffectEvent("ka-ching"));
          }
        },
      );
    }

    // 2. Process Units
    gu.updates[GameUpdateType.Unit]?.forEach((u: UnitUpdate) => {
      const existingUnit = this.view.unit(u.id);
      const isMine = myPlayer ? u.ownerID === myPlayer.smallID() : false;

      if (!existingUnit) {
        this.handleNewUnitSounds(u.unitType, isMine);
      } else if (existingUnit.isActive() && !u.isActive && u.reachedTarget) {
        this.handleImpactSounds(u.unitType);
      }
    });
  }

  private handleNewUnitSounds(unitType: UnitType, isMine: boolean) {
    switch (unitType) {
      case UnitType.AtomBomb:
        this.eventBus.emit(new PlaySoundEffectEvent("atom-launch"));
        break;
      case UnitType.HydrogenBomb:
        this.eventBus.emit(new PlaySoundEffectEvent("hydrogen-launch"));
        break;
      case UnitType.MIRV:
        this.eventBus.emit(new PlaySoundEffectEvent("mirv-launch"));
        break;
      case UnitType.Warship:
        if (isMine)
          this.eventBus.emit(new PlaySoundEffectEvent("build-warship"));
        break;
      case UnitType.City:
        if (isMine) this.eventBus.emit(new PlaySoundEffectEvent("build-city"));
        break;
      case UnitType.Port:
        if (isMine) this.eventBus.emit(new PlaySoundEffectEvent("build-port"));
        break;
      case UnitType.DefensePost:
        if (isMine)
          this.eventBus.emit(new PlaySoundEffectEvent("build-defense-post"));
        break;
      case UnitType.SAMLauncher:
        if (isMine) this.eventBus.emit(new PlaySoundEffectEvent("sam-built"));
        break;
      case UnitType.MissileSilo:
        if (isMine) this.eventBus.emit(new PlaySoundEffectEvent("silo-built"));
        break;
    }
  }

  private handleImpactSounds(unitType: UnitType) {
    if (unitType === UnitType.HydrogenBomb) {
      this.eventBus.emit(new PlaySoundEffectEvent("hydrogen-hit"));
    } else if (unitType === UnitType.AtomBomb || unitType === UnitType.MIRV) {
      this.eventBus.emit(new PlaySoundEffectEvent("atom-hit"));
    }
  }
}
