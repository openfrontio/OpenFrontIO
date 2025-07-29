import { LitElement, TemplateResult, html } from "lit";
import { property, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { PlayerProfile, Relation, UnitType } from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { GameView, PlayerView, UnitView } from "../../../core/game/GameView";
import { UserSettings } from "../../../core/game/UserSettings";
import { MouseMoveEvent } from "../../InputHandler";
import { renderNumber, renderTroops, translateText } from "../../Utils";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

interface StatDefinition {
  label: string;
  emoji: string;
  row: number;
}

const STAT_DEFINITIONS: StatDefinition[] = [
  { label: "Defending troops", emoji: "🛡️", row: 1 },
  { label: "Attacking troops", emoji: "⚔️", row: 1 },
  { label: "Gold", emoji: "💰", row: 1 },
  { label: "Ports", emoji: "⚓", row: 2 },
  { label: "Cities", emoji: "🏙️", row: 2 },
  { label: "Missile launchers", emoji: "🚀", row: 2 },
  { label: "SAMs", emoji: "🎯", row: 2 },
  { label: "Warships", emoji: "🚢", row: 2 },
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

export abstract class BasePlayerInfoOverlay
  extends LitElement
  implements Layer
{
  @property({ type: Object })
  public game!: GameView;

  @property({ type: Object })
  public eventBus!: EventBus;

  @property({ type: Object })
  public transform!: TransformHandler;

  @property({ type: Object })
  public userSettings!: UserSettings;

  @state()
  protected player: PlayerView | null = null;

  @state()
  protected playerProfile: PlayerProfile | null = null;

  @state()
  protected unit: UnitView | null = null;

  @state()
  protected isVisible = false;

  @state()
  protected lastUpdate = 0;

  protected _isActive = false;
  protected mouseMoveCallback: ((event: MouseMoveEvent) => void) | null = null;

  protected emojiMap = Object.fromEntries(
    STAT_DEFINITIONS.map(({ label, emoji }) => [label, emoji]),
  );

  protected rowMap = Object.fromEntries(
    STAT_DEFINITIONS.map(({ label, row }) => [label, row]),
  );

  init() {
    this.mouseMoveCallback = (e: MouseMoveEvent) => this.onMouseMove(e);
    this.eventBus.on(MouseMoveEvent, this.mouseMoveCallback);
    this.setupEventListeners();
    this._isActive = true;
  }

  destroy() {
    if (this.mouseMoveCallback) {
      this.eventBus.off(MouseMoveEvent, this.mouseMoveCallback);
      this.mouseMoveCallback = null;
    }
    this._isActive = false;
  }

  protected abstract setupEventListeners(): void;
  protected abstract onMouseMove(event: MouseMoveEvent): void;
  protected abstract shouldRender(): boolean;

  protected findNearestUnit(worldCoord: {
    x: number;
    y: number;
  }): UnitView | null {
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

  protected handlePlayerHover(owner: PlayerView) {
    this.player = owner;
    this.player.profile().then((p) => {
      this.playerProfile = p;
      this.requestUpdate();
    });
    this.isVisible = true;
  }

  protected handleUnitHover(unit: UnitView) {
    this.unit = unit;
    this.isVisible = true;
  }

  protected resetHoverState() {
    this.player = null;
    this.unit = null;
    this.isVisible = false;
  }

  protected updateHoverInfo(x: number, y: number) {
    this.resetHoverState();

    const worldCoord = this.transform.screenToWorldCoordinates(x, y);
    if (!this.game.isValidCoord(worldCoord.x, worldCoord.y)) {
      return;
    }

    const tile = this.game.ref(worldCoord.x, worldCoord.y);
    if (!tile) return;

    const owner = this.game.owner(tile);

    if (owner && owner.isPlayer()) {
      this.handlePlayerHover(owner as PlayerView);
    } else if (!this.game.isLand(tile)) {
      const nearestUnit = this.findNearestUnit(worldCoord);
      if (nearestUnit) {
        this.handleUnitHover(nearestUnit);
      }
    }

    this.requestUpdate();
  }

  protected getRelationClass(relation: Relation): string {
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

  protected getRelation(player: PlayerView): Relation {
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

  protected getShortDisplayName(player: PlayerView): string {
    const name = player.name();
    return name.length > OVERLAY_CONFIG.maxNameLength
      ? name.slice(0, OVERLAY_CONFIG.maxNameLength - 2) + "…"
      : name;
  }

  protected calculatePlayerStats(player: PlayerView): Array<[string, string]> {
    const attackingTroops = player
      .outgoingAttacks()
      .map((a) => a.troops)
      .reduce((a, b) => a + b, 0);

    return [
      ["Defending troops", renderTroops(player.troops())],
      ["Attacking troops", renderTroops(attackingTroops)],
      ["Gold", renderNumber(player.gold())],
      ["Ports", player.totalUnitLevels(UnitType.Port).toString()],
      ["Cities", player.totalUnitLevels(UnitType.City).toString()],
      [
        "Missile launchers",
        player.totalUnitLevels(UnitType.MissileSilo).toString(),
      ],
      ["SAMs", player.totalUnitLevels(UnitType.SAMLauncher).toString()],
      ["Warships", player.units(UnitType.Warship).length.toString()],
    ];
  }

  protected isStatValueEmpty(value: string): boolean {
    return ["0", "0.0", "0K"].includes(value);
  }

  protected formatStats(player: PlayerView): {
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

  protected renderUnitInfo(unit: UnitView): TemplateResult {
    const relation = this.getRelation(unit.owner());
    const relationClass = this.getRelationClass(relation);

    return html`
      <div class="p-2">
        <div class="font-bold mb-1 ${relationClass}">
          ${this.getShortDisplayName(unit.owner())}
        </div>
        <div class="mt-1">
          <div class="text-sm opacity-80">${unit.type()}</div>
          ${unit.hasHealth()
            ? html`
                <div class="text-sm opacity-80">
                  ${translateText("player_info_overlay.health")}:
                  ${unit.health()}
                </div>
              `
            : ""}
        </div>
      </div>
    `;
  }

  tick() {
    this.requestUpdate();
  }

  renderLayer(context: CanvasRenderingContext2D) {
    // Implementation for Layer interface - not needed for DOM-based overlays
  }

  shouldTransform(): boolean {
    return false;
  }

  createRenderRoot() {
    return this;
  }
}

export { OVERLAY_CONFIG, STAT_DEFINITIONS };
