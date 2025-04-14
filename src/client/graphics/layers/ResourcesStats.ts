import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { UnitType } from "../../../core/game/Game";
import { GameView } from "../../../core/game/GameView";
import { renderNumber } from "../../Utils";
import { Layer } from "./Layer";

import warshipIcon from "../../../../resources/images/BattleshipIconWhite.svg";
import cityIcon from "../../../../resources/images/CityIconWhite.svg";
import goldCoinIcon from "../../../../resources/images/GoldCoinIcon.svg";
import missileSiloIcon from "../../../../resources/images/MissileSiloIconWhite.svg";
import portIcon from "../../../../resources/images/PortIcon.svg";
import samLauncherIcon from "../../../../resources/images/SamLauncherIconWhite.svg";
import shieldIcon from "../../../../resources/images/ShieldIconWhite.svg";

import chevronDownIcon from "../../../../resources/images/ChevronDownWhite.svg";
import chevronLeftIcon from "../../../../resources/images/ChevronLeftWhite.svg";
import chevronRightIcon from "../../../../resources/images/ChevronRightWhite.svg";
import chevronUptIcon from "../../../../resources/images/ChevronUpWhite.svg";

@customElement("resources-stats")
export class ResourcesStats extends LitElement implements Layer {
  @property({ type: Object })
  public game!: GameView;

  @property({ type: String })
  public disposition: "row" | "col" = "row";

  @property({ type: Boolean })
  public showBuildingStats: boolean = true;

  @property({ type: Boolean })
  public showGoldStats: boolean = true;

  @property({ type: Boolean })
  public defaultState: "collapsed" | "expanded" = "collapsed";

  @state()
  private _isVisible = false;

  @state()
  private _state = "collapsed";

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

  init() {
    this._state = this.defaultState;
  }

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

  toggleCollapse() {
    this._state = this._state === "expanded" ? "collapsed" : "expanded";
  }

  private renderIcon(src: string) {
    return html`<img class="p-2 w-10 h-10" src="${src}" />`;
  }

  private renderResourceCount(icon: string, count: number) {
    const iconTag = this.renderIcon(icon);
    return html`
      <div
        class="flex flex-row items-center justify-between gap-2 opacity-80"
        translate="no"
      >
        ${iconTag}
        <span class="py-2 pr-2">${renderNumber(count)}</span>
      </div>
    `;
  }

  private renderGoldStats() {
    if (!this.showGoldStats) return html``;

    return html`
      <div
        class="flex flex-row justify-between items-center gap-2 opacity-80"
        translate="no"
      >
        ${this.renderIcon(goldCoinIcon)}
        <span class="py-2 pr-2">
          ${renderNumber(this._gold)} (+${renderNumber(this._goldPerSecond)})
        </span>
      </div>
    `;
  }

  private renderChevron() {
    if (!this.showBuildingStats) return html``;

    const iconCollapsing =
      this.disposition === "col" ? chevronDownIcon : chevronLeftIcon;
    const iconExpanding =
      this.disposition === "col" ? chevronUptIcon : chevronRightIcon;

    return html`
      <button
        class="flex items-center justify-center  p-1
                               bg-opacity-70 bg-gray-700 text-opacity-90 text-white
                               border-none rounded cursor-pointer
                               hover:bg-opacity-60 hover:bg-gray-600
                               transition-colors duration-200
                               text-sm lg:text-xl pointer-events-auto"
        @click=${this.toggleCollapse}
      >
        <img
          class="p-1 h-6"
          src="${this._state === "expanded" ? iconCollapsing : iconExpanding}"
        />
      </button>
    `;
  }

  private renderBuildingStats() {
    if (!this.showBuildingStats) return html``;

    const containerClasses =
      this._state === "expanded"
        ? "opacity-100 visible"
        : "opacity-0 invisible w-0 h-0 pointer-events-none";

    return html`
      <div
        class="flex flex-${this
          .disposition} ${containerClasses} ease-in duration-200"
        style="transition-property: width, height, opacity"
      >
        ${this.renderResourceCount(warshipIcon, this._warships)}
        ${this.renderResourceCount(portIcon, this._ports)}
        ${this.renderResourceCount(cityIcon, this._cities)}
        ${this.renderResourceCount(shieldIcon, this._defensePosts)}
        ${this.renderResourceCount(samLauncherIcon, this._samLaunchers)}
        ${this.renderResourceCount(missileSiloIcon, this._missileSilos)}
      </div>
    `;
  }

  render() {
    if (!this._isVisible) return html``;

    let containerSize = "w-full";
    if (this.disposition === "col")
      containerSize = this.showGoldStats ? "w-48" : "w-32";

    return html`
      <div
        class="${containerSize} z-50 hidden lg:block"
        @contextmenu=${(e) => e.preventDefault()}
      >
        <div
          class="bg-opacity-60 bg-gray-900 rounded-lg shadow-lg backdrop-blur-sm  text-white text-lg md:text-base"
        >
          <div
            class="p-2 flex flex-${this.disposition === "col"
              ? "col-reverse"
              : "row"}"
          >
            ${this.disposition === "row" ? this.renderGoldStats() : ""}
            ${this.renderBuildingStats()}
            ${this.disposition === "col" ? this.renderGoldStats() : ""}
            ${this.renderChevron()}
          </div>
        </div>
      </div>
    `;
  }

  createRenderRoot() {
    return this; // Disable shadow DOM to allow Tailwind styles
  }
}
