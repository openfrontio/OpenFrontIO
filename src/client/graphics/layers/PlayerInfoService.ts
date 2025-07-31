import { PlayerProfile, Relation, UnitType } from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { GameView, PlayerView, UnitView } from "../../../core/game/GameView";
import { renderNumber, renderTroops } from "../../Utils";
import { TransformHandler } from "../TransformHandler";

interface StatDefinition {
  code: string;
  emoji: string;
  row: number;
}

const STAT_DEFINITIONS: StatDefinition[] = [
  { code: "defending_troops", emoji: "🛡️", row: 1 },
  { code: "attacking_troops", emoji: "⚔️", row: 1 },
  { code: "gold", emoji: "💰", row: 1 },
  { code: "ports", emoji: "⚓", row: 2 },
  { code: "cities", emoji: "🏙️", row: 2 },
  { code: "missile_launchers", emoji: "🚀", row: 2 },
  { code: "sams", emoji: "🎯", row: 2 },
  { code: "warships", emoji: "🚢", row: 2 },
];

const OVERLAY_CONFIG = {
  updateThrottleMs: 100,
  mouseOffset: 28,
  margin: 10,
  defaultWidth: 200,
  defaultHeight: 100,
  maxNameLength: 20,
  unitDetectionRadius: 50,
} as const;

function euclideanDistWorld(
  coord: { x: number; y: number },
  tileRef: TileRef,
  game: GameView,
): number {
  const x = game.x(tileRef);
  const y = game.y(tileRef);
  const dx = coord.x - x;
  const dy = coord.y - y;
  return Math.sqrt(dx * dx + dy * dy);
}

function distSortUnitWorld(coord: { x: number; y: number }, game: GameView) {
  return (a: UnitView, b: UnitView) => {
    const distA = euclideanDistWorld(coord, a.tile(), game);
    const distB = euclideanDistWorld(coord, b.tile(), game);
    return distA - distB;
  };
}

export interface HoverInfo {
  player: PlayerView | null;
  playerProfile: PlayerProfile | null;
  unit: UnitView | null;
  mouseX: number;
  mouseY: number;
}

export class PlayerInfoService {
  private readonly game: GameView;
  private transform: TransformHandler;

  private readonly emojiMap = Object.fromEntries(
    STAT_DEFINITIONS.map(({ code, emoji }) => [code, emoji]),
  );

  private readonly rowMap = Object.fromEntries(
    STAT_DEFINITIONS.map(({ code, row }) => [code, row]),
  );

  constructor(game: GameView, transform: TransformHandler) {
    this.game = game;
    this.transform = transform;
  }

  findNearestUnit(worldCoord: { x: number; y: number }): UnitView | null {
    const units = this.game
      .units(UnitType.Warship, UnitType.TradeShip, UnitType.TransportShip)
      .filter(
        (u) =>
          euclideanDistWorld(worldCoord, u.tile(), this.game) <
          OVERLAY_CONFIG.unitDetectionRadius,
      )
      .sort(distSortUnitWorld(worldCoord, this.game));

    return units.length > 0 ? units[0] : null;
  }

  async getHoverInfo(x: number, y: number): Promise<HoverInfo> {
    const hoverInfo: HoverInfo = {
      player: null,
      playerProfile: null,
      unit: null,
      mouseX: x,
      mouseY: y,
    };

    const worldCoord = this.transform.screenToWorldCoordinates(x, y);
    if (!this.game.isValidCoord(worldCoord.x, worldCoord.y)) {
      return hoverInfo;
    }

    const tile = this.game.ref(worldCoord.x, worldCoord.y);
    if (!tile) return hoverInfo;

    const owner = this.game.owner(tile);

    if (owner && owner.isPlayer()) {
      hoverInfo.player = owner as PlayerView;
      hoverInfo.playerProfile = await hoverInfo.player.profile();
    } else if (!this.game.isLand(tile)) {
      const nearestUnit = this.findNearestUnit(worldCoord);
      if (nearestUnit) {
        hoverInfo.unit = nearestUnit;
      }
    }

    return hoverInfo;
  }

  getRelationClass(relation: Relation): string {
    switch (relation) {
      case Relation.Hostile:
        return "text-red-500";
      case Relation.Distrustful:
        return "text-red-300";
      case Relation.Neutral:
        return "text-white";
      case Relation.Friendly:
        return "text-green-500";
      default:
        return "text-white";
    }
  }

  getRelation(player: PlayerView): Relation {
    const myPlayer = this.game.myPlayer();

    if (myPlayer === null) {
      return Relation.Neutral;
    }

    if (player === myPlayer) {
      return Relation.Friendly;
    }

    if (myPlayer?.isFriendly(player)) {
      return Relation.Friendly;
    }

    return Relation.Neutral;
  }

  getShortDisplayName(player: PlayerView): string {
    const name = player.name();
    return name.length > OVERLAY_CONFIG.maxNameLength
      ? name.slice(0, OVERLAY_CONFIG.maxNameLength - 2) + "…"
      : name;
  }

  calculatePlayerStats(player: PlayerView): Array<[string, string]> {
    const attackingTroops = player
      .outgoingAttacks()
      .map((a) => a.troops)
      .reduce((a, b) => a + b, 0);

    return [
      ["defending_troops", renderTroops(player.troops())],
      ["attacking_troops", renderTroops(attackingTroops)],
      ["gold", renderNumber(player.gold())],
      ["ports", player.totalUnitLevels(UnitType.Port).toString()],
      ["cities", player.totalUnitLevels(UnitType.City).toString()],
      [
        "missile_launchers",
        player.totalUnitLevels(UnitType.MissileSilo).toString(),
      ],
      ["sams", player.totalUnitLevels(UnitType.SAMLauncher).toString()],
      ["warships", player.units(UnitType.Warship).length.toString()],
    ];
  }

  private isStatValueEmpty(value: string): boolean {
    return ["0", "0.0", "0K"].includes(value);
  }

  formatStats(player: PlayerView): {
    row1: string[];
    row2: string[];
  } {
    const row1: string[] = [];
    const row2: string[] = [];
    const stats = this.calculatePlayerStats(player);

    for (const [statLabel, rawValue] of stats) {
      if (!this.emojiMap[statLabel] || this.isStatValueEmpty(rawValue)) {
        continue;
      }

      const display = `${this.emojiMap[statLabel]} ${rawValue}`;
      if (this.rowMap[statLabel] === 1) {
        row1.push(display);
      } else {
        row2.push(display);
      }
    }

    return { row1, row2 };
  }
}

export { OVERLAY_CONFIG, STAT_DEFINITIONS };
