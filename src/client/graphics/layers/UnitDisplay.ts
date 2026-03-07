import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
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

const BUILDABLE_UNITS: UnitType[] = [
  UnitType.City,
  UnitType.Factory,
  UnitType.Port,
  UnitType.DefensePost,
  UnitType.MissileSilo,
  UnitType.SAMLauncher,
  UnitType.Warship,
  UnitType.AtomBomb,
  UnitType.HydrogenBomb,
  UnitType.MIRV,
];

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
  private _hoveredStructureKey: string | null = null;
  private _hoveredDisplayHotkey: string | null = null;

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

    this.allDisabled = BUILDABLE_UNITS.every((u) => config.isUnitDisabled(u));
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
    player?.actions(undefined, BUILDABLE_UNITS).then((actions) => {
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

    const hoveredTooltip =
      this._hoveredUnit !== null &&
      this._hoveredStructureKey !== null &&
      this._hoveredDisplayHotkey !== null
        ? html`
            <div
              class="fixed top-[22rem] left-4 text-gray-200 text-center w-max text-xs bg-gray-800/95 backdrop-blur-xs rounded-sm p-1 z-[5000] shadow-lg pointer-events-none border border-white/10"
            >
              <div class="font-bold text-sm mb-1">
                ${translateText("unit_type." + this._hoveredStructureKey)}${` [${this
                  ._hoveredDisplayHotkey}]`}
              </div>
              <div class="p-2">
                ${translateText(
                  "build_menu.desc." + this._hoveredStructureKey,
                )}
              </div>
              <div class="flex items-center justify-center gap-1">
                <img src=${goldCoinIcon} width="13" height="13" />
                <span class="text-yellow-300"
                  >${renderNumber(this.cost(this._hoveredUnit))}</span
                >
              </div>
            </div>
          `
        : null;

    return html`
      ${hoveredTooltip}
      <div
        class="hidden min-[1200px]:flex -mt-px"
      >
        <div class="bg-gray-800/70 backdrop-blur-xs rounded-b-lg p-0.5 w-full border-t border-white/10">
          <div class="grid grid-rows-1 auto-cols-max grid-flow-col gap-0.5 w-fit mx-auto">
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
            <div class="w-px h-7 bg-white/15 mx-0.5 self-center"></div>
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
    unitType: UnitType,
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
          this._hoveredStructureKey = structureKey;
          this._hoveredDisplayHotkey = displayHotkey;
          this.requestUpdate();
        }}
        @mouseleave=${() => {
          this._hoveredUnit = null;
          this._hoveredStructureKey = null;
          this._hoveredDisplayHotkey = null;
          this.requestUpdate();
        }}
      >
        ${hovered ? html`` : null}
        <div
          class="${this.canBuild(unitType)
            ? ""
            : "opacity-40"} border border-slate-500 rounded-sm pr-1 pb-0.5 flex items-center gap-1 cursor-pointer
             ${selected ? "hover:bg-gray-400/10" : "hover:bg-gray-800"}
             rounded-sm text-white text-xs ${selected ? "bg-slate-400/20" : ""}"
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
          ${html`<div class="ml-1 text-[10px] relative -top-1 text-gray-400">
            ${displayHotkey}
          </div>`}
          <div class="flex items-center gap-1 pt-1">
            <img
              src=${icon}
              alt=${structureKey}
              class="align-middle w-[20px] h-[20px]"
            />
            ${number !== null ? renderNumber(number) : null}
          </div>
        </div>
      </div>
    `;
  }
}
