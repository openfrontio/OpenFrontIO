import { html, LitElement, TemplateResult } from "lit";
import { ref } from "lit-html/directives/ref.js";
import { customElement, property, state } from "lit/decorators.js";
import { renderPlayerFlag } from "../../../core/CustomFlag";
import { EventBus } from "../../../core/EventBus";
import {
  PlayerProfile,
  PlayerType,
  Relation,
  UnitType,
} from "../../../core/game/Game";
import { GameView, PlayerView, UnitView } from "../../../core/game/GameView";
import { UserSettings } from "../../../core/game/UserSettings";
import { ContextMenuEvent } from "../../InputHandler";
import { renderNumber, renderTroops, translateText } from "../../Utils";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";
import { PlayerInfoManager } from "./PlayerInfoManager";
import { HoverInfo } from "./PlayerInfoService";
import { CloseRadialMenuEvent } from "./RadialMenu";

@customElement("player-info-overlay")
export class PlayerInfoOverlay extends LitElement implements Layer {
  @property({ type: Object })
  public game!: GameView;

  @property({ type: Object })
  public eventBus!: EventBus;

  @property({ type: Object })
  public transform!: TransformHandler;

  @property({ type: Object })
  public userSettings!: UserSettings;

  @state()
  private _isInfoVisible: boolean = false;

  @state()
  private player: PlayerView | null = null;

  @state()
  private playerProfile: PlayerProfile | null = null;

  @state()
  private unit: UnitView | null = null;

  private playerInfoManager!: PlayerInfoManager;
  private _isActive = false;
  private hoverCallback = (hoverInfo: HoverInfo) =>
    this.onHoverInfoUpdate(hoverInfo);
  private contextMenuHandler = (e: ContextMenuEvent) =>
    this.maybeShow(e.x, e.y);
  private closeRadialMenuHandler = () => this.hide();

  private showDetails = true;

  init() {
    this.playerInfoManager = PlayerInfoManager.getInstance(
      this.game,
      this.transform,
      this.eventBus,
    );

    this.playerInfoManager.init();
    this.playerInfoManager.subscribeToData(this.hoverCallback);
    this.setupEventListeners();
    this._isActive = true;
  }

  destroy() {
    this.playerInfoManager?.unsubscribeFromData(this.hoverCallback);
    this.removeEventListeners();
    this._isActive = false;
  }

  private onHoverInfoUpdate(hoverInfo: HoverInfo) {
    if (!this.userSettings?.showPlayerInfoOverlay()) {
      this.hide();
      return;
    }

    this.player = hoverInfo.player;
    this.playerProfile = hoverInfo.playerProfile;
    this.unit = hoverInfo.unit;

    if (this.player || this.unit) {
      this.setVisible(true);
    } else {
      this.hide();
    }
    this.requestUpdate();
  }

  connectedCallback() {
    super.connectedCallback();
    this.setupEventListeners();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListeners();
  }

  protected setupEventListeners() {
    this.eventBus.on(ContextMenuEvent, this.contextMenuHandler);
    this.eventBus.on(CloseRadialMenuEvent, this.closeRadialMenuHandler);
  }

  private removeEventListeners() {
    this.eventBus.off(ContextMenuEvent, this.contextMenuHandler);
    this.eventBus.off(CloseRadialMenuEvent, this.closeRadialMenuHandler);
  }

  protected shouldRender(): boolean {
    return this._isActive && this.userSettings?.showPlayerInfoOverlay();
  }

  public hide() {
    this.setVisible(false);
    this.resetHoverState();
  }

  public async maybeShow(x: number, y: number) {
    this.hide();
    const hoverInfo = await this.playerInfoManager
      .getPlayerInfoService()
      .getHoverInfo(x, y);
    this.onHoverInfoUpdate(hoverInfo);
  }

  private resetHoverState() {
    this.player = null;
    this.playerProfile = null;
    this.unit = null;
  }

  setVisible(visible: boolean) {
    this._isInfoVisible = visible;
    this.requestUpdate();
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
    description: string,
  ) {
    return !this.game.config().isUnitDisabled(type)
      ? html`<div class="text-sm opacity-80" translate="no">
          ${translateText(description)}: ${player.totalUnitLevels(type)}
        </div>`
      : "";
  }

  private renderUnitInfo(unit: UnitView): TemplateResult {
    const playerInfoService = this.playerInfoManager.getPlayerInfoService();
    const relation = playerInfoService.getRelation(unit.owner());
    const relationClass = playerInfoService.getRelationClass(relation);

    return html`
      <div class="p-2">
        <div class="font-bold mb-1 ${relationClass}">
          ${playerInfoService.getShortDisplayName(unit.owner())}
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

  private renderPlayerInfo(player: PlayerView) {
    const myPlayer = this.game.myPlayer();
    const isFriendly = myPlayer?.isFriendly(player);
    let relationHtml: TemplateResult | null = null;
    const attackingTroops = player
      .outgoingAttacks()
      .map((a) => a.troops)
      .reduce((a, b) => a + b, 0);

    const playerInfoService = this.playerInfoManager.getPlayerInfoService();

    if (player.type() === PlayerType.FakeHuman && myPlayer !== null) {
      const relation =
        this.playerProfile?.relations[myPlayer.smallID()] ?? Relation.Neutral;
      const relationClass = playerInfoService.getRelationClass(relation);
      const relationName = this.getRelationName(relation);

      relationHtml = html`
        <div class="text-sm opacity-80">
          ${translateText("player_info_overlay.attitude")}:
          <span class="${relationClass}">${relationName}</span>
        </div>
      `;
    }
    let playerType = "";
    switch (player.type()) {
      case PlayerType.Bot:
        playerType = translateText("player_info_overlay.bot");
        break;
      case PlayerType.FakeHuman:
        playerType = translateText("player_info_overlay.nation");
        break;
      case PlayerType.Human:
        playerType = translateText("player_info_overlay.player");
        break;
    }

    return html`
      <div class="p-2">
        <button
          class="text-bold text-sm lg:text-lg font-bold mb-1 inline-flex break-all ${isFriendly
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
              <div class="text-sm opacity-80">
                ${translateText("player_info_overlay.type")}: ${playerType}
              </div>
              ${player.troops() >= 1
                ? html`<div class="text-sm opacity-80" translate="no">
                    ${translateText("player_info_overlay.d_troops")}:
                    ${renderTroops(player.troops())}
                  </div>`
                : ""}
              ${attackingTroops >= 1
                ? html`<div class="text-sm opacity-80" translate="no">
                    ${translateText("player_info_overlay.a_troops")}:
                    ${renderTroops(attackingTroops)}
                  </div>`
                : ""}
              <div class="text-sm opacity-80" translate="no">
                ${translateText("player_info_overlay.gold")}:
                ${renderNumber(player.gold())}
              </div>
              ${this.displayUnitCount(
                player,
                UnitType.Port,
                "player_info_overlay.ports",
              )}
              ${this.displayUnitCount(
                player,
                UnitType.City,
                "player_info_overlay.cities",
              )}
              ${this.displayUnitCount(
                player,
                UnitType.Factory,
                "player_info_overlay.factories",
              )}
              ${this.displayUnitCount(
                player,
                UnitType.MissileSilo,
                "player_info_overlay.missile_launchers",
              )}
              ${this.displayUnitCount(
                player,
                UnitType.SAMLauncher,
                "player_info_overlay.sams",
              )}
              ${this.displayUnitCount(
                player,
                UnitType.Warship,
                "player_info_overlay.warships",
              )}
              ${relationHtml}
            `
          : ""}
      </div>
    `;
  }

  tick() {
    this.requestUpdate();
  }

  renderLayer(context: CanvasRenderingContext2D) {}

  shouldTransform(): boolean {
    return false;
  }

  createRenderRoot() {
    return this;
  }

  render() {
    if (!this.shouldRender()) {
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
}
