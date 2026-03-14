import { LitElement, TemplateResult, html } from "lit";
import { ref } from "lit-html/directives/ref.js";
import { customElement, property, state } from "lit/decorators.js";
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
import {
  ContextMenuEvent,
  MouseMoveEvent,
  TouchEvent,
} from "../../InputHandler";
import {
  getTranslatedPlayerTeamLabel,
  renderDuration,
  renderNumber,
  renderTroops,
  translateText,
} from "../../Utils";
import { getFirstPlacePlayer, getPlayerIcons } from "../PlayerIcons";
import { TransformHandler } from "../TransformHandler";
import { UIState } from "../UIState";
import { ImmunityBarVisibleEvent } from "./ImmunityTimer";
import { Layer } from "./Layer";
import { CloseRadialMenuEvent } from "./RadialMenu";
import { SpawnBarVisibleEvent } from "./SpawnTimer";
import allianceIcon from "/images/AllianceIcon.svg?url";
import warshipIcon from "/images/BattleshipIconWhite.svg?url";
import cityIcon from "/images/CityIconWhite.svg?url";
import factoryIcon from "/images/FactoryIconWhite.svg?url";
import goldCoinIcon from "/images/GoldCoinIcon.svg?url";
import missileSiloIcon from "/images/MissileSiloIconWhite.svg?url";
import portIcon from "/images/PortIcon.svg?url";
import samLauncherIcon from "/images/SamLauncherIconWhite.svg?url";
import soldierIcon from "/images/SoldierIcon.svg?url";
import swordIcon from "/images/SwordIcon.svg?url";

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

  @property({ type: Object })
  public uiState!: UIState;

  @state()
  private player: PlayerView | null = null;

  @state()
  private playerProfile: PlayerProfile | null = null;

  @state()
  private unit: UnitView | null = null;

  @state()
  private _isInfoVisible: boolean = false;

  @state()
  private spawnBarVisible = false;
  @state()
  private immunityBarVisible = false;

  @state()
  private hoverScreenX = 0;

  @state()
  private hoverScreenY = 0;

  private _isActive = false;

  private get barOffset(): number {
    return (this.spawnBarVisible ? 7 : 0) + (this.immunityBarVisible ? 7 : 0);
  }

  private lastMouseUpdate = 0;

  init() {
    this.eventBus.on(MouseMoveEvent, (e: MouseMoveEvent) =>
      this.onMouseEvent(e),
    );
    this.eventBus.on(ContextMenuEvent, (e: ContextMenuEvent) =>
      this.maybeShow(e.x, e.y),
    );
    this.eventBus.on(TouchEvent, (e: TouchEvent) => this.maybeShow(e.x, e.y));
    this.eventBus.on(CloseRadialMenuEvent, () => this.hide());
    this.eventBus.on(SpawnBarVisibleEvent, (e) => {
      this.spawnBarVisible = e.visible;
    });
    this.eventBus.on(ImmunityBarVisibleEvent, (e) => {
      this.immunityBarVisible = e.visible;
    });
    this._isActive = true;
  }

  private onMouseEvent(event: MouseMoveEvent) {
    this.hoverScreenX = event.x;
    this.hoverScreenY = event.y;

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
    this.hoverScreenX = x;
    this.hoverScreenY = y;

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

  private getPlayerNameColor(
    player: PlayerView,
    myPlayer: PlayerView | null | undefined,
    isFriendly: boolean,
  ): string {
    if (isFriendly) return "text-green-500";
    if (
      myPlayer &&
      myPlayer !== player &&
      player.type() === PlayerType.Nation
    ) {
      const relation =
        this.playerProfile?.relations[myPlayer.smallID()] ?? Relation.Neutral;
      return this.getRelationClass(relation);
    }
    return "text-white";
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

  private displayUnitCount(player: PlayerView, type: UnitType, icon: string) {
    return !this.game.config().isUnitDisabled(type)
      ? html`<div
          class="flex items-center justify-center gap-0.5 lg:gap-1 p-0.5 lg:p-1 border rounded-md border-gray-500 text-[10px] lg:text-xs w-9 lg:w-12 h-6 lg:h-7"
          translate="no"
        >
          <img
            src=${icon}
            class="w-3 h-3 lg:w-4 lg:h-4 object-contain shrink-0"
          />
          <span>${player.totalUnitLevels(type)}</span>
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

  private renderPlayerNameIcons(player: PlayerView) {
    const firstPlace = getFirstPlacePlayer(this.game);
    const icons = getPlayerIcons({
      game: this.game,
      player,
      // Because we already show the alliance icon next to the alliance expiration timer, we don't need to show it a second time in this render
      includeAllianceIcon: false,
      firstPlace,
    });

    if (icons.length === 0) {
      return html``;
    }

    return html`<span class="flex items-center gap-1 ml-1 shrink-0">
      ${icons.map((icon) =>
        icon.kind === "emoji" && icon.text
          ? html`<span class="text-sm shrink-0" translate="no"
              >${icon.text}</span
            >`
          : icon.kind === "image" && icon.src
            ? html`<img src=${icon.src} alt="" class="w-4 h-4 shrink-0" />`
            : html``,
      )}
    </span>`;
  }

  private renderPlayerInfo(player: PlayerView) {
    const myPlayer = this.game.myPlayer();
    const isFriendly = myPlayer?.isFriendly(player);
    const isAllied = myPlayer?.isAlliedWith(player);
    let allianceHtml: TemplateResult | null = null;
    const maxTroops = this.game.config().maxTroops(player);
    const attackingTroops = player
      .outgoingAttacks()
      .map((a) => a.troops)
      .reduce((a, b) => a + b, 0);
    const totalTroops = player.troops();

    if (isAllied) {
      const alliance = myPlayer
        ?.alliances()
        .find((alliance) => alliance.other === player.id());
      if (alliance !== undefined) {
        allianceHtml = html` <div
          class="flex items-center ml-auto mr-0 gap-1 text-sm font-bold leading-tight"
        >
          <img src=${allianceIcon} width="20" height="20" />
          ${this.allianceExpirationText(alliance)}
        </div>`;
      }
    }
    let playerType = "";
    switch (player.type()) {
      case PlayerType.Bot:
        playerType = translateText("player_type.bot");
        break;
      case PlayerType.Nation:
        playerType = translateText("player_type.nation");
        break;
      case PlayerType.Human:
        playerType = translateText("player_type.player");
        break;
    }
    const playerTeam = getTranslatedPlayerTeamLabel(player.team());

    return html`
      <div class="flex items-start gap-1 lg:gap-2 p-1.5 lg:p-2">
        <!-- Left: Gold & Troop bar -->
        <div class="flex flex-col gap-1 shrink-0 w-28 md:w-36">
          <div class="flex items-center gap-1">
            <div
              class="flex flex-1 items-center justify-center p-1 border rounded-md border-yellow-400 font-bold text-yellow-400 text-sm lg:gap-1"
              translate="no"
            >
              <img src=${goldCoinIcon} width="13" height="13" />
              <span class="px-0.5">${renderNumber(player.gold())}</span>
            </div>
            <div
              class="flex flex-1 flex-col items-center justify-center text-xs font-bold ${attackingTroops >
              0
                ? "text-sky-400"
                : "text-white/40"} drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]"
              translate="no"
            >
              <span class="flex items-center gap-px leading-none text-xs"
                ><img
                  src=${soldierIcon}
                  class="w-2.5 h-2.5"
                  style="${attackingTroops > 0
                    ? "filter: brightness(0) saturate(100%) invert(62%) sepia(80%) saturate(500%) hue-rotate(175deg) brightness(100%); opacity:1"
                    : "filter: brightness(0) invert(1); opacity:0.4"}"
                />↑</span
              >
              <span class="tabular-nums leading-none text-sm mt-0.5"
                >${renderTroops(attackingTroops)}</span
              >
            </div>
          </div>
          <div class="w-28 md:w-36" translate="no">
            ${this.renderTroopBar(totalTroops, attackingTroops, maxTroops)}
          </div>
        </div>
        <!-- Right: Player identity + Units below -->
        <div class="flex flex-col justify-between self-stretch">
          <div
            class="flex items-center gap-2 font-bold text-sm lg:text-lg ${this.getPlayerNameColor(
              player,
              myPlayer,
              isFriendly ?? false,
            )}"
          >
            ${player.cosmetics.flag
              ? player.cosmetics.flag!.startsWith("!")
                ? html`<div
                    class="h-6 aspect-3/4 player-flag"
                    ${ref((el) => {
                      if (el instanceof HTMLElement) {
                        requestAnimationFrame(() => {
                          renderPlayerFlag(player.cosmetics.flag!, el);
                        });
                      }
                    })}
                  ></div>`
                : html`<img
                    class="h-6 aspect-3/4"
                    src=${"/flags/" + player.cosmetics.flag! + ".svg"}
                  />`
              : html``}
            <span>${player.name()}</span>
            ${playerTeam !== "" && player.type() !== PlayerType.Bot
              ? html`<div class="flex flex-col leading-tight">
                  <span class="text-gray-400 text-xs font-normal"
                    >${playerType}</span
                  >
                  <span class="text-xs font-normal text-gray-400"
                    >[<span
                      style="color: ${this.game
                        .config()
                        .theme()
                        .teamColor(player.team()!)
                        .toHex()}"
                      >${playerTeam}</span
                    >]</span
                  >
                </div>`
              : html`<span class="text-gray-400 text-xs font-normal"
                  >${playerType}</span
                >`}
            ${this.renderPlayerNameIcons(player)} ${allianceHtml ?? ""}
          </div>
          <div class="flex gap-0.5 lg:gap-1 items-center mt-1">
            ${this.displayUnitCount(player, UnitType.City, cityIcon)}
            ${this.displayUnitCount(player, UnitType.Factory, factoryIcon)}
            ${this.displayUnitCount(player, UnitType.Port, portIcon)}
            ${this.displayUnitCount(
              player,
              UnitType.MissileSilo,
              missileSiloIcon,
            )}
            ${this.displayUnitCount(
              player,
              UnitType.SAMLauncher,
              samLauncherIcon,
            )}
            ${this.displayUnitCount(player, UnitType.Warship, warshipIcon)}
          </div>
        </div>
      </div>
    `;
  }

  private renderTroopBar(
    totalTroops: number,
    attackingTroops: number,
    maxTroops: number,
  ) {
    const base = Math.max(maxTroops, 1);
    const greenPercentRaw = (totalTroops / base) * 100;
    const orangePercentRaw = (attackingTroops / base) * 100;

    const greenPercent = Math.max(0, Math.min(100, greenPercentRaw));
    const orangePercent = Math.max(
      0,
      Math.min(100 - greenPercent, orangePercentRaw),
    );

    return html`
      <div
        class="w-full mt-0.5 lg:mt-1 h-5 lg:h-6 border border-gray-600 rounded-md bg-gray-900/60 overflow-hidden relative"
      >
        <div class="h-full flex">
          ${greenPercent > 0
            ? html`<div
                class="h-full bg-sky-700 transition-[width] duration-200"
                style="width: ${greenPercent}%;"
              ></div>`
            : ""}
          ${orangePercent > 0
            ? html`<div
                class="h-full bg-sky-600 transition-[width] duration-200"
                style="width: ${orangePercent}%;"
              ></div>`
            : ""}
        </div>
        <div
          class="absolute inset-0 flex items-center justify-between px-1.5 text-sm font-bold leading-none pointer-events-none"
          translate="no"
        >
          <span class="text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]"
            >${renderTroops(totalTroops)}</span
          >
          <span class="text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]"
            >${renderTroops(maxTroops)}</span
          >
        </div>
        <img
          src=${soldierIcon}
          alt=""
          aria-hidden="true"
          width="14"
          height="14"
          class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 brightness-0 invert drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)] pointer-events-none"
        />
      </div>
    `;
  }

  private renderUnitInfo(unit: UnitView) {
    const isAlly =
      (unit.owner() === this.game.myPlayer() ||
        this.game.myPlayer()?.isFriendly(unit.owner())) ??
      false;

    return html`
      <div class="p-2">
        <div class="font-bold mb-1 ${isAlly ? "text-green-500" : "text-white"}">
          ${unit.owner().name()}
        </div>
        <div class="mt-1">
          <div class="text-sm opacity-80">${unit.type()}</div>
          ${unit.hasHealth()
            ? html` <div class="text-sm">Health: ${unit.health()}</div> `
            : ""}
          ${unit.type() === UnitType.TransportShip
            ? html`
                <div class="text-sm">
                  Troops: ${renderTroops(unit.troops())}
                </div>
              `
            : ""}
        </div>
      </div>
    `;
  }

  private isDesktopViewport(): boolean {
    return typeof window !== "undefined" && window.innerWidth >= 1024;
  }

  private canShowAttackPreview(player: PlayerView): boolean {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer || !myPlayer.isAlive()) return false;
    if (myPlayer.id() === player.id()) return false;
    if (myPlayer.isFriendly(player)) return false;
    return true;
  }

  private predictedOutgoingAttackTroops(): number {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return 0;
    const ratio = this.uiState?.attackRatio ?? 0;
    return Math.max(0, Math.floor(myPlayer.troops() * ratio));
  }

  private myCurrentTroopPercent(): number {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return 0;

    const myMaxTroops = this.game.config().maxTroops(myPlayer);
    if (myMaxTroops <= 0) return 0;

    const ratio = (myPlayer.troops() / myMaxTroops) * 100;
    return Math.max(0, Math.min(100, ratio));
  }

  private isMiniHoverOverlayEnabled(): boolean {
    if (typeof document === "undefined") return true;
    return !document.body.classList.contains("mini-hover-overlay-disabled");
  }

  private compactOverlayStyle(): string {
    if (typeof window === "undefined") {
      return `left: ${this.hoverScreenX}px; top: ${this.hoverScreenY}px;`;
    }

    const margin = 8;
    const overlayWidth = Math.min(230, Math.max(210, window.innerWidth - 16));
    const x = Math.min(
      Math.max(margin, this.hoverScreenX + 16),
      Math.max(margin, window.innerWidth - overlayWidth - margin),
    );
    const y = Math.min(
      Math.max(margin, this.hoverScreenY - 102),
      Math.max(margin, window.innerHeight - 130),
    );

    return `left: ${Math.round(x)}px; top: ${Math.round(y)}px;`;
  }

  private renderCompactHoverPlayerInfo(player: PlayerView) {
    const myPlayer = this.game.myPlayer();
    if (myPlayer && myPlayer.id() === player.id()) {
      return html``;
    }

    const totalTroops = player.troops();
    const maxTroops = this.game.config().maxTroops(player);
    const attackingTroops = player
      .outgoingAttacks()
      .map((a) => a.troops)
      .reduce((a, b) => a + b, 0);
    const attackPreviewEnabled = this.canShowAttackPreview(player);
    const previewTroops = this.predictedOutgoingAttackTroops();
    const myTroopPercent = this.myCurrentTroopPercent();

    return html`
      <div
        class="fixed z-[70] pointer-events-none flex flex-col gap-1.5 w-[230px] max-w-[calc(100vw-1rem)]"
        style="${this.compactOverlayStyle()}"
      >
        <div
          class="inline-flex items-center gap-2 self-start rounded-md border border-white/20 bg-black/82 backdrop-blur-xs px-2 py-1 text-xs text-white shadow-[0_2px_8px_rgba(0,0,0,0.55)]"
          translate="no"
        >
          <span class="font-semibold">${renderTroops(totalTroops)}</span>
          <span class="text-white/60">/ ${renderTroops(maxTroops)}</span>
          ${attackingTroops > 0
            ? html`<span
                class="inline-flex items-center gap-1 rounded-sm bg-red-900/35 border border-red-500/40 px-1.5 py-0.5 text-red-400"
              >
                <img
                  src=${swordIcon}
                  class="h-3.5 w-3.5"
                  style="filter: brightness(0) saturate(100%) invert(27%) sepia(91%) saturate(4551%) hue-rotate(348deg) brightness(89%) contrast(97%)"
                />
                <span>${renderTroops(attackingTroops)}</span>
              </span>`
            : ""}
        </div>

        ${attackPreviewEnabled && previewTroops > 0
          ? html`<div
              class="self-start inline-flex items-center gap-1 rounded-md border border-blue-300/70 bg-black/88 backdrop-blur-xs px-2 py-1 text-blue-400 text-xs font-bold shadow-[0_2px_8px_rgba(0,0,0,0.55)]"
              translate="no"
            >
              <img
                src=${swordIcon}
                class="h-3.5 w-3.5"
                style="filter: brightness(0) saturate(100%) invert(72%) sepia(56%) saturate(3204%) hue-rotate(176deg) brightness(99%) contrast(101%)"
              />
              <span>${renderTroops(previewTroops)}</span>
              <span class="text-blue-200/90"
                >(${myTroopPercent.toFixed(0)}%)</span
              >
            </div>`
          : ""}
      </div>
    `;
  }

  render() {
    if (!this._isActive) {
      return html``;
    }

    const myPlayer = this.game.myPlayer();
    const showCompactHoverOverlay =
      this._isInfoVisible &&
      this.player !== null &&
      this.unit === null &&
      this.isDesktopViewport() &&
      this.isMiniHoverOverlayEnabled() &&
      myPlayer !== null &&
      this.player.id() !== myPlayer.id();

    const containerClasses = this._isInfoVisible
      ? "opacity-100 visible"
      : "opacity-0 invisible pointer-events-none";

    return html`
      <div
        class="fixed top-0 min-[1200px]:top-4 left-0 right-0 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 z-[1001]"
        style="margin-top: ${this.barOffset}px;"
        @click=${() => this.hide()}
        @contextmenu=${(e: MouseEvent) => e.preventDefault()}
      >
        <div
          class="bg-gray-800/70 backdrop-blur-xs shadow-xs min-[1200px]:rounded-lg sm:rounded-b-lg shadow-lg text-white text-lg lg:text-base w-full sm:w-auto sm:min-w-[400px] overflow-hidden ${containerClasses}"
        >
          ${this.player !== null ? this.renderPlayerInfo(this.player) : ""}
          ${this.unit !== null ? this.renderUnitInfo(this.unit) : ""}
        </div>
      </div>
      ${showCompactHoverOverlay
        ? this.renderCompactHoverPlayerInfo(this.player!)
        : ""}
    `;
  }

  createRenderRoot() {
    return this; // Disable shadow DOM to allow Tailwind styles
  }
}
