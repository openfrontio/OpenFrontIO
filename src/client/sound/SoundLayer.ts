import { UnitType } from "../../core/game/Game";
import { GameUpdateType } from "../../core/game/GameUpdates";
import { GameView, UnitView } from "../../core/game/GameView";
import { Layer } from "../graphics/layers/Layer";
import { SoundEffect, SoundManager } from "./SoundManager";

export class SoundLayer implements Layer {
  private seenNukes: Set<number> = new Set();

  constructor(
    private game: GameView,
    private soundManager: SoundManager,
  ) {}

  shouldTransform(): boolean {
    return false;
  }

  init(): void {}

  tick(): void {
    this.game
      .updatesSinceLastTick()
      ?.[GameUpdateType.Unit]?.map((unit) => this.game.unit(unit.id))
      ?.forEach((unitView) => {
        if (unitView === undefined) return;
        this.onUnitEvent(unitView);
      });
  }

  onUnitEvent(unit: UnitView) {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return;

    const isNuke =
      unit.type() === UnitType.AtomBomb ||
      unit.type() === UnitType.HydrogenBomb ||
      unit.type() === UnitType.MIRV;

    if (isNuke) {
      if (!this.seenNukes.has(unit.id())) {
        const owner = unit.owner();
        const targetTile = unit.targetTile();
        const targetPlayer = targetTile
          ? this.game.playerBySmallID(this.game.ownerID(targetTile))
          : undefined;

        if (owner === myPlayer || targetPlayer === myPlayer) {
          let soundEffect: SoundEffect | undefined;
          if (unit.type() === UnitType.AtomBomb) {
            soundEffect = SoundEffect.AtomLaunch;
          } else if (unit.type() === UnitType.HydrogenBomb) {
            soundEffect = SoundEffect.HydroLaunch;
          } else if (unit.type() === UnitType.MIRV) {
            soundEffect = SoundEffect.MirvLaunch;
          }

          if (soundEffect) {
            this.soundManager.playSoundEffect(soundEffect);
          }
        }
        this.seenNukes.add(unit.id());
      }
    }

    if (!unit.isActive() && unit.reachedTarget()) {
      const isNukeHit =
        unit.type() === UnitType.AtomBomb ||
        unit.type() === UnitType.HydrogenBomb ||
        unit.type() === UnitType.MIRVWarhead;

      if (isNukeHit) {
        const owner = unit.owner();
        const targetTile = unit.lastTile();
        const targetPlayer = this.game.playerBySmallID(
          this.game.ownerID(targetTile),
        );

        if (owner === myPlayer || targetPlayer === myPlayer) {
          let soundEffect: SoundEffect | undefined;
          if (unit.type() === UnitType.AtomBomb) {
            soundEffect = SoundEffect.AtomHit;
          } else if (unit.type() === UnitType.HydrogenBomb) {
            soundEffect = SoundEffect.HydroHit;
          } else if (unit.type() === UnitType.MIRVWarhead) {
            soundEffect = SoundEffect.MirvHit;
          }

          if (soundEffect) {
            this.soundManager.playSoundEffect(soundEffect);
          }
        }
      }
    }
  }

  renderLayer(context: CanvasRenderingContext2D): void {}
  redraw(): void {}
}
