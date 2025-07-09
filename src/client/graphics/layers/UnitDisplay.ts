import { html, LitElement } from "lit";
import { customElement } from "lit/decorators.js";
import cityIcon from "../../../../resources/images/CityIconWhite.svg";
import factoryIcon from "../../../../resources/images/FactoryIconWhite.svg";
import missileSiloIcon from "../../../../resources/images/MissileSiloUnit.png";
import portIcon from "../../../../resources/images/PortIcon.svg";
import samLauncherIcon from "../../../../resources/images/SamLauncherUnitWhite.png";
import defensePostIcon from "../../../../resources/images/ShieldIconWhite.svg";
import { EventBus } from "../../../core/EventBus";
import { UnitType } from "../../../core/game/Game";
import { GameView } from "../../../core/game/GameView";
import { ToggleStructureEvent } from "../../InputHandler";
import { renderNumber } from "../../Utils";
import { Layer } from "./Layer";

@customElement("unit-display")
export class UnitDisplay extends LitElement implements Layer {
  public game: GameView;
  public eventBus: EventBus;
  private _selectedStructure: UnitType | null = null;
  private _cities = 0;
  private _factories = 0;
  private _missileSilo = 0;
  private _port = 0;
  private _defensePost = 0;
  private _samLauncher = 0;

  createRenderRoot() {
    return this;
  }

  init() {
    this.requestUpdate();
  }

  tick() {
    const player = this.game?.myPlayer();
    if (!player) return;
    this._cities = player.totalUnitLevels(UnitType.City);
    this._missileSilo = player.totalUnitLevels(UnitType.MissileSilo);
    this._port = player.totalUnitLevels(UnitType.Port);
    this._defensePost = player.totalUnitLevels(UnitType.DefensePost);
    this._samLauncher = player.totalUnitLevels(UnitType.SAMLauncher);
    this._factories = player.totalUnitLevels(UnitType.Factory);
    this.requestUpdate();
  }

  private renderUnitItem(
    icon: string,
    number: number,
    unitType: UnitType,
    altText: string,
  ) {
    if (this.game.config().isUnitDisabled(unitType)) {
      return html``;
    }

    return html`
      <div
        class="px-2 flex items-center gap-2 cursor-pointer hover:bg-slate-700/50 rounded text-white"
        style="background: ${this._selectedStructure === unitType
          ? "#ffffff2e"
          : "none"}"
        @mouseenter="${() =>
          this.eventBus.emit(new ToggleStructureEvent(unitType))}"
        @mouseleave="${() =>
          this.eventBus.emit(new ToggleStructureEvent(null))}"
      >
        <img
          src=${icon}
          alt=${altText}
          width="20"
          height="20"
          style="vertical-align: middle;"
        />
        ${renderNumber(number)}
      </div>
    `;
  }

  render() {
    const myPlayer = this.game?.myPlayer();
    if (
      !this.game ||
      !myPlayer ||
      this.game.inSpawnPhase() ||
      !myPlayer.isAlive()
    ) {
      return null;
    }

    return html`
      <div
        class="fixed bottom-4 left-1/2 transform -translate-x-1/2 z-[1100] bg-gray-800/70 backdrop-blur-sm border border-slate-400 rounded-lg p-2 hidden lg:block"
      >
        <div class="grid grid-rows-1 auto-cols-max grid-flow-col gap-1">
          ${this.renderUnitItem(cityIcon, this._cities, UnitType.City, "city")}
          ${this.renderUnitItem(
            factoryIcon,
            this._factories,
            UnitType.Factory,
            "factory",
          )}
          ${this.renderUnitItem(portIcon, this._port, UnitType.Port, "port")}
          ${this.renderUnitItem(
            defensePostIcon,
            this._defensePost,
            UnitType.DefensePost,
            "defense post",
          )}
          ${this.renderUnitItem(
            missileSiloIcon,
            this._missileSilo,
            UnitType.MissileSilo,
            "missile silo",
          )}
          ${this.renderUnitItem(
            samLauncherIcon,
            this._samLauncher,
            UnitType.SAMLauncher,
            "SAM launcher",
          )}
        </div>
      </div>
    `;
  }
}
