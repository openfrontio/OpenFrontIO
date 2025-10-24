import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import warshipIcon from "../../../../resources/images/BattleshipIconWhite.svg";
import cityIcon from "../../../../resources/images/CityIconWhite.svg";
import factoryIcon from "../../../../resources/images/FactoryIconWhite.svg";
import goldCoinIcon from "../../../../resources/images/GoldCoinIcon.svg";
import mirvIcon from "../../../../resources/images/MIRVIcon.svg";
import missileSiloIcon from "../../../../resources/images/MissileSiloIconWhite.svg";
import hydrogenBombIcon from "../../../../resources/images/MushroomCloudIconWhite.svg";
import atomBombIcon from "../../../../resources/images/NukeIconWhite.svg";
import portIcon from "../../../../resources/images/PortIcon.svg";
import samlauncherIcon from "../../../../resources/images/SamLauncherIconWhite.svg";
import shieldIcon from "../../../../resources/images/ShieldIconWhite.svg";
import { translateText } from "../../../client/Utils";
import { EventBus } from "../../../core/EventBus";
import {
  BuildableUnit,
  Gold,
  PlayerActions,
  UnitType,
} from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { GameView } from "../../../core/game/GameView";
import {
  CloseViewEvent,
  MouseDownEvent,
  ShowBuildMenuEvent,
  ShowEmojiMenuEvent,
} from "../../InputHandler";
import {
  BuildUnitIntentEvent,
  SendUpgradeStructureIntentEvent,
} from "../../Transport";
import { renderNumber } from "../../Utils";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

export interface BuildItemDisplay {
  unitType: UnitType;
  icon: string;
  description?: string;
  key?: string;
  countable?: boolean;
}

export const buildTable: BuildItemDisplay[][] = [
  [
    {
      unitType: UnitType.AtomBomb,
      icon: atomBombIcon,
      description: "build_menu.desc.atom_bomb",
      key: "unit_type.atom_bomb",
      countable: false,
    },
    {
      unitType: UnitType.MIRV,
      icon: mirvIcon,
      description: "build_menu.desc.mirv",
      key: "unit_type.mirv",
      countable: false,
    },
    {
      unitType: UnitType.HydrogenBomb,
      icon: hydrogenBombIcon,
      description: "build_menu.desc.hydrogen_bomb",
      key: "unit_type.hydrogen_bomb",
      countable: false,
    },
    {
      unitType: UnitType.Warship,
      icon: warshipIcon,
      description: "build_menu.desc.warship",
      key: "unit_type.warship",
      countable: true,
    },
    {
      unitType: UnitType.Port,
      icon: portIcon,
      description: "build_menu.desc.port",
      key: "unit_type.port",
      countable: true,
    },
    {
      unitType: UnitType.MissileSilo,
      icon: missileSiloIcon,
      description: "build_menu.desc.missile_silo",
      key: "unit_type.missile_silo",
      countable: true,
    },
    // needs new icon
    {
      unitType: UnitType.SAMLauncher,
      icon: samlauncherIcon,
      description: "build_menu.desc.sam_launcher",
      key: "unit_type.sam_launcher",
      countable: true,
    },
    {
      unitType: UnitType.DefensePost,
      icon: shieldIcon,
      description: "build_menu.desc.defense_post",
      key: "unit_type.defense_post",
      countable: true,
    },
    {
      unitType: UnitType.City,
      icon: cityIcon,
      description: "build_menu.desc.city",
      key: "unit_type.city",
      countable: true,
    },
    {
      unitType: UnitType.Factory,
      icon: factoryIcon,
      description: "build_menu.desc.factory",
      key: "unit_type.factory",
      countable: true,
    },
  ],
];

export const flattenedBuildTable = buildTable.flat();

/**
 * Build menu overlay that surfaces all structures/units a player can spawn on
 * the currently selected tile. It handles affordability highlighting, counts,
 * and dispatches the appropriate build/upgrade intents.
 */
@customElement("build-menu")
export class BuildMenu extends LitElement implements Layer {
  public game: GameView;
  public eventBus: EventBus;
  private clickedTile: TileRef;
  public playerActions: PlayerActions | null;
  private filteredBuildTable: BuildItemDisplay[][] = buildTable;
  public transformHandler: TransformHandler;

  /**
   * Subscribes to build menu related events and toggles the menu visibility in
   * response to input handler signals.
   */
  init() {
    this.eventBus.on(ShowBuildMenuEvent, (e) => {
      if (!this.game.myPlayer()?.isAlive()) {
        return;
      }
      if (!this._hidden) {
        // Players sometimes hold control while building a unit,
        // so if the menu is already open, ignore the event.
        return;
      }
      const clickedCell = this.transformHandler.screenToWorldCoordinates(
        e.x,
        e.y,
      );
      if (clickedCell === null) {
        return;
      }
      if (!this.game.isValidCoord(clickedCell.x, clickedCell.y)) {
        return;
      }
      const tile = this.game.ref(clickedCell.x, clickedCell.y);
      this.showMenu(tile);
    });
    this.eventBus.on(CloseViewEvent, () => this.hideMenu());
    this.eventBus.on(ShowEmojiMenuEvent, () => this.hideMenu());
    this.eventBus.on(MouseDownEvent, () => this.hideMenu());
  }

  /**
   * Refreshes build actions while the menu is visible so that gold totals and
   * action availability stay in sync with the current game tick.
   */
  tick() {
    if (!this._hidden) {
      this.refresh();
    }
  }

  static styles = css`
    :host {
      display: block;
    }
    .build-menu {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      z-index: 9999;
      background-color: #1e1e1e;
      padding: 15px;
      box-shadow: 0 0 20px rgba(0, 0, 0, 0.5);
      border-radius: 10px;
      display: flex;
      flex-direction: column;
      align-items: center;
      max-width: 95vw;
      max-height: 95vh;
      overflow-y: auto;
    }
    .build-description {
      font-size: 0.6rem;
    }
    .build-row {
      display: flex;
      justify-content: center;
      flex-wrap: wrap;
      width: 100%;
    }
    .build-button {
      position: relative;
      width: 120px;
      height: 140px;
      border: 2px solid #444;
      background-color: #2c2c2c;
      color: white;
      border-radius: 12px;
      cursor: pointer;
      transition: all 0.3s ease;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      margin: 8px;
      padding: 10px;
      gap: 5px;
    }
    .build-button--available {
      border-color: rgba(251, 191, 36, 0.7);
      box-shadow: 0 0 12px rgba(251, 191, 36, 0.35);
    }
    .build-button:not(:disabled):hover {
      background-color: #3a3a3a;
      transform: scale(1.05);
      border-color: #666;
    }
    .build-button:not(:disabled):active {
      background-color: #4a4a4a;
      transform: scale(0.95);
    }
    .build-button:disabled {
      background-color: #1a1a1a;
      border-color: #333;
      cursor: not-allowed;
      opacity: 0.7;
    }
    .build-button:disabled img {
      opacity: 0.5;
    }
    .build-button:disabled .build-cost {
      color: #ff4444;
    }
    .build-button--available .build-cost {
      color: #fbbf24;
    }
    .build-icon {
      font-size: 40px;
      margin-bottom: 5px;
    }
    .build-name {
      font-size: 14px;
      font-weight: bold;
      margin-bottom: 5px;
      text-align: center;
    }
    .build-cost {
      font-size: 14px;
    }
    .build-affordable {
      position: absolute;
      bottom: 8px;
      right: 10px;
      padding: 2px 8px;
      font-size: 0.7rem;
      font-weight: 600;
      border-radius: 9999px;
      background-color: rgba(251, 191, 36, 0.18);
      color: #fbbf24;
      letter-spacing: 0.02em;
    }
    .hidden {
      display: none !important;
    }
    .build-count-chip {
      position: absolute;
      top: -10px;
      right: -10px;
      background-color: #2c2c2c;
      color: white;
      padding: 2px 10px;
      border-radius: 10000px;
      transition: all 0.3s ease;
      font-size: 12px;
      display: flex;
      justify-content: center;
      align-content: center;
      border: 1px solid #444;
    }
    .build-button:not(:disabled):hover > .build-count-chip {
      background-color: #3a3a3a;
      border-color: #666;
    }
    .build-button:not(:disabled):active > .build-count-chip {
      background-color: #4a4a4a;
    }
    .build-button:disabled > .build-count-chip {
      background-color: #1a1a1a;
      border-color: #333;
      cursor: not-allowed;
    }
    .build-count {
      font-weight: bold;
      font-size: 14px;
    }

    @media (max-width: 768px) {
      .build-menu {
        padding: 10px;
        max-height: 80vh;
        width: 80vw;
      }
      .build-button {
        width: 140px;
        height: 120px;
        margin: 4px;
        padding: 6px;
        gap: 5px;
      }
      .build-icon {
        font-size: 28px;
      }
      .build-name {
        font-size: 12px;
        margin-bottom: 3px;
      }
      .build-cost {
        font-size: 11px;
      }
      .build-count {
        font-weight: bold;
        font-size: 10px;
      }
      .build-count-chip {
        padding: 1px 5px;
      }
    }

    @media (max-width: 480px) {
      .build-menu {
        padding: 8px;
        max-height: 70vh;
      }
      .build-button {
        width: calc(50% - 6px);
        height: 100px;
        margin: 3px;
        padding: 4px;
        border-width: 1px;
      }
      .build-icon {
        font-size: 24px;
      }
      .build-name {
        font-size: 10px;
        margin-bottom: 2px;
      }
      .build-cost {
        font-size: 9px;
      }
      .build-count {
        font-weight: bold;
        font-size: 8px;
      }
      .build-count-chip {
        padding: 0 3px;
      }
      .build-button img {
        width: 24px;
        height: 24px;
      }
      .build-cost img {
        width: 10px;
        height: 10px;
      }
    }
  `;

  @state()
  private _hidden = true;

  /**
   * Returns whether the player can build or upgrade the unit represented by
   * the supplied display item.
   */
  public canBuildOrUpgrade(item: BuildItemDisplay): boolean {
    if (this.game?.myPlayer() === null || this.playerActions === null) {
      return false;
    }
    const buildableUnits = this.playerActions?.buildableUnits ?? [];
    const unit = buildableUnits.filter((u) => u.type === item.unitType);
    if (unit.length === 0) {
      return false;
    }
    return unit[0].canBuild !== false || unit[0].canUpgrade !== false;
  }

  /**
   * Looks up the gold cost for the given build menu item.
   */
  public cost(item: BuildItemDisplay): Gold {
    for (const bu of this.playerActions?.buildableUnits ?? []) {
      if (bu.type === item.unitType) {
        return bu.cost;
      }
    }
    return 0n;
  }

  /**
   * Outputs the current number of owned instances (across levels) for the
   * given unit type.
   */
  public count(item: BuildItemDisplay): string {
    const player = this.game?.myPlayer();
    if (!player) {
      return "?";
    }

    return player.totalUnitLevels(item.unitType).toString();
  }

  /**
   * Sends an intent event either to upgrade an existing structure or build a
   * new one on the specified tile.
   */
  public sendBuildOrUpgrade(buildableUnit: BuildableUnit, tile: TileRef): void {
    if (buildableUnit.canUpgrade !== false) {
      this.eventBus.emit(
        new SendUpgradeStructureIntentEvent(
          buildableUnit.canUpgrade,
          buildableUnit.type,
        ),
      );
    } else if (buildableUnit.canBuild) {
      this.eventBus.emit(new BuildUnitIntentEvent(buildableUnit.type, tile));
    }
    this.hideMenu();
  }

  /**
   * Computes the "×N" badge that indicates how many copies a player can afford
   * with their current gold. Returns `null` when no badge should be rendered.
   */
  private affordableCountLabel(
    item: BuildItemDisplay,
    buildableUnit: BuildableUnit,
  ): string | null {
    const player = this.game?.myPlayer();
    if (!player) {
      return null;
    }

    if (buildableUnit.canBuild === false) {
      return null;
    }

    const cost = this.cost(item);
    if (cost <= 0n) {
      return null;
    }

    const gold = player.gold();
    if (gold < cost) {
      return null;
    }

    const affordable = gold / cost;
    if (affordable <= 1n) {
      return null;
    }
    if (affordable > 99n) {
      return "×99+";
    }
    return `×${affordable.toString()}`;
  }

  render() {
    return html`
      <div
        class="build-menu ${this._hidden ? "hidden" : ""}"
        @contextmenu=${(e: MouseEvent) => e.preventDefault()}
      >
        ${this.filteredBuildTable.map(
          (row) => html`
            <div class="build-row">
              ${row.map((item) => {
                const buildableUnit = this.playerActions?.buildableUnits.find(
                  (bu) => bu.type === item.unitType,
                );
                if (buildableUnit === undefined) {
                  return html``;
                }
                const enabled =
                  buildableUnit.canBuild !== false ||
                  buildableUnit.canUpgrade !== false;
                const affordability = this.affordableCountLabel(
                  item,
                  buildableUnit,
                );
                const buttonClass = `build-button${
                  affordability ? " build-button--available" : ""
                }`;
                const showMoneyWarning =
                  !enabled && buildableUnit.canBuild !== false;
                return html`
                  <button
                    class=${buttonClass}
                    @click=${() =>
                      this.sendBuildOrUpgrade(buildableUnit, this.clickedTile)}
                    ?disabled=${!enabled}
                    title=${!enabled
                      ? showMoneyWarning
                        ? translateText("build_menu.not_enough_money")
                        : translateText("build_menu.unavailable")
                      : ""}
                  >
                    <img
                      src=${item.icon}
                      alt="${item.key
                        ? translateText(item.key)
                        : String(item.unitType)}"
                      width="40"
                      height="40"
                    />
                    <span class="build-name"
                      >${item.key && translateText(item.key)}</span
                    >
                    <span class="build-description"
                      >${item.description &&
                      translateText(item.description)}</span
                    >
                    <span class="build-cost" translate="no">
                      ${renderNumber(
                        this.game && this.game.myPlayer() ? this.cost(item) : 0,
                      )}
                      <img
                        src=${goldCoinIcon}
                        alt="gold"
                        width="12"
                        height="12"
                        style="vertical-align: middle;"
                      />
                    </span>
                    ${affordability
                      ? html`<span class="build-affordable" translate="no">
                          ${affordability}
                        </span>`
                      : ""}
                    ${item.countable
                      ? html`<div class="build-count-chip">
                          <span class="build-count">${this.count(item)}</span>
                        </div>`
                      : ""}
                  </button>
                `;
              })}
            </div>
          `,
        )}
      </div>
    `;
  }

  /**
   * Hides the build menu overlay.
   */
  hideMenu() {
    this._hidden = true;
    this.requestUpdate();
  }

  /**
   * Shows the build menu anchored to the tile the player clicked.
   */
  showMenu(clickedTile: TileRef) {
    this.clickedTile = clickedTile;
    this._hidden = false;
    this.refresh();
  }

  /**
   * Refreshes the computed list of buildable units and the latest player
   * actions for the active tile.
   */
  private refresh() {
    this.game
      .myPlayer()
      ?.actions(this.clickedTile)
      .then((actions) => {
        this.playerActions = actions;
        this.requestUpdate();
      });

    // removed disabled buildings from the buildtable
    this.filteredBuildTable = this.getBuildableUnits();
  }

  /**
   * Filters out any disabled units from the static build table.
   */
  private getBuildableUnits(): BuildItemDisplay[][] {
    return buildTable.map((row) =>
      row.filter((item) => !this.game?.config()?.isUnitDisabled(item.unitType)),
    );
  }

  get isVisible() {
    return !this._hidden;
  }
}
