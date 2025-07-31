import { TemplateResult, html } from "lit";
import { ref } from "lit-html/directives/ref.js";
import { customElement, state } from "lit/decorators.js";
import { translateText } from "../../../client/Utils";
import { renderPlayerFlag } from "../../../core/CustomFlag";
import { PlayerType, Relation, UnitType } from "../../../core/game/Game";
import { PlayerView } from "../../../core/game/GameView";
import { ContextMenuEvent, MouseMoveEvent } from "../../InputHandler";
import { renderNumber, renderTroops } from "../../Utils";
import { BasePlayerInfoOverlay } from "./BasePlayerInfoOverlay";
import { CloseRadialMenuEvent } from "./RadialMenu";

@customElement("player-info-overlay")
export class PlayerInfoOverlay extends BasePlayerInfoOverlay {
  @state()
  private _isInfoVisible: boolean = false;

  private lastMouseUpdate = 0;

  protected setupEventListeners() {
    this.eventBus.on(ContextMenuEvent, (e: ContextMenuEvent) =>
      this.maybeShow(e.x, e.y),
    );
    this.eventBus.on(CloseRadialMenuEvent, () => this.hide());
  }

  protected onMouseMove(event: MouseMoveEvent) {
    const now = Date.now();
    if (now - this.lastMouseUpdate < 100) {
      return;
    }
    this.lastMouseUpdate = now;
    this.maybeShow(event.x, event.y);
  }

  protected shouldRender(): boolean {
    return this._isActive && this.userSettings?.showPlayerInfoOverlay();
  }

  public hide() {
    this.setVisible(false);
    this.resetHoverState();
  }

  public maybeShow(x: number, y: number) {
    this.hide();
    this.updateHoverInfo(x, y);
    if (this.player || this.unit) {
      this.setVisible(true);
    }
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

  private renderPlayerInfo(player: PlayerView) {
    const myPlayer = this.game.myPlayer();
    const isFriendly = myPlayer?.isFriendly(player);
    let relationHtml: TemplateResult | null = null;
    const attackingTroops = player
      .outgoingAttacks()
      .map((a) => a.troops)
      .reduce((a, b) => a + b, 0);

    if (player.type() === PlayerType.FakeHuman && myPlayer !== null) {
      const relation =
        this.playerProfile?.relations[myPlayer.smallID()] ?? Relation.Neutral;
      const relationClass = this.getRelationClass(relation);
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
        <div
          class="text-bold text-sm lg:text-lg font-bold mb-1 inline-flex break-all ${isFriendly
            ? "text-green-500"
            : "text-white"}"
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
        </div>
        ${player.team() !== null
          ? html`<div class="text-sm opacity-80">
              ${translateText("player_info_overlay.team")}: ${player.team()}
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
      </div>
    `;
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
