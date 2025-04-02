import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { UnitType } from "../../../core/game/Game";
import { GameView } from "../../../core/game/GameView";
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

@customElement("buildings-stats-overlay")
export class BuildingsStatsOverlay extends LitElement implements Layer {
  @property({ type: Object })
  public game!: GameView;

  @property({ type: String })
  public clientID!: ClientID;

  @state()
  private _isVisible = false;

  @state()
  private _gold: number;

  @state()
  private _goldPerSecond: number;

  @state()
  private _warships: number;

  @state()
  private _ports: number;

  @state()
  private _cities: number;

  @state()
  private _defensePosts: number;

  @state()
  private _samLaunchers: number;

  @state()
  private _missileSilos: number;

  init() {}

  tick() {
    if (!this._isVisible && !this.game.inSpawnPhase()) {
      this.setVisibile(true);
    }

    const player = this.game.myPlayer();
    if (player == null || !player.isAlive()) {
      this.setVisibile(false);
      return;
    }

    this._gold = player.gold();
    this._goldPerSecond = this.game.config().goldAdditionRate(player) * 10;
    this._warships = player.units(UnitType.Warship).length;
    this._ports = player.units(UnitType.Port).length;
    this._cities = player.units(UnitType.City).length;
    this._defensePosts = player.units(UnitType.DefensePost).length;
    this._samLaunchers = player.units(UnitType.SAMLauncher).length;
    this._missileSilos = player.units(UnitType.MissileSilo).length;

    this.requestUpdate();
  }

  renderLayer(context: CanvasRenderingContext2D) {}

  shouldTransform(): boolean {
    return false;
  }

  setVisibile(visible: boolean) {
    this._isVisible = visible;
    this.requestUpdate();
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

  render() {
    if (!this._isVisible) return html``;

    return html`
      <div
        class="w-full z-50 hidden lg:block"
        @contextmenu=${(e) => e.preventDefault()}
      >
        <div
          class="bg-opacity-60 bg-gray-900 rounded-lg shadow-lg backdrop-blur-sm  text-white text-lg md:text-base"
        >
          <div class="p-2 flex flex-row">
            <div
              class="flex flex-row items-center gap-2 opacity-80"
              translate="no"
            >
              ${this.renderIcon(goldCoinIcon)}
              <span class="py-2 pr-2"
                >${renderNumber(this._gold)}
                (+${renderNumber(this._goldPerSecond)})</span
              >
            </div>
            ${this.renderResourceCount(warshipIcon, this._warships)}
            ${this.renderResourceCount(portIcon, this._ports)}
            ${this.renderResourceCount(cityIcon, this._cities)}
            ${this.renderResourceCount(shieldIcon, this._defensePosts)}
            ${this.renderResourceCount(samLauncherIcon, this._samLaunchers)}
            ${this.renderResourceCount(missileSiloIcon, this._missileSilos)}
          </div>
        </div>
      </div>
    `;
  }

  createRenderRoot() {
    return this; // Disable shadow DOM to allow Tailwind styles
  }
}
