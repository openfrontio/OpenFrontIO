import { LitElement, TemplateResult, html } from "lit";
import { ref } from "lit-html/directives/ref.js";
import { customElement, property, state } from "lit/decorators.js";
import allianceIcon from "../../../../resources/images/AllianceIcon.svg";
import warshipIcon from "../../../../resources/images/BattleshipIconWhite.svg";
import cityIcon from "../../../../resources/images/CityIconWhite.svg";
import factoryIcon from "../../../../resources/images/FactoryIconWhite.svg";
import goldCoinIcon from "../../../../resources/images/GoldCoinIcon.svg";
import missileSiloIcon from "../../../../resources/images/MissileSiloIconWhite.svg";
import portIcon from "../../../../resources/images/PortIcon.svg";
import samLauncherIcon from "../../../../resources/images/SamLauncherIconWhite.svg";
import { renderPlayerFlag } from "../../../core/CustomFlag";
import { EventBus } from "../../../core/EventBus";
import {
  PlayerProfile,
  PlayerType,
  Relation,
  Unit,
  UnitType,
} from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { AllianceView } from "../../../core/game/GameUpdates";
import { GameView, PlayerView, UnitView } from "../../../core/game/GameView";
import { ContextMenuEvent, MouseMoveEvent } from "../../InputHandler";
import {
  renderDuration,
  renderNumber,
  renderTroops,
  translateText,
} from "../../Utils";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";
import { CloseRadialMenuEvent } from "./RadialMenu";

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
  return (a: Unit | UnitView, b: Unit | UnitView) => {
    const distA = euclideanDistWorld(coord, a.tile(), game);
    const distB = euclideanDistWorld(coord, b.tile(), game);
    return distA - distB;
  };
}

@customElement("player-info-overlay")
export class PlayerInfoOverlay extends LitElement implements Layer {
  @property({ type: Object })
  public game!: GameView;

  @property({ type: Object })
  public eventBus!: EventBus;

  @property({ type: Object })
  public transform!: TransformHandler;

  @state()
  private player: PlayerView | null = null;

  @state()
  private playerProfile: PlayerProfile | null = null;

  @state()
  private unit: UnitView | null = null;

  @state()
  private _isInfoVisible: boolean = false;

  private _isActive = false;

  private lastMouseUpdate = 0;

  private showDetails = true;

  init() {
    this.eventBus.on(MouseMoveEvent, (e: MouseMoveEvent) =>
      this.onMouseEvent(e),
    );
    this.eventBus.on(ContextMenuEvent, (e: ContextMenuEvent) =>
      this.maybeShow(e.x, e.y),
    );
    this.eventBus.on(CloseRadialMenuEvent, () => this.hide());
    this._isActive = true;
  }

  private onMouseEvent(event: MouseMoveEvent) {
    const now = Date.now();
    if (now - this.lastMouseUpdate < 100) {
      return;
    }
    this.lastMouseUpdate = now;
    this.maybeShow(event.x, event.y);
  }

  public hide() {
    this.setVisible(false);
    this.unit = null;
    this.player = null;
  }

  public maybeShow(x: number, y: number) {
    this.hide();
    const worldCoord = this.transform.screenToWorldCoordinates(x, y);
    if (!this.game.isValidCoord(worldCoord.x, worldCoord.y)) {
      return;
    }

    const tile = this.game.ref(worldCoord.x, worldCoord.y);
    if (!tile) return;

    const owner = this.game.owner(tile);

    if (owner && owner.isPlayer()) {
      this.player = owner as PlayerView;
      this.player.profile().then((p) => {
        this.playerProfile = p;
      });
      this.setVisible(true);
    } else if (!this.game.isLand(tile)) {
      const units = this.game
        .units(UnitType.Warship, UnitType.TradeShip, UnitType.TransportShip)
        .filter((u) => euclideanDistWorld(worldCoord, u.tile(), this.game) < 50)
        .sort(distSortUnitWorld(worldCoord, this.game));

      if (units.length > 0) {
        this.unit = units[0];
        this.setVisible(true);
      }
    }
  }

  tick() {
    this.requestUpdate();
  }

  renderLayer(context: CanvasRenderingContext2D) {
    // Implementation for Layer interface
  }

  shouldTransform(): boolean {
    return false;
  }

  setVisible(visible: boolean) {
    this._isInfoVisible = visible;
    this.requestUpdate();
  }

  private getRelationClass(relation: Relation): string {
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

  private getRelationName(relation: Relation): string {
    switch (relation) {
      case Relation.Hostile:
        return translateText("relation.hostile");
      case Relation.Distrustful:
        return translateText("relation.distrustful");
      case Relation.Neutral:
        return translateText("relation.neutral");
      case Relation.Friendly:
        return translateText("relation.friendly");
      default:
        return translateText("relation.default");
    }
  }

  private displayUnitCount(
    player: PlayerView,
    type: UnitType,
    icon: string,
    description: string,
  ) {
    return !this.game.config().isUnitDisabled(type)
      ? html`<div
          class="flex p-1 w-[calc(50%-0.13rem)] border rounded-md border-gray-500
                         items-center gap-2 text-sm opacity-80"
          translate="no"
        >
          <img
            src=${icon}
            width="20"
            height="20"
            alt="${translateText(description)}"
            style="vertical-align: middle;"
          />
          <span class="w-full text-right p-1"
            >${player.totalUnitLevels(type)}</span
          >
        </div>`
      : "";
  }

  private allianceExpirationText(alliance: AllianceView) {
    const { expiresAt } = alliance;
    const remainingTicks = expiresAt - this.game.ticks();
    let remainingSeconds = 0;
    if (remainingTicks > 0) {
      remainingSeconds = Math.max(0, Math.floor(remainingTicks / 10)); // 10 ticks per second
    }
    return renderDuration(remainingSeconds);
  }

  private renderPlayerInfo(player: PlayerView) {
    const myPlayer = this.game.myPlayer();
    const isFriendly = myPlayer?.isFriendly(player);
    const isAllied = myPlayer?.isAlliedWith(player);
    let relationHtml: TemplateResult | null = null;
    const attackingTroops = player
      .outgoingAttacks()
      .map((a) => a.troops)
      .reduce((a, b) => a + b, 0);

    if (
      player.type() === PlayerType.FakeHuman &&
      myPlayer !== null &&
      !isAllied
    ) {
      const relation =
        this.playerProfile?.relations[myPlayer.smallID()] ?? Relation.Neutral;
      const relationClass = this.getRelationClass(relation);
      const relationName = this.getRelationName(relation);

      relationHtml = html`
        <span class="ml-auto mr-0 ${relationClass}">${relationName}</span>
      `;
    }

    if (isAllied) {
      const alliance = myPlayer
        ?.alliances()
        .find((alliance) => alliance.other === player.id());
      if (alliance !== undefined) {
        relationHtml = html` <span
          class="flex gap-2 ml-auto mr-0 text-sm font-bold"
        >
          <img
            src=${allianceIcon}
            alt=${translateText("player_info_overlay.alliance_timeout")}
            width="20"
            height="20"
            style="vertical-align: middle;"
          />
          ${this.allianceExpirationText(alliance)}
        </span>`;
      }
    }
    let playerType = "";
    switch (player.type()) {
      case PlayerType.Bot:
        playerType = translateText("player_type.bot");
        break;
      case PlayerType.FakeHuman:
        playerType = translateText("player_type.nation");
        break;
      case PlayerType.Human:
        playerType = translateText("player_type.player");
        break;
    }

    return html`
      <div class="p-2">
        <button
          class="items-center text-bold text-sm lg:text-lg font-bold mb-1 inline-flex break-all ${isFriendly
            ? "text-green-500"
            : "text-white"}"
          @click=${() => {
            this.showDetails = !this.showDetails;
            this.requestUpdate?.();
          }}
        >
          ${player.cosmetics.flag
            ? player.cosmetics.flag!.startsWith("!")
              ? html`<div
                  class="h-8 mr-1 aspect-[3/4] player-flag"
                  ${ref((el) => {
                    if (el instanceof HTMLElement) {
                      requestAnimationFrame(() => {
                        renderPlayerFlag(player.cosmetics.flag!, el);
                      });
                    }
                  })}
                ></div>`
              : html`<img
                  class="h-8 mr-1 aspect-[3/4]"
                  src=${"/flags/" + player.cosmetics.flag! + ".svg"}
                />`
            : html``}
          ${player.name()}
        </button>

        <!-- Collapsible section -->
        ${this.showDetails
          ? html`
              ${player.team() !== null
                ? html`<div class="text-sm opacity-80">
                    ${translateText("player_info_overlay.team")}:
                    ${player.team()}
                  </div>`
                : ""}
              <div class="flex text-sm">${playerType} ${relationHtml}</div>
              ${player.troops() >= 1
                ? html`<div
                    class="flex gap-2 text-sm opacity-80"
                    translate="no"
                  >
                    ${translateText("player_info_overlay.troops")}
                    <span class="ml-auto mr-0 font-bold">
                      ${renderTroops(player.troops())}
                    </span>
                  </div>`
                : ""}
              ${attackingTroops >= 1
                ? html`<div
                    class="flex gap-2 text-sm opacity-80"
                    translate="no"
                  >
                    ${translateText("player_info_overlay.a_troops")}
                    <span class="ml-auto mr-0 text-red-400 font-bold">
                      ${renderTroops(attackingTroops)}
                    </span>
                  </div>`
                : ""}
              <div
                class="flex p-1 mb-1 mt-1 w-full border rounded-md border-yellow-400
                          font-bold text-yellow-400 text-sm opacity-80"
                translate="no"
              >
                <img
                  src=${goldCoinIcon}
                  alt=${translateText("player_info_overlay.gold")}
                  width="15"
                  height="15"
                  style="vertical-align: middle;"
                />
                <span class="w-full text-center"
                  >${renderNumber(player.gold())}</span
                >
              </div>
              <div class="flex flex-wrap max-w-3xl gap-1">
                ${this.displayUnitCount(
                  player,
                  UnitType.City,
                  cityIcon,
                  "player_info_overlay.cities",
                )}
                ${this.displayUnitCount(
                  player,
                  UnitType.Factory,
                  factoryIcon,
                  "player_info_overlay.factories",
                )}
                ${this.displayUnitCount(
                  player,
                  UnitType.Port,
                  portIcon,
                  "player_info_overlay.ports",
                )}
                ${this.displayUnitCount(
                  player,
                  UnitType.MissileSilo,
                  missileSiloIcon,
                  "player_info_overlay.missile_launchers",
                )}
                ${this.displayUnitCount(
                  player,
                  UnitType.SAMLauncher,
                  samLauncherIcon,
                  "player_info_overlay.sams",
                )}
                ${this.displayUnitCount(
                  player,
                  UnitType.Warship,
                  warshipIcon,
                  "player_info_overlay.warships",
                )}
              </div>
            `
          : ""}
      </div>
    `;
  }

  private renderUnitInfo(unit: UnitView) {
    const isAlly =
      (unit.owner() === this.game.myPlayer() ||
        this.game.myPlayer()?.isFriendly(unit.owner())) ??
      false;

    // Calculate trade ship gold if applicable
    let tradeShipGold: bigint | null = null;
    if (unit.type() === UnitType.TradeShip) {
      tradeShipGold = this.calculateTradeShipGold(unit);
    }

    return html`
      <div class="p-2">
        <div class="font-bold mb-1 ${isAlly ? "text-green-500" : "text-white"}">
          ${unit.owner().name()}
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
          ${unit.type() === UnitType.TradeShip && tradeShipGold !== null
            ? html`
                <div class="flex gap-2 text-sm opacity-80 mt-1" translate="no">
                  <img
                    src=${goldCoinIcon}
                    alt=${translateText("player_info_overlay.gold")}
                    width="15"
                    height="15"
                    style="vertical-align: middle;"
                  />
                  <span class="text-yellow-400 font-bold">
                    ${renderNumber(tradeShipGold)}
                  </span>
                  <span class="text-xs opacity-60 ml-auto">(estimate)</span>
                </div>
              `
            : ""}
          ${unit.type() === UnitType.TransportShip && unit.troops() > 0
            ? html`
                <div class="flex gap-2 text-sm opacity-80 mt-1" translate="no">
                  ${translateText("player_info_overlay.troops")}:
                  <span class="ml-auto mr-0 font-bold">
                    ${renderTroops(unit.troops())}
                  </span>
                </div>
              `
            : ""}
        </div>
      </div>
    `;
  }

  private calculateTradeShipGold(unit: UnitView): bigint | null {
    const targetUnitId = unit.targetUnitId();
    if (!targetUnitId) {
      return null;
    }

    const dstPort = this.game.unit(targetUnitId);
    if (!dstPort || dstPort.type() !== UnitType.Port) {
      return null;
    }

    // Find source port - closest port owned by the ship's owner
    const owner = unit.owner();
    const ports = owner.units(UnitType.Port);
    if (ports.length === 0) {
      return null;
    }

    // Find closest port to destination (likely the source)
    let srcPort = ports[0];
    let minDist = this.game.manhattanDist(srcPort.tile(), dstPort.tile());
    for (const port of ports) {
      const dist = this.game.manhattanDist(port.tile(), dstPort.tile());
      if (dist < minDist) {
        minDist = dist;
        srcPort = port;
      }
    }

    // Use manhattan distance as estimate (pathfinding is too expensive)
    const distance = this.game.manhattanDist(srcPort.tile(), dstPort.tile());
    const numPorts = owner.totalUnitLevels(UnitType.Port);

    return this.game.config().tradeShipGold(distance, numPorts);
  }

  render() {
    if (!this._isActive) {
      return html``;
    }

    const containerClasses = this._isInfoVisible
      ? "opacity-100 visible"
      : "opacity-0 invisible pointer-events-none";

    return html`
      <div
        class="block lg:flex fixed top-[150px] right-0 w-full z-50 flex-col max-w-[180px]"
        @contextmenu=${(e: MouseEvent) => e.preventDefault()}
      >
        <div
          class="bg-gray-800/70 backdrop-blur-sm shadow-xs rounded-lg shadow-lg transition-all duration-300  text-white text-lg md:text-base ${containerClasses}"
        >
          ${this.player !== null ? this.renderPlayerInfo(this.player) : ""}
          ${this.unit !== null ? this.renderUnitInfo(this.unit) : ""}
        </div>
      </div>
    `;
  }

  createRenderRoot() {
    return this; // Disable shadow DOM to allow Tailwind styles
  }
}
