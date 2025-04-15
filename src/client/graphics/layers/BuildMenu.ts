import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import warshipIcon from "../../../../resources/images/BattleshipIconWhite.svg";
import cityIcon from "../../../../resources/images/CityIconWhite.svg";
import goldCoinIcon from "../../../../resources/images/GoldCoinIcon.svg";
import mirvIcon from "../../../../resources/images/MIRVIcon.svg";
import missileSiloIcon from "../../../../resources/images/MissileSiloIconWhite.svg";
import hydrogenBombIcon from "../../../../resources/images/MushroomCloudIconWhite.svg";
import atomBombIcon from "../../../../resources/images/NukeIconWhite.svg";
import portIcon from "../../../../resources/images/PortIcon.svg";
import samlauncherIcon from "../../../../resources/images/SamLauncherIconWhite.svg";
import shieldIcon from "../../../../resources/images/ShieldIconWhite.svg";
import { EventBus } from "../../../core/EventBus";
import { Cell, PlayerActions, UnitType } from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { GameView } from "../../../core/game/GameView";
import { BuildUnitIntentEvent } from "../../Transport";
import { renderNumber } from "../../Utils";
import { Layer } from "./Layer";

interface BuildItemDisplay {
  unitType: UnitType;
  icon: string;
  description?: string;
  countable?: boolean;
}

const buildTable: BuildItemDisplay[][] = [
  [
    {
      unitType: UnitType.AtomBomb,
      icon: atomBombIcon,
      description: "Small explosion",
      countable: false,
    },
    {
      unitType: UnitType.MIRV,
      icon: mirvIcon,
      description: "Huge explosion, only targets selected player",
      countable: false,
    },
    {
      unitType: UnitType.HydrogenBomb,
      icon: hydrogenBombIcon,
      description: "Large explosion",
      countable: false,
    },
    {
      unitType: UnitType.Warship,
      icon: warshipIcon,
      description: "Captures trade ships, destroys ships and boats",
      countable: true,
    },
    {
      unitType: UnitType.Port,
      icon: portIcon,
      description: "Sends trade ships to allies to generate gold",
      countable: true,
    },
    {
      unitType: UnitType.MissileSilo,
      icon: missileSiloIcon,
      description: "Used to launch nukes",
      countable: true,
    },
    // needs new icon
    {
      unitType: UnitType.SAMLauncher,
      icon: samlauncherIcon,
      description: "Defends against incoming nukes",
      countable: true,
    },
    {
      unitType: UnitType.DefensePost,
      icon: shieldIcon,
      description: "Increase defenses of nearby borders",
      countable: true,
    },
    {
      unitType: UnitType.City,
      icon: cityIcon,
      description: "Increase max population",
      countable: true,
    },
  ],
];

@customElement("build-menu")
export class BuildMenu extends LitElement implements Layer {
  public game: GameView;
  public eventBus: EventBus;
  private clickedTile: TileRef;
  private playerActions: PlayerActions | null;
  private filteredBuildTable: BuildItemDisplay[][] = buildTable;

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

  private canBuild(item: BuildItemDisplay): boolean {
    if (this.game?.myPlayer() == null || this.playerActions == null) {
      return false;
    }
    const unit = this.playerActions.buildableUnits.filter(
      (u) => u.type == item.unitType,
    );
    if (!unit) {
      return false;
    }
    return unit[0].canBuild;
  }

  private cost(item: BuildItemDisplay): number {
    for (const bu of this.playerActions?.buildableUnits ?? []) {
      if (bu.type == item.unitType) {
        return bu.cost;
      }
    }
    return 0;
  }

  private count(item: BuildItemDisplay): string {
    const player = this.game?.myPlayer();
    if (!player) {
      return "?";
    }

    return player.units(item.unitType).length.toString();
  }

  public onBuildSelected = (item: BuildItemDisplay) => {
    this.eventBus.emit(
      new BuildUnitIntentEvent(
        item.unitType,
        new Cell(this.game.x(this.clickedTile), this.game.y(this.clickedTile)),
      ),
    );
    this.hideMenu();
  };

  render() {
    return html`
      <div
        class="build-menu ${this._hidden ? "hidden" : ""}"
        @contextmenu=${(e) => e.preventDefault()}
      >
        ${this.filteredBuildTable.map(
          (row) => html`
            <div class="build-row">
              ${row.map(
                (item) => html`
                  <button
                    class="build-button"
                    @click=${() => this.onBuildSelected(item)}
                    ?disabled=${!this.canBuild(item)}
                    title=${!this.canBuild(item) ? "Not enough money" : ""}
                  >
                    <img
                      src=${item.icon}
                      alt="${item.unitType}"
                      width="40"
                      height="40"
                    />
                    <span class="build-name">${item.unitType}</span>
                    <span class="build-description">${item.description}</span>
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
                    ${item.countable
                      ? html`<div class="build-count-chip">
                          <span class="build-count">${this.count(item)}</span>
                        </div>`
                      : ""}
                  </button>
                `,
              )}
            </div>
          `,
        )}
      </div>
    `;
  }

  hideMenu() {
    this._hidden = true;
    this.requestUpdate();
  }

  showMenu(clickedTile: TileRef) {
    this.clickedTile = clickedTile;
    this._hidden = false;
    this.refresh();
  }

  private refresh() {
    this.game
      .myPlayer()
      .actions(this.clickedTile)
      .then((actions) => {
        this.playerActions = actions;
        this.requestUpdate();
      });

    // removed disabled buildings from the buildtable
    this.filteredBuildTable = this.getBuildableUnits();
  }

  private getBuildableUnits(): BuildItemDisplay[][] {
    if (this.game?.config()?.disableNukes()) {
      return buildTable.map((row) =>
        row.filter(
          (item) =>
            ![
              UnitType.AtomBomb,
              UnitType.MIRV,
              UnitType.HydrogenBomb,
              UnitType.MissileSilo,
              UnitType.SAMLauncher,
            ].includes(item.unitType),
        ),
      );
    }
    return buildTable;
  }

  get isVisible() {
    return !this._hidden;
  }
}
