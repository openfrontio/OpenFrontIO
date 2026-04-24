import { UnitType } from "../../../core/game/Game";
import { GameView } from "../../../core/game/GameView";
import { Layer } from "./Layer";

const THREAT_TYPES = new Set<UnitType>([
  UnitType.AtomBomb,
  UnitType.HydrogenBomb,
  UnitType.MIRVWarhead,
  UnitType.Bomber,
]);

const COLOR_BY_TYPE: Partial<Record<UnitType, string>> = {
  [UnitType.Bomber]: "rgba(255,200,50,1)",
  [UnitType.AtomBomb]: "rgba(255,130,40,1)",
  [UnitType.HydrogenBomb]: "rgba(255,60,60,1)",
  [UnitType.MIRVWarhead]: "rgba(220,80,255,1)",
};

export class ThreatOverlayLayer implements Layer {
  private pulsePhase = 0;

  constructor(private readonly game: GameView) {}

  shouldTransform(): boolean {
    return true;
  }

  tick() {}

  renderLayer(context: CanvasRenderingContext2D) {
    const myPlayer = this.game.myPlayer();
    if (myPlayer === null) return;

    this.pulsePhase = (Date.now() % 1500) / 1500;
    const pulseScale = 1 + Math.sin(this.pulsePhase * Math.PI * 2) * 0.12;

    const offsetX = -this.game.width() / 2;
    const offsetY = -this.game.height() / 2;

    for (const unit of this.game.units(
      ...(Array.from(THREAT_TYPES) as UnitType[]),
    )) {
      if (!unit.isActive()) continue;
      if (unit.owner() === myPlayer) continue;
      if (myPlayer.isFriendly(unit.owner())) continue;

      const targetTile = unit.targetTile();
      if (targetTile === undefined) continue;

      const tileOwner = this.game.owner(targetTile);
      if (!tileOwner.isPlayer() || tileOwner !== myPlayer) continue;

      const radius = this.radiusForType(unit.type());
      if (radius <= 0) continue;

      const x = this.game.x(targetTile) + offsetX;
      const y = this.game.y(targetTile) + offsetY;
      const color = COLOR_BY_TYPE[unit.type()] ?? "rgba(255,80,80,1)";

      context.save();
      context.strokeStyle = color;
      context.fillStyle = color.replace(/,1\)$/, ",0.12)");
      context.lineWidth = 1.5;
      context.beginPath();
      context.arc(x, y, radius * pulseScale, 0, Math.PI * 2);
      context.fill();
      context.stroke();
      context.restore();
    }
  }

  private radiusForType(type: UnitType): number {
    const cfg = this.game.config();
    switch (type) {
      case UnitType.AtomBomb:
        return cfg.nukeMagnitudes(UnitType.AtomBomb).outer;
      case UnitType.HydrogenBomb:
        return cfg.nukeMagnitudes(UnitType.HydrogenBomb).outer;
      case UnitType.MIRVWarhead:
        return cfg.nukeMagnitudes(UnitType.MIRVWarhead).outer;
      case UnitType.Bomber:
        return cfg.bombMagnitude().outer;
      default:
        return 0;
    }
  }
}
