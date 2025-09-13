import { html, LitElement } from "lit";
import { customElement } from "lit/decorators.js";
import portIcon from "../../../../resources/images/AnchorIcon.png";
import battleshipIcon from "../../../../resources/images/BattleshipIconWhite.svg";
import boatIcon from "../../../../resources/images/BoatIconWhite.png";
import cityIcon from "../../../../resources/images/CityIconWhite.svg";
import factoryIcon from "../../../../resources/images/FactoryIconWhite.svg";
import missileSiloIcon from "../../../../resources/images/MissileSiloUnit.png";
import samLauncherIcon from "../../../../resources/images/SamLauncherIconWhite.svg";
import defensePostIcon from "../../../../resources/images/ShieldIconWhite.svg";
import { EventBus } from "../../../core/EventBus";
import { UnitType } from "../../../core/game/Game";
import { GameView } from "../../../core/game/GameView";
import { ToggleStructureEvent } from "../../InputHandler";
import { renderNumber, translateText } from "../../Utils";
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
  private _transportShips = 0;
  private _warships = 0;
  private allDisabled = false;

  createRenderRoot() {
    return this;
  }

  init() {
    const config = this.game.config();
    this.allDisabled =
      config.isUnitDisabled(UnitType.City) &&
      config.isUnitDisabled(UnitType.Factory) &&
      config.isUnitDisabled(UnitType.Port) &&
      config.isUnitDisabled(UnitType.DefensePost) &&
      config.isUnitDisabled(UnitType.MissileSilo) &&
      config.isUnitDisabled(UnitType.SAMLauncher) &&
      config.isUnitDisabled(UnitType.TransportShip) &&
      config.isUnitDisabled(UnitType.Warship);
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
    this._transportShips = player.totalUnitLevels(UnitType.TransportShip);
    this._warships = player.totalUnitLevels(UnitType.Warship);
    this.requestUpdate();
  }

  /**
   * Renders a unit item. If a limit is provided (current/max) it will render
   * the remaining/maximum style used by transports (e.g. "2 / 5").
   *
   * To display limits for other units, pass the `limit` object. Example:
   * renderUnitItem(..., { current: owned, max: allowed })
   */
  private renderUnitItem(
    icon: string,
    number: number,
    unitType: UnitType,
    unitKey: string,
    limit?: { current: number; max: number },
  ) {
    if (this.game.config().isUnitDisabled(unitType)) {
      return html``;
    }

    const hasLimit =
      !!limit &&
      typeof limit.current === "number" &&
      typeof limit.max === "number";
    const label = translateText(`unit_type.${unitKey}`);

    return html`
      <div
        class="px-2 flex items-center gap-2 cursor-pointer hover:bg-slate-700/50 rounded text-white"
        style="background: ${this._selectedStructure === unitType
          ? "#ffffff2e"
          : "none"}"
        title="${label}${hasLimit
          ? `: ${limit!.max - limit!.current}/${limit!.max}`
          : `: ${number}`}"
        @mouseenter="${() =>
          this.eventBus.emit(new ToggleStructureEvent(unitType))}"
        @mouseleave="${() =>
          this.eventBus.emit(new ToggleStructureEvent(null))}"
      >
        <img
          src=${icon}
          alt=${label}
          width="20"
          height="20"
          style="vertical-align: middle;"
        />
        ${hasLimit
          ? html`${renderNumber(limit!.max - limit!.current)} /
            ${renderNumber(limit!.max)}`
          : renderNumber(number)}
      </div>
    `;
  }

  // Note: transport-specific limit display is handled by passing a `limit`
  // object to `renderUnitItem` (see usage below). If other units ever have
  // similar limits (e.g. factory build slots), pass a limit object there too.

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

    if (this.allDisabled) {
      return null;
    }

    return html`
      <div
        class="fixed bottom-4 left-1/2 transform -translate-x-1/2 z-[1100] bg-gray-800/70 backdrop-blur-sm border border-slate-400 rounded-lg p-2 hidden lg:block"
      >
        <div class="flex flex-col gap-2">
          <!-- Structures box (no port) -->
          <div class="grid grid-flow-col auto-cols-max gap-1 items-center">
            ${this.renderUnitItem(
              cityIcon,
              this._cities,
              UnitType.City,
              "city",
            )}
            ${this.renderUnitItem(
              factoryIcon,
              this._factories,
              UnitType.Factory,
              "factory",
            )}
            ${this.renderUnitItem(
              defensePostIcon,
              this._defensePost,
              UnitType.DefensePost,
              "defense_post",
            )}
            ${this.renderUnitItem(
              missileSiloIcon,
              this._missileSilo,
              UnitType.MissileSilo,
              "missile_silo",
            )}
            ${this.renderUnitItem(
              samLauncherIcon,
              this._samLauncher,
              UnitType.SAMLauncher,
              "sam_launcher",
            )}
          </div>

          <!-- Naval box: Port + Transport + Warship -->
          <div class="grid grid-flow-col auto-cols-max gap-1 items-center">
            ${this.renderUnitItem(portIcon, this._port, UnitType.Port, "port")}
            ${(() => {
              const current = this._transportShips;
              const max = this.game.config().boatMaxNumber();
              return this.renderUnitItem(
                boatIcon,
                current,
                UnitType.TransportShip,
                "transport_ship",
                { current, max },
              );
            })()}
            ${this.renderUnitItem(
              battleshipIcon,
              this._warships,
              UnitType.Warship,
              "warship",
            )}
          </div>
        </div>
      </div>
    `;
  }
}
