import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { BuildMenuTypes, Gold, PlayerActions, PlayerBuildableTypes, PlayerBuildableUnitType, UnitType } from "../../../core/game/Game";
import { GameView } from "../../../core/game/GameView";
import {
  GhostStructureChangedEvent,
  ToggleStructureEvent,
} from "../../InputHandler";
import { renderNumber, translateText } from "../../Utils";
import { UIState } from "../UIState";
import { Layer } from "./Layer";
import warshipIcon from "/images/BattleshipIconWhite.svg?url";
import cityIcon from "/images/CityIconWhite.svg?url";
import factoryIcon from "/images/FactoryIconWhite.svg?url";
import goldCoinIcon from "/images/GoldCoinIcon.svg?url";
import mirvIcon from "/images/MIRVIcon.svg?url";
import missileSiloIcon from "/images/MissileSiloIconWhite.svg?url";
import hydrogenBombIcon from "/images/MushroomCloudIconWhite.svg?url";
import atomBombIcon from "/images/NukeIconWhite.svg?url";
import portIcon from "/images/PortIcon.svg?url";
import samLauncherIcon from "/images/SamLauncherIconWhite.svg?url";
import defensePostIcon from "/images/ShieldIconWhite.svg?url";

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

    this.allDisabled = BuildMenuTypes.every((u) => config.isUnitDisabled(u));
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
      case UnitType.AtomBomb:
      case UnitType.HydrogenBomb:
      case UnitType.MIRV:
        return (
          this.cost(item) <= (player?.gold() ?? 0n) &&
          (player?.units(UnitType.MissileSilo).length ?? 0) > 0
        );
      case UnitType.Warship:
        return (
          this.cost(item) <= (player?.gold() ?? 0n) &&
          (player?.units(UnitType.Port).length ?? 0) > 0
        );
      default:
        return this.cost(item) <= (player?.gold() ?? 0n);
    }
  }

  tick() {
    const player = this.game?.myPlayer();
    player?.actions(undefined, BuildMenuTypes).then((actions) => {
      this.playerActions = actions;
    });
    if (!player) return;
    this._cities = player.totalUnitLevels(UnitType.City);
    this._missileSilo = player.totalUnitLevels(UnitType.MissileSilo);
    this._port = player.totalUnitLevels(UnitType.Port);
    this._defensePost = player.totalUnitLevels(UnitType.DefensePost);
    this._samLauncher = player.totalUnitLevels(UnitType.SAMLauncher);
    this._factories = player.totalUnitLevels(UnitType.Factory);
    this._warships = player.totalUnitLevels(UnitType.Warship);
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
        class="hidden min-[1200px]:flex fixed bottom-4 left-1/2 transform -translate-x-1/2 z-[1100] 2xl:flex-row xl:flex-col min-[1200px]:flex-col 2xl:gap-5 xl:gap-2 min-[1200px]:gap-2 justify-center items-center"
      >
        <div class="bg-gray-800/70 backdrop-blur-xs rounded-lg p-0.5">
          <div class="grid grid-rows-1 auto-cols-max grid-flow-col gap-1 w-fit">
            ${this.renderUnitItem(
              cityIcon,
              this._cities,
              UnitType.City,
              "city",
              this.keybinds["buildCity"]?.key ?? "1",
            )}
            ${this.renderUnitItem(
              factoryIcon,
              this._factories,
              UnitType.Factory,
              "factory",
              this.keybinds["buildFactory"]?.key ?? "2",
            )}
            ${this.renderUnitItem(
              portIcon,
              this._port,
              UnitType.Port,
              "port",
              this.keybinds["buildPort"]?.key ?? "3",
            )}
            ${this.renderUnitItem(
              defensePostIcon,
              this._defensePost,
              UnitType.DefensePost,
              "defense_post",
              this.keybinds["buildDefensePost"]?.key ?? "4",
            )}
            ${this.renderUnitItem(
              missileSiloIcon,
              this._missileSilo,
              UnitType.MissileSilo,
              "missile_silo",
              this.keybinds["buildMissileSilo"]?.key ?? "5",
            )}
            ${this.renderUnitItem(
              samLauncherIcon,
              this._samLauncher,
              UnitType.SAMLauncher,
              "sam_launcher",
              this.keybinds["buildSamLauncher"]?.key ?? "6",
            )}
          </div>
        </div>
        <div class="bg-gray-800/70 backdrop-blur-xs rounded-lg p-0.5 w-fit">
          <div class="grid grid-rows-1 auto-cols-max grid-flow-col gap-1">
            ${this.renderUnitItem(
              warshipIcon,
              this._warships,
              UnitType.Warship,
              "warship",
              this.keybinds["buildWarship"]?.key ?? "7",
            )}
            ${this.renderUnitItem(
              atomBombIcon,
              null,
              UnitType.AtomBomb,
              "atom_bomb",
              this.keybinds["buildAtomBomb"]?.key ?? "8",
            )}
            ${this.renderUnitItem(
              hydrogenBombIcon,
              null,
              UnitType.HydrogenBomb,
              "hydrogen_bomb",
              this.keybinds["buildHydrogenBomb"]?.key ?? "9",
            )}
            ${this.renderUnitItem(
              mirvIcon,
              null,
              UnitType.MIRV,
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
    unitType: PlayerBuildableUnitType,
    structureKey: string,
    hotkey: string,
  ) {
    if (this.game.config().isUnitDisabled(unitType)) {
      return html``;
    }
    const selected = this.uiState.ghostStructure === unitType;
    const hovered = this._hoveredUnit === unitType;
    const displayHotkey = hotkey
      .replace("Digit", "")
      .replace("Key", "")
      .toUpperCase();

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
                class="absolute -top-[250%] left-1/2 -translate-x-1/2 text-gray-200 text-center w-max text-xs bg-gray-800/90 backdrop-blur-xs rounded-sm p-1 z-20 shadow-lg pointer-events-none"
              >
                <div class="font-bold text-sm mb-1">
                  ${translateText(
                    "unit_type." + structureKey,
                  )}${` [${displayHotkey}]`}
                </div>
                <div class="p-2">
                  ${translateText("build_menu.desc." + structureKey)}
                </div>
                <div class="flex items-center justify-center gap-1">
                  <img src=${goldCoinIcon} width="13" height="13" />
                  <span class="text-yellow-300"
                    >${renderNumber(this.cost(unitType))}</span
                  >
                </div>
              </div>
            `
          : null}
        <div
          class="${this.canBuild(unitType)
            ? ""
            : "opacity-40"} border border-slate-500 rounded-sm pr-2 pb-1 flex items-center gap-2 cursor-pointer
             ${selected ? "hover:bg-gray-400/10" : "hover:bg-gray-800"}
             rounded-sm text-white ${selected ? "bg-slate-400/20" : ""}"
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
              case UnitType.AtomBomb:
              case UnitType.HydrogenBomb:
                this.eventBus?.emit(
                  new ToggleStructureEvent([
                    UnitType.MissileSilo,
                    UnitType.SAMLauncher,
                  ]),
                );
                break;
              case UnitType.Warship:
                this.eventBus?.emit(new ToggleStructureEvent([UnitType.Port]));
                break;
              default:
                this.eventBus?.emit(new ToggleStructureEvent([unitType]));
            }
          }}
          @mouseleave=${() =>
            this.eventBus?.emit(new ToggleStructureEvent(null))}
        >
          ${html`<div class="ml-1 text-xs relative -top-1.5 text-gray-400">
            ${displayHotkey}
          </div>`}
          <div class="flex items-center gap-1 pt-1">
            <img src=${icon} alt=${structureKey} class="align-middle size-6" />
            ${number !== null ? renderNumber(number) : null}
          </div>
        </div>
      </div>
    `;
  }
}
