import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { UnitType } from "../../../core/game/Game";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { ClientID } from "../../../core/Schemas";
import { renderNumber } from "../../Utils";
import { Layer } from "./Layer";

import warshipIcon from "../../../../resources/images/BattleshipIconWhite.svg";
import cityIcon from "../../../../resources/images/CityIconWhite.svg";
import goldCoinIcon from "../../../../resources/images/GoldCoinIcon.svg";
import missileSiloIcon from "../../../../resources/images/MissileSiloIconWhite.svg";
import portIcon from "../../../../resources/images/PortIcon.svg";
import samLauncherIcon from "../../../../resources/images/SamLauncherIconWhite.svg";
import shieldIcon from "../../../../resources/images/ShieldIconWhite.svg";
import swordIcon from "../../../../resources/images/SwordIconWhite.svg";

@customElement("buildings-stats-overlay")
export class BuildingsStatsOverlay extends LitElement implements Layer {
  @property({ type: Object })
  public game!: GameView;

  @property({ type: String })
  public clientID!: ClientID;

  private _isActive = false;

  init() {
    this._isActive = true;
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

  private myPlayer(): PlayerView | null {
    return this.game && this.game.playerByClientID(this.clientID);
  }

  private playing(): boolean {
    return !!this.myPlayer();
  }

  private renderIcon(src: string) {
    return html`<img class="p-2 w-10 h-10" src="${src}" />`;
  }

  private renderResourceCount(icon: string, count: number) {
    const iconTag = this.renderIcon(icon);
    return html`
      <div class="flex flex-row items-center gap-2 opacity-80" translate="no">
        ${iconTag}
        <span class="py-2 pr-2">${renderNumber(count)}</span>
      </div>
    `;
  }

  private renderUnitCount(icon: string, unit: UnitType) {
    const player = this.myPlayer();
    return this.renderResourceCount(icon, player.units(unit).length);
  }

  private renderPlayerInfo() {
    const player = this.myPlayer();
    return html`
      <div class="p-2 flex flex-row">
        ${this.renderResourceCount(goldCoinIcon, player.gold())}
        ${this.renderResourceCount(swordIcon, player.troops() / 10)}
        ${this.renderUnitCount(warshipIcon, UnitType.Warship)}
        ${this.renderUnitCount(portIcon, UnitType.Port)}
        ${this.renderUnitCount(cityIcon, UnitType.City)}
        ${this.renderUnitCount(shieldIcon, UnitType.DefensePost)}
        ${this.renderUnitCount(samLauncherIcon, UnitType.SAMLauncher)}
        ${this.renderUnitCount(missileSiloIcon, UnitType.MissileSilo)}
      </div>
    `;
  }

  render() {
    if (!this._isActive || !this.playing()) {
      return html``;
    }
    return html`
      <div class="w-full z-50 hidden lg:block">
        <div
          class="bg-opacity-60 bg-gray-900 rounded-lg shadow-lg backdrop-blur-sm transition-all duration-300  text-white text-lg md:text-base opacity-100 visible"
        >
          ${this.renderPlayerInfo()}
        </div>
      </div>
    `;
  }

  createRenderRoot() {
    return this; // Disable shadow DOM to allow Tailwind styles
  }
}
