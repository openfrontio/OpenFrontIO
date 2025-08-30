import { LitElement, html } from "lit";
import { EventBus } from "../../../core/EventBus";
import { GameView } from "../../../core/game/GameView";
import { Layer } from "./Layer";
import { ToggleStructureEvent } from "../../InputHandler";
import { UnitType } from "../../../core/game/Game";
import cityIcon from "../../../../resources/images/CityIconWhite.svg";
import { customElement } from "lit/decorators.js";
import defensePostIcon from "../../../../resources/images/ShieldIconWhite.svg";
import factoryIcon from "../../../../resources/images/FactoryIconWhite.svg";
import missileSiloIcon from "../../../../resources/images/MissileSiloUnit.png";
import portIcon from "../../../../resources/images/AnchorIcon.png";
import { renderNumber } from "../../Utils";
import samLauncherIcon from "../../../../resources/non-commercial/svg/SamLauncherIconWhite.svg";

@customElement("unit-display")
export class UnitDisplay extends LitElement implements Layer {
  public game: GameView | undefined;
  public eventBus: EventBus | undefined;
  private readonly _selectedStructure: UnitType | null = null;
  private _cities = 0;
  private _factories = 0;
  private _missileSilo = 0;
  private _port = 0;
  private _defensePost = 0;
  private _samLauncher = 0;
  private allDisabled = false;

  createRenderRoot() {
    return this;
  }

  init() {
    if (this.game === undefined) throw new Error("Not initialized");
    const config = this.game.config();
    this.allDisabled =
      config.isUnitDisabled(UnitType.City) &&
      config.isUnitDisabled(UnitType.Factory) &&
      config.isUnitDisabled(UnitType.Port) &&
      config.isUnitDisabled(UnitType.DefensePost) &&
      config.isUnitDisabled(UnitType.MissileSilo) &&
      config.isUnitDisabled(UnitType.SAMLauncher);
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
    if (this.game === undefined) throw new Error("Not initialized");
    if (this.game.config().isUnitDisabled(unitType)) {
      return html``;
    }

    return html`
      <div
        class="px-2 flex items-center gap-2 cursor-pointer rounded"
        style="
          background: ${this._selectedStructure === unitType
            ? "rgba(74, 103, 65, 0.4)"
            : "rgba(42, 42, 42, 0.3)"};
          color: #f0f0f0;
          border: 1px solid ${this._selectedStructure === unitType
            ? "rgba(74, 103, 65, 0.8)"
            : "rgba(74, 103, 65, 0.4)"};
          transition: all 0.2s ease;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        "
        @mouseenter="${(e: MouseEvent) => {
          const target = e.currentTarget as HTMLElement;
          target.style.background = "rgba(74, 103, 65, 0.5)";
          target.style.borderColor = "rgba(74, 103, 65, 0.9)";
          this.eventBus?.emit(new ToggleStructureEvent(unitType));
        }}"
        @mouseleave="${(e: MouseEvent) => {
          const target = e.currentTarget as HTMLElement;
          target.style.background = this._selectedStructure === unitType
            ? "rgba(74, 103, 65, 0.4)"
            : "rgba(42, 42, 42, 0.3)";
          target.style.borderColor = this._selectedStructure === unitType
            ? "rgba(74, 103, 65, 0.8)"
            : "rgba(74, 103, 65, 0.4)";
          this.eventBus?.emit(new ToggleStructureEvent(null));
        }}"
      >
        <img
          src=${icon}
          alt=${altText}
          width="20"
          height="20"
          style="vertical-align: middle; filter: drop-shadow(0 0 4px rgba(74, 103, 65, 0.6));"
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

    if (this.allDisabled) {
      return null;
    }

    return html`
      <div
        class="fixed bottom-4 left-1/2 transform -translate-x-1/2 z-[1100] rounded-lg p-2 hidden lg:block"
        style="
          background: rgba(26, 26, 26, 0.85);
          backdrop-filter: blur(8px);
          border: 2px solid rgba(74, 103, 65, 0.6);
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(74, 103, 65, 0.2);
        "
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
