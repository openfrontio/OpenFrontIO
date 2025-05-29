import * as d3 from "d3";
import allianceIcon from "../../../../resources/images/AllianceIconWhite.svg";
import backIcon from "../../../../resources/images/BackIconWhite.svg";
import boatIcon from "../../../../resources/images/BoatIconWhite.svg";
import buildIcon from "../../../../resources/images/BuildIconWhite.svg";
import disabledIcon from "../../../../resources/images/DisabledIcon.svg";
import infoIcon from "../../../../resources/images/InfoIcon.svg";
import swordIcon from "../../../../resources/images/SwordIconWhite.svg";
import traitorIcon from "../../../../resources/images/TraitorIconWhite.svg";
import { EventBus } from "../../../core/EventBus";
import {
  AllPlayers,
  Cell,
  PlayerActions,
  TerraNullius,
  UnitType,
} from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { flattenedEmojiTable } from "../../../core/Util";
import {
  CloseViewEvent,
  ContextMenuEvent,
  MouseUpEvent,
  ShowBuildMenuEvent,
} from "../../InputHandler";
import {
  SendAllianceRequestIntentEvent,
  SendAttackIntentEvent,
  SendBoatAttackIntentEvent,
  SendBreakAllianceIntentEvent,
  SendEmojiIntentEvent,
  SendSpawnIntentEvent,
} from "../../Transport";
import { TransformHandler } from "../TransformHandler";
import { UIState } from "../UIState";
import { BuildMenu } from "./BuildMenu";
import { EmojiTable } from "./EmojiTable";
import { Layer } from "./Layer";
import { PlayerInfoOverlay } from "./PlayerInfoOverlay";
import { PlayerPanel } from "./PlayerPanel";

/**
 * Type definition for a menu item with optional nested children
 */
interface MenuItem {
  id: string;
  name: string;
  disabled: boolean;
  action: () => void;
  color?: string;
  icon?: string;
  children?: MenuItem[];
}

/**
 * Enum for first-level menu slots
 */
enum Slot {
  Info,
  Boat,
  Build,
  Ally,
  Back,
}

/**
 * RadialMenu component that supports multiple levels of nested menus
 * Uses D3 for SVG generation and animations
 */
export class RadialMenu implements Layer {
  private clickedCell: Cell | null = null;
  private lastClosed: number = 0;

  private originalTileOwner: PlayerView | TerraNullius;
  private menuElement: d3.Selection<HTMLDivElement, unknown, null, undefined>;
  private isVisible: boolean = false;

  // Current menu level (0 = main menu, 1 = submenu, etc.)
  private currentLevel: number = 0;
  // Stack to track menu navigation history
  private menuStack: MenuItem[][] = [];

  // Add throttling variables for tick
  private lastTickRefresh: number = 0;
  private tickRefreshInterval: number = 500; // Only refresh every 500ms
  private needsRefresh: boolean = false;

  // Main menu items
  private readonly rootMenuItems: MenuItem[] = [
    {
      id: Slot.Boat.toString(),
      name: "boat",
      disabled: true,
      action: () => {},
      color: undefined,
      icon: undefined,
    },
    {
      id: Slot.Ally.toString(),
      name: "ally",
      disabled: true,
      action: () => {},
      color: undefined,
      icon: undefined,
    },
    {
      id: Slot.Build.toString(),
      name: "build",
      disabled: true,
      action: () => {},
      color: undefined,
      icon: undefined,
    },
    {
      id: Slot.Info.toString(),
      name: "info",
      disabled: true,
      action: () => {},
      color: undefined,
      icon: undefined,
    },
  ];

  // Current active menu items (changes based on level)
  private currentMenuItems: MenuItem[] = [];

  // Configuration for menu sizing and appearance
  private readonly menuSize = 190;
  private readonly submenuScale = 1.5; // Increased from 1.3 to fit submenus better
  private readonly centerButtonSize = 30;
  private readonly iconSize = 32;
  private readonly centerIconSize = 48;
  private readonly disabledColor = d3.rgb(128, 128, 128).toString();
  private readonly menuTransitionDuration = 400; // ms
  private readonly mainMenuInnerRadius = 40; // Increased inner radius for main menu
  private readonly submenuInnerRadius = 80; // Inner radius for submenu

  // Center button state
  private isCenterButtonEnabled = false;
  private centerButtonAction: (() => void) | null = null;

  // Add a flag to track recent context menu events
  private contextMenuOpenedTime: number = 0;
  private isTransitioning: boolean = false;

  // Add new properties to track menu elements
  private menuGroups: Map<
    number,
    d3.Selection<SVGGElement, unknown, null, undefined>
  > = new Map();
  private menuPaths: Map<
    string,
    d3.Selection<SVGPathElement, unknown, null, undefined>
  > = new Map();
  private menuIcons: Map<
    string,
    d3.Selection<SVGImageElement, unknown, null, undefined>
  > = new Map();

  // Track the currently selected menu item
  private selectedItemId: string | null = null;

  // Add a property to track game phase changes
  private wasInSpawnPhase: boolean = false;

  constructor(
    private eventBus: EventBus,
    private g: GameView,
    private transformHandler: TransformHandler,
    private emojiTable: EmojiTable,
    private buildMenu: BuildMenu,
    private uiState: UIState,
    private playerInfoOverlay: PlayerInfoOverlay,
    private playerPanel: PlayerPanel,
  ) {
    // Initialize current menu items with root items
    this.currentMenuItems = [...this.rootMenuItems];
  }

  init() {
    this.eventBus.on(ContextMenuEvent, (e) => this.onContextMenu(e));
    this.eventBus.on(MouseUpEvent, (e) => this.onPointerUp(e));
    this.eventBus.on(ShowBuildMenuEvent, (e) => {
      const clickedCell = this.transformHandler.screenToWorldCoordinates(
        e.x,
        e.y,
      );
      if (clickedCell === null) {
        return;
      }
      if (!this.g.isValidCoord(clickedCell.x, clickedCell.y)) {
        return;
      }
      const tile = this.g.ref(clickedCell.x, clickedCell.y);
      const p = this.g.myPlayer();
      if (p === null) {
        return;
      }
      this.buildMenu.showMenu(tile);
    });

    this.eventBus.on(CloseViewEvent, () => this.closeMenu());

    this.createMenuElement();
  }

  private closeMenu() {
    if (this.isVisible) {
      this.hideRadialMenu();
    }

    if (this.buildMenu.isVisible) {
      this.buildMenu.hideMenu();
    }
  }

  /**
   * Creates the SVG-based radial menu using D3
   */
  private createMenuElement() {
    // Create an overlay to catch clicks outside the menu
    this.menuElement = d3
      .select(document.body)
      .append("div")
      .attr("class", "radial-menu-container")
      .style("position", "fixed")
      .style("display", "none")
      .style("z-index", "9999")
      .style("touch-action", "none")
      .style("top", "0")
      .style("left", "0")
      .style("width", "100vw")
      .style("height", "100vh")
      .on("click", () => {
        // Clicking on the overlay (outside the menu) should close it
        this.hideRadialMenu();
      })
      .on("contextmenu", (e) => {
        e.preventDefault();
        this.hideRadialMenu();
      });

    // Calculate the total size needed for the menu with submenu
    const totalSize = this.menuSize * this.submenuScale;

    const svg = this.menuElement
      .append("svg")
      .attr("width", totalSize)
      .attr("height", totalSize)
      .style("position", "absolute")
      .style("top", "50%")
      .style("left", "50%")
      .style("transform", "translate(-50%, -50%)")
      .style("pointer-events", "all")
      .on("click", (event) => {
        // Close menu when clicking on SVG background but not on menu items
        if (event.target.tagName === "svg") {
          this.hideRadialMenu();
        } else {
          // Stop propagation only if clicking on menu items
          event.stopPropagation();
        }
      });

    // Create container group
    const container = svg
      .append("g")
      .attr("class", "menu-container")
      .attr("transform", `translate(${totalSize / 2},${totalSize / 2})`);

    // Add glow filter for hover effects
    const defs = svg.append("defs");
    const filter = defs.append("filter").attr("id", "glow");
    filter
      .append("feGaussianBlur")
      .attr("stdDeviation", "2")
      .attr("result", "coloredBlur");
    const feMerge = filter.append("feMerge");
    feMerge.append("feMergeNode").attr("in", "coloredBlur");
    feMerge.append("feMergeNode").attr("in", "SourceGraphic");

    // Add center button group
    const centerButton = container.append("g").attr("class", "center-button");

    centerButton
      .append("circle")
      .attr("class", "center-button-hitbox")
      .attr("r", this.centerButtonSize)
      .attr("fill", "transparent")
      .style("cursor", "pointer")
      .on("click", (event) => {
        event.stopPropagation();
        this.handleCenterButtonClick();
      })
      .on("touchstart", (event: Event) => {
        event.preventDefault();
        event.stopPropagation();
        this.handleCenterButtonClick();
      })
      .on("mouseover", () => this.onCenterButtonHover(true))
      .on("mouseout", () => this.onCenterButtonHover(false));

    centerButton
      .append("circle")
      .attr("class", "center-button-visible")
      .attr("r", this.centerButtonSize)
      .attr("fill", "#2c3e50")
      .style("pointer-events", "none");

    centerButton
      .append("image")
      .attr("class", "center-button-icon")
      .attr("xlink:href", swordIcon)
      .attr("width", this.centerIconSize)
      .attr("height", this.centerIconSize)
      .attr("x", -this.centerIconSize / 2)
      .attr("y", -this.centerIconSize / 2)
      .style("pointer-events", "none");
  }

  /**
   * Renders the current menu items as a pie chart
   * @param items Menu items to render
   * @param level Menu level (0 = main, 1 = submenu)
   */
  private renderMenuItems(items: MenuItem[], level: number) {
    const container = this.menuElement.select(".menu-container");

    // Remove existing menu for this level if any
    container.selectAll(`.menu-level-${level}`).remove();

    // Create menu group for this level
    const menuGroup = container
      .append("g")
      .attr("class", `menu-level-${level}`);

    // Set initial styles based on level - we'll animate both main menu and submenus
    if (level === 0) {
      // If it's the initial show, we'll animate the main menu too
      menuGroup.style("opacity", 0.5).style("transform", "scale(0.2)");
    } else {
      // For submenus, start with initial state for animation
      menuGroup.style("opacity", 0).style("transform", "scale(0.5)");
    }

    // Store the group for later updates
    this.menuGroups.set(level, menuGroup as any);

    // Create arc and pie generators
    const pie = d3
      .pie<MenuItem>()
      .value(() => 1)
      .padAngle(0.03)
      .startAngle(Math.PI / 4)
      .endAngle(2 * Math.PI + Math.PI / 4);

    // Use different radius for main menu and submenu
    const innerRadius =
      level === 0 ? this.mainMenuInnerRadius : this.submenuInnerRadius;

    const outerRadius =
      level === 0 ? this.menuSize / 2 - 10 : this.menuSize * 0.75;

    const arc = d3
      .arc<d3.PieArcDatum<MenuItem>>()
      .innerRadius(innerRadius)
      .outerRadius(outerRadius);

    // Add "back" option to submenus
    const menuItemsToRender = [...items];
    if (level > 0) {
      menuItemsToRender.push({
        id: Slot.Back.toString(),
        name: "back",
        disabled: false,
        action: () => this.navigateBack(),
        color: "#5a6268",
        icon: backIcon,
      });
    }

    // Create pie segments with simpler interaction
    const arcs = menuGroup
      .selectAll(".menu-item")
      .data(pie(menuItemsToRender))
      .enter()
      .append("g")
      .attr("class", "menu-item-group");

    // Add path (slice) for each menu item with simplified hover effect
    const paths = arcs
      .append("path")
      .attr("class", "menu-item-path")
      .attr("d", arc)
      .attr("fill", (d) => {
        // Make all arcs half-transparent by default, except disabled ones
        const color = d.data.disabled
          ? this.disabledColor
          : d.data.color || "#333333";
        const opacity = d.data.disabled ? 0.5 : 0.7;

        // Make selected item fully opaque
        if (
          d.data.id === this.selectedItemId &&
          level === 0 &&
          this.currentLevel > 0
        ) {
          return color;
        }

        return d3.color(color)?.copy({ opacity: opacity })?.toString() || color;
      })
      .attr("stroke", "#ffffff")
      .attr("stroke-width", "2")
      .style("cursor", (d) => (d.data.disabled ? "not-allowed" : "pointer"))
      .style("opacity", (d) => (d.data.disabled ? 0.5 : 1))
      .attr("data-id", (d) => d.data.id);

    // Store paths for later updates
    paths.each((d) => {
      const path = d3.select(`path[data-id="${d.data.id}"]`) as any;
      this.menuPaths.set(d.data.id, path);

      // If this is the selected item, apply the hover effect immediately
      if (
        d.data.id === this.selectedItemId &&
        level === 0 &&
        this.currentLevel > 0
      ) {
        path.attr("filter", "url(#glow)");
        path.attr("stroke-width", "3");
        // Make the selected item fully opaque
        const color = d.data.disabled
          ? this.disabledColor
          : d.data.color || "#333333";
        path.attr("fill", color);
      }
    });

    // Create the event handlers as separate methods
    const onHover = (
      d: d3.PieArcDatum<MenuItem>,
      path: d3.Selection<any, any, any, any>,
    ) => {
      if (
        d.data.disabled ||
        (this.currentLevel > 0 &&
          level === 0 &&
          d.data.id !== this.selectedItemId)
      )
        return;
      path.attr("filter", "url(#glow)");
      path.attr("stroke-width", "3");
      const color = d.data.disabled
        ? this.disabledColor
        : d.data.color || "#333333";
      path.attr("fill", color);
    };

    const onMouseOut = (
      d: d3.PieArcDatum<MenuItem>,
      path: d3.Selection<any, any, any, any>,
    ) => {
      if (
        d.data.disabled ||
        (this.currentLevel > 0 &&
          level === 0 &&
          d.data.id === this.selectedItemId)
      )
        return;
      path.attr("filter", null);
      path.attr("stroke-width", "2");
      const color = d.data.disabled
        ? this.disabledColor
        : d.data.color || "#333333";
      const opacity = d.data.disabled ? 0.5 : 0.7;
      path.attr(
        "fill",
        d3.color(color)?.copy({ opacity: opacity })?.toString() || color,
      );
    };

    const onClick = (d: d3.PieArcDatum<MenuItem>, event: Event) => {
      event.stopPropagation();
      if (d.data.disabled) return;
      if (this.currentLevel > 0 && level === 0) return;

      if (d.data.children && d.data.children.length > 0) {
        this.selectedItemId = d.data.id;
        this.navigateToSubMenu(d.data.children);
      } else if (typeof d.data.action === "function") {
        d.data.action();
        this.hideRadialMenu();
      } else {
        console.warn("Menu item action is not a function", d.data);
        this.hideRadialMenu();
      }
    };

    // Attach event handlers using D3's approach
    paths.each(function (d, i) {
      const path = d3.select(this);

      path.on("mouseover", function () {
        onHover(d, path);
      });

      path.on("mouseout", function () {
        onMouseOut(d, path);
      });

      path.on("click", function (event) {
        onClick(d, event);
      });

      path.on("touchstart", function (event) {
        event.preventDefault();
        event.stopPropagation();
        onClick(d, event);
      });
    });

    // Add icons to menu items
    const icons = arcs
      .append("image")
      .attr("class", "menu-item-icon")
      .attr("xlink:href", (d) =>
        d.data.disabled ? disabledIcon : d.data.icon || disabledIcon,
      )
      .attr("width", this.iconSize)
      .attr("height", this.iconSize)
      .attr("x", (d) => arc.centroid(d)[0] - this.iconSize / 2)
      .attr("y", (d) => arc.centroid(d)[1] - this.iconSize / 2)
      .style("pointer-events", "none")
      .attr("data-id", (d) => d.data.id);

    // Store icons for later updates
    icons.each((d) => {
      const icon = d3.select(`image[data-id="${d.data.id}"]`) as any;
      this.menuIcons.set(d.data.id, icon);
    });

    // Animate both main menu and submenus
    menuGroup
      .transition()
      .duration(this.menuTransitionDuration * 0.8)
      .style("opacity", 1)
      .style("transform", "scale(1)")
      .on("start", () => {
        this.isTransitioning = true;
      })
      .on("end", () => {
        this.isTransitioning = false;
      });

    return menuGroup;
  }

  /**
   * Navigate to a submenu by pushing current items to stack and rendering new items
   */
  private navigateToSubMenu(children: MenuItem[]) {
    this.isTransitioning = true;

    // Push current items to stack
    this.menuStack.push(this.currentMenuItems);
    this.currentMenuItems = children;
    this.currentLevel++;

    // Get container and current menu
    const container = this.menuElement.select(".menu-container");
    const currentMenu = container.select(
      `.menu-level-${this.currentLevel - 1}`,
    );

    // Render the submenu first
    this.renderMenuItems(children, this.currentLevel);

    // Start both animations simultaneously
    // Scale down current menu but keep it more visible
    currentMenu
      .transition()
      .duration(this.menuTransitionDuration * 0.8) // Speed up animation slightly
      .style("transform", "scale(0.8)") // Larger scale than before
      .style("opacity", 0.8); // More visible than before
  }

  /**
   * Navigate back to previous menu level
   */
  private navigateBack() {
    if (this.menuStack.length === 0) {
      return;
    }

    this.isTransitioning = true;

    // Pop previous items from stack
    const previousItems = this.menuStack.pop();
    const previousLevel = this.currentLevel - 1;
    this.currentLevel = previousLevel;

    // Clear the selected item when going back
    this.selectedItemId = null;

    // Make sure previousItems is not undefined
    if (!previousItems) {
      this.currentMenuItems = [...this.rootMenuItems];
    } else {
      this.currentMenuItems = previousItems;
    }

    // Get container and current submenu
    const container = this.menuElement.select(".menu-container");
    const currentSubmenu = container.select(
      `.menu-level-${this.currentLevel + 1}`,
    );
    const previousMenu = container.select(`.menu-level-${this.currentLevel}`);

    // First, fade out the submenu
    currentSubmenu
      .transition()
      .duration(this.menuTransitionDuration * 0.8) // Speed up animation slightly
      .style("transform", "scale(0.5)") // Match the initial scale
      .style("opacity", 0)
      .on("end", function () {
        // Remove the submenu once animation is done
        d3.select(this).remove();
      });

    // At the same time, restore the previous menu
    if (previousMenu.empty()) {
      // If previous menu doesn't exist, render it
      const menu = this.renderMenuItems(
        this.currentMenuItems,
        this.currentLevel,
      );
      menu
        .style("transform", "scale(0.8)")
        .style("opacity", 0.3)
        .transition()
        .duration(this.menuTransitionDuration * 0.8) // Speed up animation slightly
        .style("transform", "scale(1)")
        .style("opacity", 1)
        .on("end", () => {
          this.isTransitioning = false;
        });
    } else {
      // If it exists, just restore it
      previousMenu
        .transition()
        .duration(this.menuTransitionDuration * 0.8) // Speed up animation slightly
        .style("transform", "scale(1)")
        .style("opacity", 1)
        .on("end", () => {
          this.isTransitioning = false;
        });
    }
  }

  async tick() {
    // Only update when menu is visible
    if (!this.isVisible || this.clickedCell === null) return;

    // Check if we need to refresh based on time interval
    const currentTime = new Date().getTime();
    if (
      currentTime - this.lastTickRefresh < this.tickRefreshInterval &&
      !this.needsRefresh
    ) {
      return;
    }

    const myPlayer = this.g.myPlayer();
    if (myPlayer === null || !myPlayer.isAlive()) return;
    const tile = this.g.ref(this.clickedCell.x, this.clickedCell.y);

    // Check if game phase has changed from spawn to gameplay or vice versa
    const isSpawnPhase = this.g.inSpawnPhase();
    if (this.wasInSpawnPhase !== isSpawnPhase) {
      // Game phase has changed, close menu to prevent stale actions
      this.closeMenu();
      return;
    }

    // Check if tile ownership has changed
    if (this.originalTileOwner.isPlayer()) {
      if (this.g.owner(tile) !== this.originalTileOwner) {
        this.closeMenu();
        return;
      }
    } else {
      if (this.g.owner(tile).isPlayer() || this.g.owner(tile) === myPlayer) {
        this.closeMenu();
        return;
      }
    }

    // Reset the refresh time and flag
    this.lastTickRefresh = currentTime;
    this.needsRefresh = false;

    const actions = await myPlayer.actions(tile);

    // Update menu state without rebuilding the DOM
    this.updateMenuState(myPlayer, actions, tile);
  }

  /**
   * Updates menu state without rebuilding DOM elements
   */
  private updateMenuState(
    myPlayer: PlayerView,
    actions: PlayerActions,
    tile: TileRef,
  ) {
    // Disable all buttons first
    this.enableCenterButton(false);

    // Update center button state
    if (actions.canAttack) {
      this.enableCenterButton(true, () => {
        if (this.clickedCell === null) return;
        const clicked = this.g.ref(this.clickedCell.x, this.clickedCell.y);
        const myPlayer = this.g.myPlayer();
        if (myPlayer !== null && this.g.owner(clicked) !== myPlayer) {
          this.eventBus.emit(
            new SendAttackIntentEvent(
              this.g.owner(clicked).id(),
              this.uiState.attackRatio * myPlayer.troops(),
            ),
          );
        }
        this.hideRadialMenu();
      });
    }

    // Update menu items without rebuilding them
    this.updateMenuItem(
      Slot.Build.toString(),
      !this.g.inSpawnPhase(),
      "#ebe250",
      buildIcon,
    );

    // Update alliance button
    if (actions?.interaction?.canSendAllianceRequest) {
      this.updateMenuItem(Slot.Ally.toString(), true, "#53ac75", allianceIcon);
    } else if (actions?.interaction?.canBreakAlliance) {
      this.updateMenuItem(Slot.Ally.toString(), true, "#c74848", traitorIcon);
    } else {
      this.updateMenuItem(Slot.Ally.toString(), false);
    }

    // Update boat button
    const canBuildTransport = actions.buildableUnits.find(
      (bu) => bu.type === UnitType.TransportShip,
    )?.canBuild;
    this.updateMenuItem(
      Slot.Boat.toString(),
      !!canBuildTransport,
      "#3f6ab1",
      boatIcon,
    );

    // Update info button
    this.updateMenuItem(
      Slot.Info.toString(),
      this.g.hasOwner(tile),
      "#64748B",
      infoIcon,
    );
  }

  /**
   * Updates a menu item's appearance without rebuilding it
   */
  private updateMenuItem(
    id: string,
    enabled: boolean,
    color?: string,
    icon?: string,
  ) {
    const path = this.menuPaths.get(id);
    if (!path) return;

    // Update the corresponding item in currentMenuItems to match
    const item = this.findMenuItem(id);
    if (item) {
      item.disabled = !enabled;
      if (color) item.color = enabled ? color : this.disabledColor;
      if (icon) item.icon = icon;
    }

    // Update path appearance - always maintain the semi-transparency
    const fillColor = enabled && color ? color : this.disabledColor;
    const opacity = enabled ? 0.7 : 0.5;

    // Make selected item fully opaque if it's selected
    const isSelected = id === this.selectedItemId && this.currentLevel > 0;
    const finalOpacity = isSelected ? 1.0 : opacity;

    path
      .attr(
        "fill",
        d3.color(fillColor)?.copy({ opacity: finalOpacity })?.toString() ||
          fillColor,
      )
      .style("opacity", enabled ? 1 : 0.5)
      .style("cursor", enabled ? "pointer" : "not-allowed");

    // Update icon if needed
    const iconElement = this.menuIcons.get(id);
    if (iconElement && icon) {
      iconElement.attr("xlink:href", enabled ? icon : disabledIcon);
    }
  }

  renderLayer(context: CanvasRenderingContext2D) {
    // No need to render anything on the canvas
  }

  shouldTransform(): boolean {
    return false;
  }

  private onContextMenu(event: ContextMenuEvent) {
    if (this.lastClosed + 200 > new Date().getTime()) return;

    // Set the timestamp for when menu was opened
    this.contextMenuOpenedTime = new Date().getTime();

    if (this.buildMenu.isVisible) {
      this.buildMenu.hideMenu();
      return;
    }

    if (this.isVisible) {
      this.hideRadialMenu();
      return;
    } else {
      this.showRadialMenu(event.x, event.y);
    }

    this.disableAllButtons();
    this.clickedCell = this.transformHandler.screenToWorldCoordinates(
      event.x,
      event.y,
    );
    if (!this.g.isValidCoord(this.clickedCell.x, this.clickedCell.y)) {
      return;
    }
    const tile = this.g.ref(this.clickedCell.x, this.clickedCell.y);
    this.originalTileOwner = this.g.owner(tile);

    // Store the current game phase to detect changes
    this.wasInSpawnPhase = this.g.inSpawnPhase();

    if (this.g.inSpawnPhase()) {
      if (this.g.isLand(tile) && !this.g.hasOwner(tile)) {
        this.enableCenterButton(true, () => {
          if (this.clickedCell === null) return;
          this.eventBus.emit(new SendSpawnIntentEvent(this.clickedCell));
          this.hideRadialMenu();
        });
      }
      return;
    }

    const myPlayer = this.g.myPlayer();
    if (myPlayer === null) {
      console.warn("my player not found");
      return;
    }
    if (myPlayer && !myPlayer.isAlive() && !this.g.inSpawnPhase()) {
      return this.hideRadialMenu();
    }
    myPlayer.actions(tile).then((actions) => {
      this.handlePlayerActions(myPlayer, actions, tile);
    });
  }

  private handlePlayerActions(
    myPlayer: PlayerView,
    actions: PlayerActions,
    tile: TileRef,
  ) {
    // Reset to root menu when handling new actions
    this.resetMenu();

    // Build option
    if (!this.g.inSpawnPhase()) {
      const buildItem = this.findMenuItem(Slot.Build.toString());
      if (buildItem) {
        buildItem.disabled = false;
        buildItem.color = "#ebe250";
        buildItem.icon = buildIcon;

        // Instead of directly showing the build menu, add submenu items
        const buildSubMenu: MenuItem[] = [
          {
            id: "build_tower",
            name: "tower",
            disabled: false,
            action: () => {
              console.log("Building tower");
              this.buildMenu.showMenu(tile);
            },
            color: "#e67e22",
            icon: buildIcon,
          },
          {
            id: "build_wall",
            name: "wall",
            disabled: false,
            action: () => {
              console.log("Building wall");
              this.buildMenu.showMenu(tile);
            },
            color: "#3498db",
            icon: buildIcon,
          },
          {
            id: "build_farm",
            name: "farm",
            disabled: false,
            action: () => {
              console.log("Building farm");
              this.buildMenu.showMenu(tile);
            },
            color: "#2ecc71",
            icon: buildIcon,
          },
          {
            id: "build_advanced",
            name: "advanced",
            disabled: false,
            color: "#9b59b6",
            icon: buildIcon,
            // Add a default action even though we'll use children
            action: () => {
              console.log("Advanced building options");
            },
            // Second level submenu
            children: [
              {
                id: "build_port",
                name: "port",
                disabled: false,
                action: () => {
                  console.log("Building port");
                  this.buildMenu.showMenu(tile);
                },
                color: "#1abc9c",
                icon: boatIcon,
              },
              {
                id: "build_barracks",
                name: "barracks",
                disabled: false,
                action: () => {
                  console.log("Building barracks");
                  this.buildMenu.showMenu(tile);
                },
                color: "#e74c3c",
                icon: swordIcon,
              },
            ],
          },
        ];

        // Set the children for the build item
        buildItem.children = buildSubMenu;

        // Change action to navigate to submenu instead of showing build menu directly
        buildItem.action = () => {
          if (buildItem.children && buildItem.children.length > 0) {
            this.navigateToSubMenu(buildItem.children);
          }
        };
      }
    }

    // Info option
    if (this.g.hasOwner(tile)) {
      const infoItem = this.findMenuItem(Slot.Info.toString());
      if (infoItem) {
        infoItem.disabled = false;
        infoItem.color = "#64748B";
        infoItem.icon = infoIcon;

        // Add submenu for info options
        const infoSubMenu: MenuItem[] = [
          {
            id: "info_details",
            name: "details",
            disabled: false,
            action: () => {
              console.log("Showing player details");
              this.playerPanel.show(actions, tile);
            },
            color: "#7f8c8d",
            icon: infoIcon,
          },
          {
            id: "info_emoji",
            name: "emoji",
            disabled: false,
            action: () => {
              console.log("Showing emoji table");
              // EmojiTable.showTable expects a callback for when an emoji is clicked
              this.emojiTable.showTable((emoji: string) => {
                // When an emoji is clicked, we can send it to the current player or all players
                const myPlayer = this.g.myPlayer();
                if (myPlayer) {
                  this.eventBus.emit(
                    new SendEmojiIntentEvent(
                      AllPlayers, // Send to all players
                      flattenedEmojiTable.indexOf(emoji),
                    ),
                  );
                }
              });
            },
            color: "#f1c40f",
            icon: infoIcon,
          },
        ];

        // Set the children for the info item
        infoItem.children = infoSubMenu;

        // Change action to navigate to submenu
        infoItem.action = () => {
          if (infoItem.children && infoItem.children.length > 0) {
            this.navigateToSubMenu(infoItem.children);
          }
        };
      }
    }

    // Alliance options
    if (actions?.interaction?.canSendAllianceRequest) {
      const allyItem = this.findMenuItem(Slot.Ally.toString());
      if (allyItem) {
        allyItem.disabled = false;
        allyItem.color = "#53ac75";
        allyItem.icon = allianceIcon;
        allyItem.action = () => {
          this.eventBus.emit(
            new SendAllianceRequestIntentEvent(
              myPlayer,
              this.g.owner(tile) as PlayerView,
            ),
          );
        };
      }
    }

    if (actions?.interaction?.canBreakAlliance) {
      const allyItem = this.findMenuItem(Slot.Ally.toString());
      if (allyItem) {
        allyItem.disabled = false;
        allyItem.color = "#c74848";
        allyItem.icon = traitorIcon;
        allyItem.action = () => {
          this.eventBus.emit(
            new SendBreakAllianceIntentEvent(
              myPlayer,
              this.g.owner(tile) as PlayerView,
            ),
          );
        };
      }
    }

    // Boat option
    if (
      actions.buildableUnits.find((bu) => bu.type === UnitType.TransportShip)
        ?.canBuild
    ) {
      const boatItem = this.findMenuItem(Slot.Boat.toString());
      if (boatItem) {
        boatItem.disabled = false;
        boatItem.color = "#3f6ab1";
        boatItem.icon = boatIcon;
        boatItem.action = () => {
          // BestTransportShipSpawn is an expensive operation
          myPlayer.bestTransportShipSpawn(tile).then((spawn) => {
            let spawnTile: Cell | null = null;
            if (spawn !== false) {
              spawnTile = new Cell(this.g.x(spawn), this.g.y(spawn));
            }

            if (this.clickedCell === null) return;
            this.eventBus.emit(
              new SendBoatAttackIntentEvent(
                this.g.owner(tile).id(),
                this.clickedCell,
                this.uiState.attackRatio * myPlayer.troops(),
                spawnTile,
              ),
            );
          });
        };
      }
    }

    // Attack option (center button)
    if (actions.canAttack) {
      this.enableCenterButton(true, () => {
        if (this.clickedCell === null) return;
        const clicked = this.g.ref(this.clickedCell.x, this.clickedCell.y);
        const myPlayer = this.g.myPlayer();
        if (myPlayer !== null && this.g.owner(clicked) !== myPlayer) {
          this.eventBus.emit(
            new SendAttackIntentEvent(
              this.g.owner(clicked).id(),
              this.uiState.attackRatio * myPlayer.troops(),
            ),
          );
        }
        this.hideRadialMenu();
      });
    }

    // Refresh menu display with updated items
    this.refreshMenu();
  }

  /**
   * Find a menu item by id in the current menu items
   */
  private findMenuItem(id: string): MenuItem | undefined {
    return this.currentMenuItems.find((item) => item.id === id);
  }

  /**
   * Reset the menu to its initial state
   */
  private resetMenu() {
    // Reset to root menu
    this.currentLevel = 0;
    this.menuStack = [];
    this.currentMenuItems = JSON.parse(JSON.stringify(this.rootMenuItems));

    // Clear all stored menu elements
    this.menuGroups.clear();
    this.menuPaths.clear();
    this.menuIcons.clear();

    // Clear any existing menu elements
    const container = this.menuElement.select(".menu-container");
    container.selectAll("[class^='menu-level-']").remove();
  }

  /**
   * Refresh the menu display with current items
   */
  private refreshMenu() {
    if (!this.isVisible) return;
    // Render without frequent updates
    this.renderMenuItems(this.currentMenuItems, this.currentLevel);
  }

  private onPointerUp(event: MouseUpEvent) {
    // Don't close the menu if it was just opened (within 300ms)
    const currentTime = new Date().getTime();
    if (this.isVisible && currentTime - this.contextMenuOpenedTime < 300) {
      return;
    }

    // Don't close during transitions between menu levels
    if (this.isTransitioning) {
      return;
    }

    // If clicking outside the menu, close it
    this.hideRadialMenu();
    this.emojiTable.hideTable();
    this.buildMenu.hideMenu();
    this.playerInfoOverlay.hide();
  }

  private showRadialMenu(x: number, y: number) {
    // Reset menu state before showing
    this.resetMenu();
    this.isTransitioning = false;
    this.selectedItemId = null;

    // Display the full-screen overlay
    this.menuElement.style("display", "block");

    // Position the SVG within the overlay
    this.menuElement
      .select("svg")
      .style("top", `${y}px`)
      .style("left", `${x}px`)
      .style("transform", `translate(-50%, -50%)`);

    this.playerInfoOverlay.maybeShow(x, y);
    this.isVisible = true;

    // Render root menu items immediately without animation
    this.renderMenuItems(this.currentMenuItems, this.currentLevel);
  }

  private hideRadialMenu() {
    // Only hide if it's visible and not transitioning
    if (!this.isVisible || this.isTransitioning) {
      return;
    }

    this.menuElement.style("display", "none");
    this.isVisible = false;
    this.playerInfoOverlay.hide();
    this.lastClosed = new Date().getTime();
    this.selectedItemId = null;

    // Reset menu state
    this.resetMenu();
    this.isTransitioning = false;

    // Clear all stored references
    this.menuGroups.clear();
    this.menuPaths.clear();
    this.menuIcons.clear();
  }

  private handleCenterButtonClick() {
    if (!this.isCenterButtonEnabled || !this.centerButtonAction) {
      return;
    }
    console.log("Center button clicked");
    if (this.clickedCell === null) return;
    const clicked = this.g.ref(this.clickedCell.x, this.clickedCell.y);
    if (this.g.inSpawnPhase()) {
      this.eventBus.emit(new SendSpawnIntentEvent(this.clickedCell));
    } else {
      const myPlayer = this.g.myPlayer();
      if (myPlayer !== null && this.g.owner(clicked) !== myPlayer) {
        this.eventBus.emit(
          new SendAttackIntentEvent(
            this.g.owner(clicked).id(),
            this.uiState.attackRatio * myPlayer.troops(),
          ),
        );
      }
    }
    this.hideRadialMenu();
  }

  private disableAllButtons() {
    this.enableCenterButton(false);

    // Disable all menu items
    for (const item of this.currentMenuItems) {
      item.disabled = true;
      item.color = this.disabledColor;
    }
  }

  private enableCenterButton(enabled: boolean, action?: () => void) {
    this.isCenterButtonEnabled = enabled;
    if (action) {
      this.centerButtonAction = action;
    }

    const centerButton = this.menuElement.select(".center-button");

    centerButton
      .select(".center-button-hitbox")
      .style("cursor", enabled ? "pointer" : "not-allowed");

    centerButton
      .select(".center-button-visible")
      .attr("fill", enabled ? "#2c3e50" : "#999999");

    centerButton
      .select(".center-button-icon")
      .style("opacity", enabled ? 1 : 0.5);
  }

  private onCenterButtonHover(isHovering: boolean) {
    if (!this.isCenterButtonEnabled) return;

    const scale = isHovering ? 1.2 : 1;

    this.menuElement
      .select(".center-button-hitbox")
      .transition()
      .duration(200)
      .attr("r", this.centerButtonSize * scale);

    this.menuElement
      .select(".center-button-visible")
      .transition()
      .duration(200)
      .attr("r", this.centerButtonSize * scale);
  }
}
