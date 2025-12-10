import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import warshipIcon from "../../../../resources/images/BattleshipIconWhite.svg";
import cityIcon from "../../../../resources/images/CityIconWhite.svg";
import factoryIcon from "../../../../resources/images/FactoryIconWhite.svg";
import mirvIcon from "../../../../resources/images/MIRVIcon.svg";
import missileSiloIcon from "../../../../resources/images/MissileSiloIconWhite.svg";
import hydrogenBombIcon from "../../../../resources/images/MushroomCloudIconWhite.svg";
import atomBombIcon from "../../../../resources/images/NukeIconWhite.svg";
import portIcon from "../../../../resources/images/PortIcon.svg";
import samLauncherIcon from "../../../../resources/images/SamLauncherIconWhite.svg";
import defensePostIcon from "../../../../resources/images/ShieldIconWhite.svg";
import { EventBus } from "../../../core/EventBus";
import { Gold, PlayerActions, UnitType } from "../../../core/game/Game";
import { GameView } from "../../../core/game/GameView";
import {
  GhostStructureChangedEvent,
  ToggleStructureEvent,
} from "../../InputHandler";
import { renderNumber, translateText } from "../../Utils";
import { UIState } from "../UIState";
import { Layer } from "./Layer";

@customElement("unit-display")
export class UnitDisplay extends LitElement implements Layer {
  public game: GameView;
  public eventBus: EventBus;
  public uiState: UIState;
  private playerActions: PlayerActions | null = null;
  private keybinds: Record<string, { value: string; key: string }> = {};
  private _cities = 0;
  private _warships = 0;
  private _factories = 0;
  private _missileSilo = 0;
  private _port = 0;
  private _defensePost = 0;
  private _samLauncher = 0;
  private allDisabled = false;
  private _hoveredUnit: UnitType | null = null;

  createRenderRoot() {
    return this;
  }

  init() {
    const config = this.game.config();

    const savedKeybinds = localStorage.getItem("settings.keybinds");
    if (savedKeybinds) {
      try {
        this.keybinds = JSON.parse(savedKeybinds);
      } catch (e) {
        console.warn("Invalid keybinds JSON:", e);
      }
    }

    this.allDisabled =
      config.isUnitDisabled("City") &&
      config.isUnitDisabled("Factory") &&
      config.isUnitDisabled("Port") &&
      config.isUnitDisabled("Defense Post") &&
      config.isUnitDisabled("Missile Silo") &&
      config.isUnitDisabled("SAM Launcher") &&
      config.isUnitDisabled("Warship") &&
      config.isUnitDisabled("Atom Bomb") &&
      config.isUnitDisabled("Hydrogen Bomb") &&
      config.isUnitDisabled("MIRV");
    this.requestUpdate();
  }

  private cost(item: UnitType): Gold {
    for (const bu of this.playerActions?.buildableUnits ?? []) {
      if (bu.type === item) {
        return bu.cost;
      }
    }
    return 0n;
  }

  private canBuild(item: UnitType): boolean {
    if (this.game?.config().isUnitDisabled(item)) return false;
    const player = this.game?.myPlayer();
    switch (item) {
      case "Atom Bomb":
      case "Hydrogen Bomb":
      case "MIRV":
        return (
          this.cost(item) <= (player?.gold() ?? 0n) &&
          (player?.units("Missile Silo").length ?? 0) > 0
        );
      case "Warship":
        return (
          this.cost(item) <= (player?.gold() ?? 0n) &&
          (player?.units("Port").length ?? 0) > 0
        );
      default:
        return this.cost(item) <= (player?.gold() ?? 0n);
    }
  }

  tick() {
    const player = this.game?.myPlayer();
    player?.actions().then((actions) => {
      this.playerActions = actions;
    });
    if (!player) return;
    this._cities = player.totalUnitLevels("City");
    this._missileSilo = player.totalUnitLevels("Missile Silo");
    this._port = player.totalUnitLevels("Port");
    this._defensePost = player.totalUnitLevels("Defense Post");
    this._samLauncher = player.totalUnitLevels("SAM Launcher");
    this._factories = player.totalUnitLevels("Factory");
    this._warships = player.totalUnitLevels("Warship");
    this.requestUpdate();
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
        class="hidden 2xl:flex lg:flex fixed bottom-4 left-1/2 transform -translate-x-1/2 z-[1100] 2xl:flex-row xl:flex-col lg:flex-col 2xl:gap-5 xl:gap-2 lg:gap-2 justify-center items-center"
      >
        <div class="bg-gray-800/70 backdrop-blur-sm rounded-lg p-0.5">
          <div class="grid grid-rows-1 auto-cols-max grid-flow-col gap-1 w-fit">
            ${this.renderUnitItem(
              cityIcon,
              this._cities,
              "City",
              "city",
              this.keybinds["buildCity"]?.key ?? "1",
            )}
            ${this.renderUnitItem(
              factoryIcon,
              this._factories,
              "Factory",
              "factory",
              this.keybinds["buildFactory"]?.key ?? "2",
            )}
            ${this.renderUnitItem(
              portIcon,
              this._port,
              "Port",
              "port",
              this.keybinds["buildPort"]?.key ?? "3",
            )}
            ${this.renderUnitItem(
              defensePostIcon,
              this._defensePost,
              "Defense Post",
              "defense_post",
              this.keybinds["buildDefensePost"]?.key ?? "4",
            )}
            ${this.renderUnitItem(
              missileSiloIcon,
              this._missileSilo,
              "Missile Silo",
              "missile_silo",
              this.keybinds["buildMissileSilo"]?.key ?? "5",
            )}
            ${this.renderUnitItem(
              samLauncherIcon,
              this._samLauncher,
              "SAM Launcher",
              "sam_launcher",
              this.keybinds["buildSamLauncher"]?.key ?? "6",
            )}
          </div>
        </div>
        <div class="bg-gray-800/70 backdrop-blur-sm rounded-lg p-0.5 w-fit">
          <div class="grid grid-rows-1 auto-cols-max grid-flow-col gap-1">
            ${this.renderUnitItem(
              warshipIcon,
              this._warships,
              "Warship",
              "warship",
              this.keybinds["buildWarship"]?.key ?? "7",
            )}
            ${this.renderUnitItem(
              atomBombIcon,
              null,
              "Atom Bomb",
              "atom_bomb",
              this.keybinds["buildAtomBomb"]?.key ?? "8",
            )}
            ${this.renderUnitItem(
              hydrogenBombIcon,
              null,
              "Hydrogen Bomb",
              "hydrogen_bomb",
              this.keybinds["buildHydrogenBomb"]?.key ?? "9",
            )}
            ${this.renderUnitItem(
              mirvIcon,
              null,
              "MIRV",
              "mirv",
              this.keybinds["buildMIRV"]?.key ?? "0",
            )}
          </div>
        </div>
      </div>
    `;
  }

  private renderUnitItem(
    icon: string,
    number: number | null,
    unitType: UnitType,
    structureKey: string,
    hotkey: string,
  ) {
    if (this.game.config().isUnitDisabled(unitType)) {
      return html``;
    }
    const selected = this.uiState.ghostStructure === unitType;
    const hovered = this._hoveredUnit === unitType;

    return html`
      <div
        class="flex flex-col items-center relative"
        @mouseenter=${() => {
          this._hoveredUnit = unitType;
          this.requestUpdate();
        }}
        @mouseleave=${() => {
          this._hoveredUnit = null;
          this.requestUpdate();
        }}
      >
        ${hovered
          ? html`
              <div
                class="absolute -top-[250%] left-1/2 -translate-x-1/2 text-gray-200 text-center w-max text-xs bg-gray-800/90 backdrop-blur-sm rounded p-1 z-20 shadow-lg pointer-events-none"
              >
                <div class="font-bold text-sm mb-1">
                  ${translateText(
                    "unit_type." + structureKey,
                  )}${` [${hotkey.toUpperCase()}]`}
                </div>
                <div class="p-2">
                  ${translateText("build_menu.desc." + structureKey)}
                </div>
                <div>
                  <span class="text-yellow-300"
                    >${renderNumber(this.cost(unitType))}</span
                  >
                  ${translateText("player_info_overlay.gold")}
                </div>
              </div>
            `
          : null}
        <div
          class="${this.canBuild(unitType)
            ? ""
            : "opacity-40"} border border-slate-500 rounded pr-2 pb-1 flex items-center gap-2 cursor-pointer 
             ${selected ? "hover:bg-gray-400/10" : "hover:bg-gray-800"}
             rounded text-white ${selected ? "bg-slate-400/20" : ""}"
          @click=${() => {
            if (selected) {
              this.uiState.ghostStructure = null;
              this.eventBus?.emit(new GhostStructureChangedEvent(null));
            } else if (this.canBuild(unitType)) {
              this.uiState.ghostStructure = unitType;
              this.eventBus?.emit(new GhostStructureChangedEvent(unitType));
            }
            this.requestUpdate();
          }}
          @mouseenter=${() => {
            switch (unitType) {
              case "Atom Bomb":
              case "Hydrogen Bomb":
                this.eventBus?.emit(
                  new ToggleStructureEvent(["Missile Silo", "SAM Launcher"]),
                );
                break;
              case "Warship":
                this.eventBus?.emit(new ToggleStructureEvent(["Port"]));
                break;
              default:
                this.eventBus?.emit(new ToggleStructureEvent([unitType]));
            }
          }}
          @mouseleave=${() =>
            this.eventBus?.emit(new ToggleStructureEvent(null))}
        >
          ${html`<div class="ml-1 text-xs relative -top-1.5 text-gray-400">
            ${hotkey.toUpperCase()}
          </div>`}
          <div class="flex items-center gap-1 pt-1">
            <img
              src=${icon}
              alt=${structureKey}
              style="vertical-align: middle; width: 24px; height: 24px;"
            />
            ${number !== null ? renderNumber(number) : null}
          </div>
        </div>
      </div>
    `;
  }
}
