import { html, LitElement } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import cityIcon from "../../../../resources/images/CityIconWhite.svg";
import darkModeIcon from "../../../../resources/images/DarkModeIconWhite.svg";
import emojiIcon from "../../../../resources/images/EmojiIconWhite.svg";
import exitIcon from "../../../../resources/images/ExitIconWhite.svg";
import explosionIcon from "../../../../resources/images/ExplosionIconWhite.svg";
import factoryIcon from "../../../../resources/images/FactoryIconWhite.svg";
import goldCoinIcon from "../../../../resources/images/GoldCoinIcon.svg";
import missileSiloIcon from "../../../../resources/images/MissileSiloUnit.png";
import mouseIcon from "../../../../resources/images/MouseIconWhite.svg";
import ninjaIcon from "../../../../resources/images/NinjaIconWhite.svg";
import populationIcon from "../../../../resources/images/PopulationIconSolidWhite.svg";
import portIcon from "../../../../resources/images/PortIcon.svg";
import samLauncherIcon from "../../../../resources/images/SamLauncherUnitWhite.png";
import settingsIcon from "../../../../resources/images/SettingIconWhite.svg";
import defensePostIcon from "../../../../resources/images/ShieldIconWhite.svg";
import treeIcon from "../../../../resources/images/TreeIconWhite.svg";
import troopIcon from "../../../../resources/images/TroopIconWhite.svg";
import workerIcon from "../../../../resources/images/WorkerIconWhite.svg";
import { translateText } from "../../../client/Utils";
import { EventBus } from "../../../core/EventBus";
import { UnitType } from "../../../core/game/Game";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { GameView } from "../../../core/game/GameView";
import { UserSettings } from "../../../core/game/UserSettings";
import { AlternateViewEvent, RefreshGraphicsEvent } from "../../InputHandler";
import { renderNumber, renderTroops } from "../../Utils";
import { Layer } from "./Layer";

@customElement("game-top-bar")
export class GameTopBar extends LitElement implements Layer {
  public game: GameView;
  public eventBus: EventBus;
  private _population = 0;
  private _troops = 0;
  private _cities = 0;
  private _factories = 0;
  private _workers = 0;
  private _missileSilo = 0;
  private _port = 0;
  private _defensePost = 0;
  private _samLauncher = 0;
  private _lastPopulationIncreaseRate = 0;
  private _popRateIsIncreasing = false;
  private hasWinner = false;

  @property({ type: Object })
  userSettings: UserSettings;

  @state()
  private showSettingsMenu = false;
  @state()
  private alternateView: boolean = false;

  @state()
  private timer: number = 0;

  @query(".settings-container")
  private settingsContainer!: HTMLElement;

  createRenderRoot() {
    return this;
  }

  init() {
    this.requestUpdate();
  }

  tick() {
    this.updatePopulationIncrease();
    const player = this.game?.myPlayer();
    if (!player) return;
    this._troops = player.troops();
    this._workers = player.workers();
    this._cities = player.totalUnitLevels(UnitType.City);
    this._missileSilo = player.totalUnitLevels(UnitType.MissileSilo);
    this._port = player.totalUnitLevels(UnitType.Port);
    this._defensePost = player.totalUnitLevels(UnitType.DefensePost);
    this._samLauncher = player.totalUnitLevels(UnitType.SAMLauncher);
    this._factories = player.totalUnitLevels(UnitType.Factory);
    const updates = this.game.updatesSinceLastTick();
    if (updates) {
      this.hasWinner = this.hasWinner || updates[GameUpdateType.Win].length > 0;
    }
    if (this.game.inSpawnPhase()) {
      this.timer = 0;
    } else if (!this.hasWinner && this.game.ticks() % 10 === 0) {
      this.timer++;
    }
    this.requestUpdate();
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("click", this.handleOutsideClick, true);
  }

  disconnectedCallback() {
    window.removeEventListener("click", this.handleOutsideClick, true);
    super.disconnectedCallback();
  }
  private handleOutsideClick = (event: MouseEvent) => {
    if (
      this.showSettingsMenu &&
      this.settingsContainer &&
      !this.settingsContainer.contains(event.target as Node)
    ) {
      this.showSettingsMenu = false;
    }
  };

  private onExitButtonClick() {
    const isAlive = this.game.myPlayer()?.isAlive();
    if (isAlive) {
      const isConfirmed = confirm("Are you sure you want to exit the game?");
      if (!isConfirmed) return;
    }
    // redirect to the home page
    window.location.href = "/";
  }

  private onTerrainButtonClick() {
    this.alternateView = !this.alternateView;
    this.eventBus.emit(new AlternateViewEvent(this.alternateView));
    this.requestUpdate();
  }

  private onToggleEmojisButtonClick() {
    this.userSettings.toggleEmojis();
    this.requestUpdate();
  }

  private onToggleSpecialEffectsButtonClick() {
    this.userSettings.toggleFxLayer();
    this.requestUpdate();
  }

  private onToggleDarkModeButtonClick() {
    this.userSettings.toggleDarkMode();
    this.requestUpdate();
    this.eventBus.emit(new RefreshGraphicsEvent());
  }

  private onToggleRandomNameModeButtonClick() {
    this.userSettings.toggleRandomName();
  }
  private onToggleLeftClickOpensMenu() {
    this.userSettings.toggleLeftClickOpenMenu();
  }

  private toggleSettingsMenu() {
    this.showSettingsMenu = !this.showSettingsMenu;
  }

  private updatePopulationIncrease() {
    const player = this.game?.myPlayer();
    if (player === null) return;
    const popIncreaseRate = player.population() - this._population;
    if (this.game.ticks() % 5 === 0) {
      this._popRateIsIncreasing =
        popIncreaseRate >= this._lastPopulationIncreaseRate;
      this._lastPopulationIncreaseRate = popIncreaseRate;
    }
  }

  private secondsToHms = (d: number): string => {
    const h = Math.floor(d / 3600);
    const m = Math.floor((d % 3600) / 60);
    const s = Math.floor((d % 3600) % 60);
    let time = d === 0 ? "-" : `${s}s`;
    if (m > 0) time = `${m}m` + time;
    if (h > 0) time = `${h}h` + time;
    return time;
  };

  render() {
    const myPlayer = this.game?.myPlayer();
    if (!this.game || !myPlayer || this.game.inSpawnPhase()) {
      return null;
    }

    const isAlt = this.game.config().isReplay();
    if (isAlt) {
      return html`
        <div
          class="fixed top-0 left-auto right-0 z-[1100] bg-slate-800/40 backdrop-blur-sm p-2 flex justify-center items-center"
        >
          <div
            class="w-[70px] h-8 lg:w-24 lg:h-10 border border-slate-400 p-0.5 text-xs md:text-sm lg:text-base flex items-center text-white px-1"
          >
            ${this.secondsToHms(this.timer)}
          </div>
        </div>
      `;
    }
    const popRate = myPlayer
      ? this.game.config().populationIncreaseRate(myPlayer) * 10
      : 0;
    const maxPop = myPlayer ? this.game.config().maxPopulation(myPlayer) : 0;
    const goldPerSecond = myPlayer
      ? this.game.config().goldAdditionRate(myPlayer) * 10n
      : 0n;

    return html`
      <div
        class="fixed top-0 min-h-[50px] lg:min-h-[80px] z-[1100] flex flex-wrap bg-slate-800/40 backdrop-blur-sm shadow-xs text-white text-xs md:text-sm lg:text-base left-0 right-0 grid-cols-4 p-1 md:px-1.5 lg:px-4"
      >
        <div
          class="flex flex-1 basis-full justify-between items-center gap-1 w-full"
        >
          ${myPlayer?.isAlive() && !this.game.inSpawnPhase()
            ? html`
                <div class="overflow-x-auto hide-scrollbar flex-1 max-w-[85vw]">
                  <div
                    class="grid gap-1 grid-cols-[80px_100px_80px_minmax(80px,auto)] w-max md:gap-2 md:grid-cols-[90px_120px_90px_minmax(100px,auto)]"
                  >
                    <div
                      class="flex flex-wrap gap-1 flex-col bg-slate-800/20 border border-slate-400 p-0.5 md:px-1 lg:px-2"
                    >
                      <div class="flex gap-2 items-center justify-between">
                        <img
                          src=${goldCoinIcon}
                          alt="gold"
                          width="20"
                          height="20"
                          style="vertical-align: middle;"
                        />
                        +${renderNumber(goldPerSecond)}
                      </div>
                      <div>${renderNumber(myPlayer.gold())}</div>
                    </div>
                    <div
                      class="flex flex-wrap gap-1 flex-col bg-slate-800/20 border border-slate-400 p-0.5 md:px-1 lg:px-2"
                    >
                      <div class="flex gap-2 items-center justify-between">
                        <img
                          src=${populationIcon}
                          alt="population"
                          width="20"
                          height="20"
                          style="vertical-align: middle;"
                        />
                        <span
                          class="${this._popRateIsIncreasing
                            ? "text-green-500"
                            : "text-yellow-500"}"
                          translate="no"
                        >
                          +${renderTroops(popRate)}
                        </span>
                      </div>
                      <div>
                        ${renderTroops(myPlayer.population())} /
                        ${renderTroops(maxPop)}
                      </div>
                    </div>
                    <div
                      class="flex bg-slate-800/20 border border-slate-400 p-0.5 md:px-1 lg:px-2"
                    >
                      <div class="flex flex-col flex-grow gap-1 w-full ">
                        <div class="flex gap-1">
                          <img
                            src=${troopIcon}
                            alt="troops"
                            width="20"
                            height="20"
                            style="vertical-align: middle;"
                          />
                          ${renderTroops(this._troops)}
                        </div>
                        <div class="flex gap-1">
                          <img
                            src=${workerIcon}
                            alt="gold"
                            width="20"
                            height="20"
                            style="vertical-align: middle;"
                          />
                          ${renderTroops(this._workers)}
                        </div>
                      </div>
                    </div>
                    <div
                      class="grid grid-rows-1 auto-cols-max grid-flow-col gap-1 bg-slate-800/20 border border-slate-400 p-0.5 md:px-1 lg:px-2 md:gap-2"
                    >
                      <div class="flex items-center gap-2">
                        <img
                          src=${cityIcon}
                          alt="gold"
                          width="20"
                          height="20"
                          style="vertical-align: middle;"
                        />
                        ${renderNumber(this._cities)}
                      </div>
                      <div class="flex items-center gap-2">
                        <img
                          src=${factoryIcon}
                          alt="gold"
                          width="20"
                          height="20"
                          style="vertical-align: middle;"
                        />
                        ${renderNumber(this._factories)}
                      </div>
                      <div class="flex items-center gap-2">
                        <img
                          src=${portIcon}
                          alt="gold"
                          width="20"
                          height="20"
                          style="vertical-align: middle;"
                        />
                        ${renderNumber(this._port)}
                      </div>
                      <div class="flex items-center gap-2">
                        <img
                          src=${defensePostIcon}
                          alt="gold"
                          width="20"
                          height="20"
                          style="vertical-align: middle;"
                        />
                        ${renderNumber(this._defensePost)}
                      </div>
                      <div class="flex items-center gap-2">
                        <img
                          src=${missileSiloIcon}
                          alt="gold"
                          width="20"
                          height="20"
                          style="vertical-align: middle;"
                        />
                        ${renderNumber(this._missileSilo)}
                      </div>
                      <div class="flex items-center gap-2">
                        <img
                          src=${samLauncherIcon}
                          alt="gold"
                          width="20"
                          height="20"
                          style="vertical-align: middle;"
                        />
                        ${renderNumber(this._samLauncher)}
                      </div>
                    </div>
                  </div>
                </div>
              `
            : html`<div></div>`}
          <div class="flex gap-1 items-center">
            <div
              class="w-[70px] h-8 lg:w-24 lg:h-10 border border-slate-400 p-0.5 text-xs md:text-sm lg:text-base flex items-center px-1"
            >
              ${this.secondsToHms(this.timer)}
            </div>
            <div class="relative settings-container">
              <img
                class="cursor-pointer bg-slate-800/20 border border-slate-400 p-0.5"
                src=${settingsIcon}
                alt="settings"
                width="28"
                height="28"
                style="vertical-align: middle;"
                @click=${this.toggleSettingsMenu}
              />
              ${this.showSettingsMenu
                ? html`
                    <div
                      class="absolute right-0 mt-1.5 bg-slate-700 border border-slate-500 rounded shadow-lg z-[1100] w-max min-w-[10rem] whitespace-nowrap"
                    >
                      <button
                        class="flex gap-1 items-center w-full text-left px-2 py-1 hover:bg-slate-600 text-white text-sm"
                        @click="${this.onTerrainButtonClick}"
                      >
                        <img
                          src=${treeIcon}
                          alt="treeIcon"
                          width="20"
                          height="20"
                        />
                        Toggle Terrain ${this.alternateView ? "On" : "Off"}
                      </button>
                      <button
                        class="flex gap-1 items-center w-full text-left px-2 py-1 hover:bg-slate-600 text-white text-sm"
                        @click="${this.onToggleEmojisButtonClick}"
                      >
                        <img
                          src=${emojiIcon}
                          alt="emojiIcon"
                          width="20"
                          height="20"
                        />
                        ${translateText("user_setting.emojis_label")}
                        ${this.userSettings.emojis() ? "On" : "Off"}
                      </button>
                      <button
                        class="flex gap-1 items-center w-full text-left px-2 py-1 hover:bg-slate-600 text-white text-sm"
                        @click="${this.onToggleDarkModeButtonClick}"
                      >
                        <img
                          src=${darkModeIcon}
                          alt="darkModeIcon"
                          width="20"
                          height="20"
                        />
                        ${translateText("user_setting.dark_mode_label")}
                        ${this.userSettings.darkMode() ? "On" : "Off"}
                      </button>
                      <button
                        class="flex gap-1 items-center w-full text-left px-2 py-1 hover:bg-slate-600 text-white text-sm"
                        @click="${this.onToggleSpecialEffectsButtonClick}"
                      >
                        <img
                          src=${explosionIcon}
                          alt="onExitButtonClick"
                          width="20"
                          height="20"
                        />
                        ${translateText("user_setting.special_effects_label")}
                        ${this.userSettings.fxLayer() ? "On" : "Off"}
                      </button>
                      <button
                        class="flex gap-1 items-center w-full text-left px-2 py-1 hover:bg-slate-600 text-white text-sm"
                        @click="${this.onToggleRandomNameModeButtonClick}"
                      >
                        <img
                          src=${ninjaIcon}
                          alt="ninjaIcon"
                          width="20"
                          height="20"
                        />
                        ${translateText("user_setting.anonymous_names_label")}
                        ${this.userSettings.anonymousNames() ? "On" : "Off"}
                      </button>
                      <button
                        class="flex gap-1 items-center w-full text-left px-2 py-1 hover:bg-slate-600 text-white text-sm"
                        @click="${this.onToggleLeftClickOpensMenu}"
                      >
                        <img
                          src=${mouseIcon}
                          alt="mouseIcon"
                          width="20"
                          height="20"
                        />
                        Left click
                        ${this.userSettings.leftClickOpensMenu() ? "On" : "Off"}
                      </button>
                      <button
                        class="flex gap-1 items-center w-full text-left px-2 py-1 hover:bg-slate-600 text-white text-sm"
                        @click="${this.onExitButtonClick}"
                      >
                        <img
                          src=${exitIcon}
                          alt="exitIcon"
                          width="20"
                          height="20"
                        />
                        Exit game
                      </button>
                    </div>
                  `
                : null}
            </div>
          </div>
        </div>
      </div>
    `;
  }
}
