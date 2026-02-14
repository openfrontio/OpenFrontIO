/**
 * Game action bridges consolidated in one module.
 */

import { EventBus, GameEvent } from "../core/EventBus";
import type { ColorPalette, Cosmetics, Pattern } from "../core/CosmeticSchemas";
import {
  BuildableUnit,
  Gold,
  PlayerActions,
  UnitType,
} from "../core/game/Game";
import { TileRef } from "../core/game/GameMap";
import { GameUpdateType } from "../core/game/GameUpdates";
import { GameView, PlayerView } from "../core/game/GameView";
import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { getUserMe } from "./Api";
import {
  fetchCosmetics,
  handlePurchase,
  patternRelationship,
} from "./Cosmetics";
import { crazyGamesSDK } from "./CrazyGamesSDK";
import {
  CloseViewEvent,
  ContextMenuEvent,
  MouseDownEvent,
  ShowBuildMenuEvent,
  ShowEmojiMenuEvent,
} from "./InputHandler";
import {
  BuildUnitIntentEvent,
  SendUpgradeStructureIntentEvent,
  SendWinnerEvent,
} from "./Transport";
import { renderNumber, translateText } from "./Utils";
import { dispatchUiAction, initDioxusRuntime } from "./UiRuntimeBridge";
import { TransformHandler } from "./graphics/TransformHandler";
import { UIState } from "./graphics/UIState";
import {
  buildTable,
  type BuildItemDisplay,
  type IBuildMenu,
} from "./graphics/layers/BuildMenu";
import { ChatIntegration } from "./graphics/layers/ChatIntegration";
import {
  DioxusEmojiTable,
  DioxusPlayerPanel,
} from "./graphics/layers/AdvancedLayerBridges";
import { Layer } from "./graphics/layers/Layer";
import { PlayerActionHandler } from "./graphics/layers/PlayerActionHandler";
import {
  MenuElement,
  type MenuElementParams,
  TooltipKey,
  type TooltipItem,
  centerButtonElement,
  rootMenuElement,
} from "./graphics/layers/RadialMenuElements";
import { subscribeUiRuntimeEvents } from "./runtime/UiRuntimeEventRouter";
import {
  parseUiRuntimePayload,
  parseUiRuntimeString,
} from "./runtime/UiRuntimeParsing";
import { UI_RUNTIME_ACTIONS, UI_RUNTIME_EVENTS } from "./runtime/UiRuntimeProtocol";
import { readUiSessionStorage } from "./runtime/UiSessionRuntime";

import backIcon from "/images/BackIconWhite.svg?url";
import donateTroopIcon from "/images/DonateTroopIconWhite.svg?url";
import swordIcon from "/images/SwordIconWhite.svg?url";

interface BuildMenuItemForDioxus {
  unitType: string;
  icon: string;
  description: string;
  name: string;
  countable: boolean;
  canBuild: boolean;
  canUpgrade: boolean;
  upgradeUnitId: number | null;
  cost: string;
  count: string;
}

function dispatchInGameRuntimeAction(
  actionType: string,
  payload: Record<string, unknown> = {},
): void {
  const dispatched = dispatchUiAction({
    type: actionType,
    payload,
  });
  if (!dispatched) {
    console.warn("[GameActionBridges] Runtime action rejected:", actionType);
  }
}

const GAMES_PLAYED_STORAGE_KEY = "gamesPlayed";

@customElement("dioxus-build-menu")
export class DioxusBuildMenu extends LitElement implements Layer, IBuildMenu {
  public game: GameView;
  public eventBus: EventBus;
  public uiState: UIState;
  public transformHandler: TransformHandler;
  public playerActions: PlayerActions | null = null;

  @state() private isLaunched = false;
  @state() private loading = false;
  @state() private error: string | null = null;
  @state() private _hidden = true;

  private clickedTile: TileRef;
  private runtimeUnsubscribe?: () => void;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.launchDioxusComponent();
  }

  disconnectedCallback() {
    this.runtimeUnsubscribe?.();
    this.runtimeUnsubscribe = undefined;
    super.disconnectedCallback();
  }

  private async launchDioxusComponent() {
    try {
      this.loading = true;
      this.error = null;
      this.requestUpdate();

      await initDioxusRuntime();

      this.loading = false;
      this.requestUpdate();
      await this.updateComplete;

      const translations = {
        notEnoughMoney: translateText("build_menu.not_enough_money"),
      };
      dispatchInGameRuntimeAction(UI_RUNTIME_ACTIONS.uiInGameBuildMenuLaunch, {
        translations,
      });

      this.runtimeUnsubscribe ??= subscribeUiRuntimeEvents(
        [
          UI_RUNTIME_EVENTS.uiInGameBuildMenuSelected,
          UI_RUNTIME_EVENTS.uiInGameBuildMenuClosed,
        ],
        (event) => {
          if (event.type === UI_RUNTIME_EVENTS.uiInGameBuildMenuClosed) {
            this._hidden = true;
            return;
          }

          const detail = parseUiRuntimePayload(event.payload);
          const unitType = parseUiRuntimeString(detail.unitType).trim();
          const canUpgrade = detail.canUpgrade === true;
          if (!unitType || !this.playerActions) {
            return;
          }

          const buildableUnit = this.playerActions.buildableUnits.find(
            (bu) => bu.type.toString() === unitType,
          );
          if (!buildableUnit) {
            return;
          }

          if (canUpgrade && buildableUnit.canUpgrade !== false) {
            this.eventBus.emit(
              new SendUpgradeStructureIntentEvent(
                buildableUnit.canUpgrade,
                buildableUnit.type,
              ),
            );
          } else if (buildableUnit.canBuild) {
            const rocketDirectionUp =
              buildableUnit.type === UnitType.AtomBomb ||
              buildableUnit.type === UnitType.HydrogenBomb
                ? this.uiState.rocketDirectionUp
                : undefined;
            this.eventBus.emit(
              new BuildUnitIntentEvent(
                buildableUnit.type,
                this.clickedTile,
                rocketDirectionUp,
              ),
            );
          }

          this._hidden = true;
        },
      );

      await new Promise((resolve) => requestAnimationFrame(resolve));
      this.isLaunched = true;
    } catch (err) {
      this.loading = false;
      this.error =
        err instanceof Error ? err.message : "Failed to load Dioxus";
      console.error("[DioxusBuildMenu] Failed to launch:", err);
      this.requestUpdate();
    }
  }

  init() {
    this.eventBus.on(ShowBuildMenuEvent, (e) => {
      if (!this.game.myPlayer()?.isAlive()) return;
      if (!this._hidden) return;

      const clickedCell = this.transformHandler.screenToWorldCoordinates(
        e.x,
        e.y,
      );
      if (clickedCell === null) return;
      if (!this.game.isValidCoord(clickedCell.x, clickedCell.y)) return;

      const tile = this.game.ref(clickedCell.x, clickedCell.y);
      this.showMenu(tile);
    });
    this.eventBus.on(CloseViewEvent, () => this.hideMenu());
    this.eventBus.on(ShowEmojiMenuEvent, () => this.hideMenu());
    this.eventBus.on(MouseDownEvent, () => this.hideMenu());
  }

  tick() {
    if (!this._hidden) {
      this.refresh();
    }
  }

  private async showMenu(clickedTile: TileRef) {
    this.clickedTile = clickedTile;
    this._hidden = false;
    this.refresh();
  }

  hideMenu() {
    if (this._hidden) return;
    this._hidden = true;
    if (this.isLaunched) {
      dispatchInGameRuntimeAction(UI_RUNTIME_ACTIONS.uiInGameBuildMenuHide);
    }
  }

  // IBuildMenu methods used by MainRadialMenu and RadialMenuElements

  canBuildOrUpgrade(item: BuildItemDisplay): boolean {
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

  cost(item: BuildItemDisplay): Gold {
    for (const bu of this.playerActions?.buildableUnits ?? []) {
      if (bu.type === item.unitType) {
        return bu.cost;
      }
    }
    return 0n;
  }

  count(item: BuildItemDisplay): string {
    const player = this.game?.myPlayer();
    if (!player) {
      return "?";
    }
    return player.totalUnitLevels(item.unitType).toString();
  }

  sendBuildOrUpgrade(buildableUnit: BuildableUnit, tile: TileRef): void {
    if (buildableUnit.canUpgrade !== false) {
      this.eventBus.emit(
        new SendUpgradeStructureIntentEvent(
          buildableUnit.canUpgrade,
          buildableUnit.type,
        ),
      );
    } else if (buildableUnit.canBuild) {
      const rocketDirectionUp =
        buildableUnit.type === UnitType.AtomBomb ||
        buildableUnit.type === UnitType.HydrogenBomb
          ? this.uiState.rocketDirectionUp
          : undefined;
      this.eventBus.emit(
        new BuildUnitIntentEvent(buildableUnit.type, tile, rocketDirectionUp),
      );
    }
    this.hideMenu();
  }

  private async refresh() {
    const actions = await this.game.myPlayer()?.actions(this.clickedTile);
    if (!actions) return;
    this.playerActions = actions;

    const player = this.game.myPlayer();
    if (!player) return;

    // Build items for Dioxus
    const filteredTable = buildTable.map((row) =>
      row.filter(
        (item) => !this.game?.config()?.isUnitDisabled(item.unitType),
      ),
    );

    const items: BuildMenuItemForDioxus[] = [];
    for (const row of filteredTable) {
      for (const item of row) {
        const buildableUnit = actions.buildableUnits.find(
          (bu) => bu.type === item.unitType,
        );
        if (!buildableUnit) continue;

        items.push({
          unitType: item.unitType.toString(),
          icon: item.icon,
          description: item.description ? translateText(item.description) : "",
          name: item.key ? translateText(item.key) : "",
          countable: item.countable ?? false,
          canBuild: buildableUnit.canBuild !== false,
          canUpgrade: buildableUnit.canUpgrade !== false,
          upgradeUnitId:
            buildableUnit.canUpgrade !== false
              ? (buildableUnit.canUpgrade as unknown as number)
              : null,
          cost: renderNumber(
            this.game && player ? buildableUnit.cost : 0n,
          ),
          count: item.countable
            ? player.totalUnitLevels(item.unitType).toString()
            : "",
        });
      }
    }

    if (this.isLaunched) {
      dispatchInGameRuntimeAction(UI_RUNTIME_ACTIONS.uiInGameBuildMenuShow, {
        items,
      });
    }
  }

  get isVisible() {
    return !this._hidden;
  }

  render() {
    if (this.loading) return html``;
    if (this.error) {
      return html`<div class="text-red-400 text-xs">Error: ${this.error}</div>`;
    }
    return html`
      <div
        id="dioxus-build-menu-root"
        @contextmenu=${(e: Event) => e.preventDefault()}
      ></div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dioxus-build-menu": DioxusBuildMenu;
  }
}

/** Event emitted when the radial menu closes (used by PlayerInfoOverlay) */
export class CloseRadialMenuEvent implements GameEvent {
  constructor() {}
}

// Serialized types matching the Rust structs
interface RadialMenuItemSerialized {
  id: string;
  icon?: string;
  text?: string;
  fontSize?: string;
  color: string;
  disabled: boolean;
  hasSubmenu: boolean;
  tooltipHtml?: string;
  cooldown?: number;
}

interface RadialMenuCenterButtonSerialized {
  icon: string;
  color: string;
  iconSize: number;
  disabled: boolean;
}

@customElement("dioxus-radial-menu")
export class DioxusRadialMenu extends LitElement implements Layer {
  public game: GameView;
  public eventBus: EventBus;
  public uiState: UIState;
  public transformHandler: TransformHandler;
  public emojiTable: DioxusEmojiTable;
  public buildMenu: IBuildMenu;
  public playerPanel: DioxusPlayerPanel;

  @state() private isLaunched = false;
  @state() private loading = false;
  @state() private error: string | null = null;

  private _visible = false;
  private clickedTile: TileRef | null = null;
  private params: MenuElementParams | null = null;
  private playerActionHandler: PlayerActionHandler;
  private chatIntegration: ChatIntegration;

  // Navigation state kept in TS for callback evaluation
  private currentLevel = 0;
  private menuStack: MenuElement[][] = [];
  private currentMenuItems: MenuElement[] = [];
  private lastHideTime = 0;
  private reopenCooldownMs = 300;
  private anchorX = 0;
  private anchorY = 0;

  private runtimeUnsubscribe?: () => void;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.launchDioxusComponent();
  }

  disconnectedCallback() {
    this.runtimeUnsubscribe?.();
    this.runtimeUnsubscribe = undefined;
    super.disconnectedCallback();
  }

  private async launchDioxusComponent() {
    try {
      this.loading = true;
      this.error = null;
      this.requestUpdate();

      await initDioxusRuntime();

      this.loading = false;
      this.requestUpdate();
      await this.updateComplete;

      dispatchInGameRuntimeAction(UI_RUNTIME_ACTIONS.uiInGameRadialMenuLaunch, {
        config: { backIcon },
      });

      this.runtimeUnsubscribe ??= subscribeUiRuntimeEvents(
        [
          UI_RUNTIME_EVENTS.uiInGameRadialMenuItemClick,
          UI_RUNTIME_EVENTS.uiInGameRadialMenuCenterClick,
          UI_RUNTIME_EVENTS.uiInGameRadialMenuClose,
        ],
        (event) => {
          if (event.type === UI_RUNTIME_EVENTS.uiInGameRadialMenuClose) {
            this.hideMenu();
            return;
          }

          if (event.type === UI_RUNTIME_EVENTS.uiInGameRadialMenuCenterClick) {
            void this.handleCenterClick();
            return;
          }

          const detail = parseUiRuntimePayload(event.payload);
          const itemId = parseUiRuntimeString(detail.itemId).trim();
          if (!itemId || !this.params) {
            return;
          }
          void this.handleItemClick(itemId);
        },
      );

      await new Promise((resolve) => requestAnimationFrame(resolve));
      this.isLaunched = true;
    } catch (err) {
      this.loading = false;
      this.error =
        err instanceof Error ? err.message : "Failed to load Dioxus";
      console.error("[DioxusRadialMenu] Failed to launch:", err);
      this.requestUpdate();
    }
  }

  init() {
    this.playerActionHandler = new PlayerActionHandler(
      this.eventBus,
      this.uiState,
    );
    this.chatIntegration = new ChatIntegration(this.game, this.eventBus);

    this.eventBus.on(ContextMenuEvent, (event) => {
      const worldCoords = this.transformHandler.screenToWorldCoordinates(
        event.x,
        event.y,
      );
      if (!this.game.isValidCoord(worldCoords.x, worldCoords.y)) return;
      if (this.game.myPlayer() === null) return;

      this.clickedTile = this.game.ref(worldCoords.x, worldCoords.y);
      this.game
        .myPlayer()!
        .actions(this.clickedTile)
        .then((actions) => {
          this.showMenu(actions, event.x, event.y);
        });
    });

    this.eventBus.on(CloseViewEvent, () => this.hideMenu());
  }

  async tick() {
    if (!this._visible || this.clickedTile === null) return;
    if (this.game.ticks() % 5 === 0) {
      this.game
        .myPlayer()!
        .actions(this.clickedTile)
        .then((actions) => {
          this.refreshMenu(actions);
        });
    }
  }

  renderLayer(_context: CanvasRenderingContext2D) {
    // Rendering is done via DOM/SVG in the Dioxus component
  }

  shouldTransform(): boolean {
    return false;
  }

  private async showMenu(
    actions: PlayerActions,
    screenX: number,
    screenY: number,
  ) {
    // Reopen cooldown check
    const now = Date.now();
    if (now - this.lastHideTime < this.reopenCooldownMs) return;

    this.anchorX = screenX;
    this.anchorY = screenY;

    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return;

    const tileOwner = this.game.owner(this.clickedTile!);
    const recipient = tileOwner.isPlayer() ? (tileOwner as PlayerView) : null;

    this.buildMenu.playerActions = actions;

    this.params = {
      myPlayer,
      selected: recipient,
      tile: this.clickedTile!,
      playerActions: actions,
      game: this.game,
      buildMenu: this.buildMenu,
      emojiTable: this.emojiTable,
      playerActionHandler: this.playerActionHandler,
      playerPanel: this.playerPanel,
      chatIntegration: this.chatIntegration,
      uiState: this.uiState,
      closeMenu: () => this.closeMenu(),
      eventBus: this.eventBus,
    };

    // Determine center button appearance
    const isFriendly =
      recipient !== null &&
      recipient.isFriendly(myPlayer) &&
      !recipient.isDisconnected();

    const centerIcon = isFriendly ? donateTroopIcon : swordIcon;
    const centerColor = isFriendly ? "#34D399" : "#2c3e50";
    const centerIconSize = isFriendly ? 48 * 0.75 : 48;

    // Get root menu items
    this.currentLevel = 0;
    this.menuStack = [];
    this.currentMenuItems = rootMenuElement.subMenu!(this.params!);

    const serializedItems = this.serializeItems(this.currentMenuItems);
    const serializedCenterButton: RadialMenuCenterButtonSerialized = {
      icon: centerIcon,
      color: centerColor,
      iconSize: centerIconSize,
      disabled: centerButtonElement.disabled(this.params!),
    };

    if (this.isLaunched) {
      dispatchInGameRuntimeAction(UI_RUNTIME_ACTIONS.uiInGameRadialMenuShow, {
        items: serializedItems,
        centerButton: serializedCenterButton,
        x: screenX,
        y: screenY,
      });
    }

    this._visible = true;
  }

  private async refreshMenu(actions: PlayerActions) {
    if (!this.params || !this._visible) return;

    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return;

    const tileOwner = this.game.owner(this.clickedTile!);
    const recipient = tileOwner.isPlayer() ? (tileOwner as PlayerView) : null;

    this.buildMenu.playerActions = actions;
    this.params = {
      ...this.params,
      myPlayer,
      selected: recipient,
      playerActions: actions,
    };

    // Re-evaluate current menu items
    if (this.currentLevel === 0) {
      this.currentMenuItems = rootMenuElement.subMenu!(this.params);
    }
    // For submenus, the items are already set from the submenu callback

    const serializedItems = this.serializeItems(this.currentMenuItems);

    const isFriendly =
      recipient !== null &&
      recipient.isFriendly(myPlayer) &&
      !recipient.isDisconnected();

    const centerIcon = isFriendly ? donateTroopIcon : swordIcon;
    const centerColor = isFriendly ? "#34D399" : "#2c3e50";
    const centerIconSize = isFriendly ? 48 * 0.75 : 48;

    const serializedCenterButton: RadialMenuCenterButtonSerialized = {
      icon: centerIcon,
      color: centerColor,
      iconSize: centerIconSize,
      disabled: centerButtonElement.disabled(this.params),
    };

    if (this.isLaunched) {
      dispatchInGameRuntimeAction(
        UI_RUNTIME_ACTIONS.uiInGameRadialMenuUpdateItems,
        {
          items: serializedItems,
          centerButton: serializedCenterButton,
        },
      );
    }
  }

  private serializeItems(items: MenuElement[]): RadialMenuItemSerialized[] {
    return items
      .filter((item) => {
        if (typeof item.displayed === "function") {
          return item.displayed(this.params!);
        }
        return item.displayed !== false;
      })
      .map((item) => {
        const disabled =
          !this.params ||
          this.game.inSpawnPhase() ||
          item.disabled(this.params);

        let tooltipHtml: string | undefined;
        if (item.tooltipItems && item.tooltipItems.length > 0) {
          tooltipHtml = this.tooltipItemsToHtml(item.tooltipItems);
        } else if (item.tooltipKeys && item.tooltipKeys.length > 0) {
          tooltipHtml = this.tooltipKeysToHtml(item.tooltipKeys);
        }

        const cooldown = this.params && item.cooldown
          ? item.cooldown(this.params)
          : undefined;

        return {
          id: item.id,
          icon: item.icon,
          text: item.text,
          fontSize: item.fontSize,
          color: item.color ?? "#333333",
          disabled,
          hasSubmenu: typeof item.subMenu === "function",
          tooltipHtml,
          cooldown: cooldown !== undefined && cooldown > 0 ? cooldown : undefined,
        };
      });
  }

  private tooltipItemsToHtml(items: TooltipItem[]): string {
    return items
      .map((item) => `<div class="${item.className}">${item.text}</div>`)
      .join("");
  }

  private tooltipKeysToHtml(keys: TooltipKey[]): string {
    return keys
      .map((k) => {
        const text = translateText(k.key, k.params);
        return `<div class="${k.className}">${text}</div>`;
      })
      .join("");
  }

  private async handleItemClick(itemId: string) {
    if (!this.params) return;

    const item = this.currentMenuItems.find((i) => i.id === itemId);
    if (!item) return;

    if (item.disabled(this.params)) return;

    const subMenu = item.subMenu?.(this.params);
    if (subMenu && subMenu.length > 0) {
      // Navigate into submenu
      this.menuStack.push(this.currentMenuItems);
      this.currentMenuItems = subMenu;
      this.currentLevel++;

      const serialized = this.serializeItems(subMenu);
      if (this.isLaunched) {
        dispatchInGameRuntimeAction(
          UI_RUNTIME_ACTIONS.uiInGameRadialMenuPushSubmenu,
          {
            items: serialized,
          },
        );
      }
    } else {
      // Leaf item - execute action
      item.action?.(this.params);
      this.hideMenu();
    }
  }

  private async handleCenterClick() {
    if (!this.params) return;

    if (this.currentLevel > 0) {
      // Navigate back
      const previousItems = this.menuStack.pop();
      if (previousItems) {
        this.currentLevel--;
        this.currentMenuItems = previousItems;
        if (this.isLaunched) {
          dispatchInGameRuntimeAction(
            UI_RUNTIME_ACTIONS.uiInGameRadialMenuPopSubmenu,
          );
        }
      }
    } else {
      // Execute center button action
      if (!centerButtonElement.disabled(this.params)) {
        centerButtonElement.action(this.params);
      }
      this.hideMenu();
    }
  }

  hideMenu() {
    if (!this._visible) return;
    this._visible = false;
    this.currentLevel = 0;
    this.menuStack = [];
    this.lastHideTime = Date.now();

    if (this.isLaunched) {
      dispatchInGameRuntimeAction(UI_RUNTIME_ACTIONS.uiInGameRadialMenuHide);
    }

    this.eventBus.emit(new CloseRadialMenuEvent());
  }

  closeMenu() {
    this.hideMenu();

    if (this.buildMenu.isVisible) {
      this.buildMenu.hideMenu();
    }

    if (this.emojiTable.isVisible) {
      this.emojiTable.hideTable();
    }

    if (this.playerPanel.isVisible) {
      this.playerPanel.hide();
    }
  }

  get isVisible() {
    return this._visible;
  }

  render() {
    if (this.loading) return html``;
    if (this.error) {
      return html`<div class="text-red-400 text-xs">
        Error: ${this.error}
      </div>`;
    }
    return html`
      <div
        id="dioxus-radial-menu-root"
        @contextmenu=${(e: Event) => e.preventDefault()}
      ></div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dioxus-radial-menu": DioxusRadialMenu;
  }
}

export interface WinModalTranslations {
  died: string;
  your_team: string;
  other_team: string;
  nation_won: string;
  you_won: string;
  other_won: string;
  exit: string;
  keep: string;
  spectate: string;
  youtube_tutorial: string;
  support_openfront: string;
  territory_pattern: string;
  wishlist: string;
  join_discord: string;
  discord_description: string;
  join_server: string;
}

export type WinModalContentType = "youtube_tutorial" | "steam_wishlist" | "discord" | "pattern_button";

export interface PurchasablePattern {
  pattern: {
    name: string;
    patternData: string;
    affiliateCode: string | null;
    product: {
      priceId: string;
      price: string;
    } | null;
  };
  colorPalette: {
    name: string;
    primaryColor: string;
    secondaryColor: string;
  };
}

@customElement("dioxus-win-modal")
export class DioxusWinModal extends LitElement implements Layer {
  public game: GameView;
  public eventBus: EventBus;

  @state()
  private isLaunched: boolean = false;

  @state()
  private loading: boolean = false;

  @state()
  private error: string | null = null;

  @state()
  isVisible = false;

  private hasShownDeathModal = false;

  private rand = Math.random();

  private cosmeticsLoaded = false;
  private gamesPlayed = 0;
  private runtimeUnsubscribe?: () => void;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    // Auto-launch the Dioxus component when connected
    this.launchDioxusComponent();
  }

  disconnectedCallback() {
    this.runtimeUnsubscribe?.();
    this.runtimeUnsubscribe = undefined;
    super.disconnectedCallback();
  }

  private getTranslations(): WinModalTranslations {
    return {
      died: translateText("win_modal.died"),
      your_team: translateText("win_modal.your_team"),
      other_team: translateText("win_modal.other_team"),
      nation_won: translateText("win_modal.nation_won"),
      you_won: translateText("win_modal.you_won"),
      other_won: translateText("win_modal.other_won"),
      exit: translateText("win_modal.exit"),
      keep: translateText("win_modal.keep"),
      spectate: translateText("win_modal.spectate"),
      youtube_tutorial: translateText("win_modal.youtube_tutorial"),
      support_openfront: translateText("win_modal.support_openfront"),
      territory_pattern: translateText("win_modal.territory_pattern"),
      wishlist: translateText("win_modal.wishlist"),
      join_discord: translateText("win_modal.join_discord"),
      discord_description: translateText("win_modal.discord_description"),
      join_server: translateText("win_modal.join_server"),
    };
  }

  private isInIframe(): boolean {
    try {
      return window.self !== window.top;
    } catch (e) {
      return true;
    }
  }

  private async loadGamesPlayedFromSessionStorage() {
    const storedGamesPlayed = await readUiSessionStorage(GAMES_PLAYED_STORAGE_KEY);
    if (typeof storedGamesPlayed !== "string") {
      return;
    }

    const parsedGamesPlayed = Number.parseInt(storedGamesPlayed, 10);
    this.gamesPlayed =
      Number.isFinite(parsedGamesPlayed) && parsedGamesPlayed > 0
        ? parsedGamesPlayed
        : 0;
  }

  private getGamesPlayed(): number {
    return this.gamesPlayed;
  }

  private async loadCosmetics(): Promise<PurchasablePattern[]> {
    const me = await getUserMe();
    const cosmetics: Cosmetics | null = await fetchCosmetics();

    const purchasablePatterns: PurchasablePattern[] = [];

    if (!cosmetics?.patterns) {
      return purchasablePatterns;
    }

    for (const pattern of Object.values(cosmetics.patterns)) {
      for (const colorPalette of pattern.colorPalettes ?? []) {
        if (
          patternRelationship(pattern, colorPalette, me, null) === "purchasable"
        ) {
          const palette = cosmetics.colorPalettes?.[colorPalette.name];
          if (palette) {
            purchasablePatterns.push({
              pattern: {
                name: pattern.name,
                patternData: pattern.pattern,
                affiliateCode: pattern.affiliateCode,
                product: pattern.product
                  ? {
                      priceId: pattern.product.priceId,
                      price: pattern.product.price,
                    }
                  : null,
              },
              colorPalette: {
                name: palette.name,
                primaryColor: palette.primaryColor,
                secondaryColor: palette.secondaryColor,
              },
            });
          }
        }
      }
    }

    return purchasablePatterns;
  }

  private async launchDioxusComponent() {
    try {
      this.loading = true;
      this.error = null;
      this.requestUpdate();

      // Load WASM module via centralized loader
      await initDioxusRuntime();

      this.loading = false;
      this.requestUpdate();

      // Wait for mount point to be rendered
      await this.updateComplete;
      await this.loadGamesPlayedFromSessionStorage();

      const translations = this.getTranslations();
      dispatchInGameRuntimeAction(UI_RUNTIME_ACTIONS.uiInGameWinModalLaunch, {
        translations,
        isInIframe: this.isInIframe(),
        gamesPlayed: this.getGamesPlayed(),
      });

      this.runtimeUnsubscribe ??= subscribeUiRuntimeEvents(
        [
          UI_RUNTIME_EVENTS.uiInGameWinModalExit,
          UI_RUNTIME_EVENTS.uiInGameWinModalHideRequest,
          UI_RUNTIME_EVENTS.uiInGameWinModalPurchase,
        ],
        (event) => {
          if (event.type === UI_RUNTIME_EVENTS.uiInGameWinModalExit) {
            window.location.href = "/";
            return;
          }

          if (event.type === UI_RUNTIME_EVENTS.uiInGameWinModalHideRequest) {
            this.isVisible = false;
            this.requestUpdate();
            return;
          }

          const detail = parseUiRuntimePayload(event.payload);
          const priceId = parseUiRuntimeString(detail.priceId).trim();
          const colorPaletteName = parseUiRuntimeString(
            detail.colorPaletteName,
          ).trim();
          if (!priceId || !colorPaletteName) {
            return;
          }
          handlePurchase(
            { product: { priceId, price: "" } } as Pattern,
            { name: colorPaletteName } as ColorPalette,
          );
        },
      );

      // Give Dioxus time to mount and store the signal before allowing updates
      await new Promise((resolve) => requestAnimationFrame(resolve));

      this.isLaunched = true;
    } catch (err) {
      this.loading = false;
      this.error = err instanceof Error ? err.message : "Failed to load Dioxus";
      console.error("[DioxusWinModal] Failed to launch:", err);
      this.requestUpdate();
    }
  }

  private async loadAndShowCosmetics() {
    if (this.cosmeticsLoaded) return;

    const patterns = await this.loadCosmetics();

    if (this.isLaunched) {
      dispatchInGameRuntimeAction(
        UI_RUNTIME_ACTIONS.uiInGameWinModalUpdateCosmetics,
        {
          cosmetics: { purchasablePatterns: patterns },
        },
      );
    }

    this.cosmeticsLoaded = true;
  }

  private selectContentType(): WinModalContentType {
    if (this.isInIframe()) {
      return "steam_wishlist";
    }

    if (!this.isInIframe() && this.getGamesPlayed() < 3) {
      return "youtube_tutorial";
    }

    // Random selection
    if (this.rand < 0.25) {
      return "steam_wishlist";
    } else if (this.rand < 0.5) {
      return "discord";
    } else {
      return "pattern_button";
    }
  }

  async show(title: string, isWin: boolean) {
    this.isVisible = true;

    const contentType = this.selectContentType();

    // Load cosmetics if showing pattern button
    if (contentType === "pattern_button") {
      await this.loadAndShowCosmetics();
    }

    if (this.isLaunched) {
      dispatchInGameRuntimeAction(UI_RUNTIME_ACTIONS.uiInGameWinModalShow, {
        title,
        isWin,
        contentType,
        cosmetics: { purchasablePatterns: [] }, // Will be updated by loadAndShowCosmetics
      });
    }

    this.requestUpdate();
  }

  async hide() {
    this.isVisible = false;
    if (this.isLaunched) {
      dispatchInGameRuntimeAction(UI_RUNTIME_ACTIONS.uiInGameWinModalHide);
    }
    this.requestUpdate();
  }

  init() {
    // Initialize in Rust component
  }

  tick() {
    const myPlayer = this.game.myPlayer();
    if (
      !this.hasShownDeathModal &&
      myPlayer &&
      !myPlayer.isAlive() &&
      !this.game.inSpawnPhase() &&
      myPlayer.hasSpawned()
    ) {
      this.hasShownDeathModal = true;
      this.show(this.getTranslations().died, false);
    }

    const updates = this.game.updatesSinceLastTick();
    const winUpdates = updates !== null ? updates[GameUpdateType.Win] : [];
    winUpdates.forEach((wu) => {
      if (wu.winner === undefined) {
        // ...
      } else if (wu.winner[0] === "team") {
        this.eventBus.emit(new SendWinnerEvent(wu.winner, wu.allPlayersStats));
        if (wu.winner[1] === this.game.myPlayer()?.team()) {
          this.show(this.getTranslations().your_team, true);
          crazyGamesSDK.happytime();
        } else {
          const title = translateText("win_modal.other_team", {
            team: wu.winner[1],
          });
          this.show(title, false);
        }
        history.replaceState(null, "", `${window.location.pathname}?replay`);
      } else if (wu.winner[0] === "nation") {
        const title = translateText("win_modal.nation_won", {
          nation: wu.winner[1],
        });
        this.show(title, false);
      } else {
        const winner = this.game.playerByClientID(wu.winner[1]);
        if (!winner?.isPlayer()) return;
        const winnerClient = winner.clientID();
        if (winnerClient !== null) {
          this.eventBus.emit(
            new SendWinnerEvent(["player", winnerClient], wu.allPlayersStats),
          );
        }
        if (
          winnerClient !== null &&
          winnerClient === this.game.myPlayer()?.clientID()
        ) {
          this.show(this.getTranslations().you_won, true);
          crazyGamesSDK.happytime();
        } else {
          const title = translateText("win_modal.other_won", {
            player: winner.name(),
          });
          this.show(title, false);
        }
        history.replaceState(null, "", `${window.location.pathname}?replay`);
      }
    });
  }

  renderLayer(/* context: CanvasRenderingContext2D */) {}

  shouldTransform(): boolean {
    return false;
  }

  render() {
    if (this.loading) {
      return html``;
    }

    if (this.error) {
      return html`
        <div class="text-red-400 text-xs">Error: ${this.error}</div>
      `;
    }

    // Render mount point for Dioxus
    return html`
      <div
        id="dioxus-win-modal-root"
        @contextmenu=${(e: Event) => e.preventDefault()}
      ></div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dioxus-win-modal": DioxusWinModal;
  }
}
