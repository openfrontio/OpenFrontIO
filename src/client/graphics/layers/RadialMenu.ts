import * as d3 from "d3";
import backIcon from "../../../../resources/images/BackIconWhite.svg";
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

export interface MenuItem {
  id: string;
  name: string;
  disabled: boolean;
  action: () => void;
  color?: string;
  icon?: string;
  children?: MenuItem[];
}
export interface RadialMenuConfig {
  menuSize?: number;
  submenuScale?: number;
  centerButtonSize?: number;
  iconSize?: number;
  centerIconSize?: number;
  disabledColor?: string;
  menuTransitionDuration?: number;
  mainMenuInnerRadius?: number;
  centerButtonIcon?: string;
  maxNestedLevels?: number;
  innerRadiusIncrement?: number;
}
export class RadialMenu implements Layer {
  private menuElement: d3.Selection<HTMLDivElement, unknown, null, undefined>;
  private isVisible: boolean = false;

  private currentLevel: number = 0; // Current menu level (0 = main menu, 1 = submenu, etc.)
  private menuStack: MenuItem[][] = []; // Stack to track menu navigation history
  private currentMenuItems: MenuItem[] = []; // Current active menu items (changes based on level)

  private readonly menuSize: number;
  private readonly submenuScale: number;
  private readonly centerButtonSize: number;
  private readonly iconSize: number;
  private readonly centerIconSize: number;
  private readonly backIconSize: number;
  private readonly disabledColor: string;
  private readonly menuTransitionDuration: number;
  private readonly mainMenuInnerRadius: number;
  private readonly innerRadiusIncrement: number;
  private readonly maxNestedLevels: number;
  private readonly centerButtonIcon: string;

  private isCenterButtonEnabled = false;
  private originalCenterButtonEnabled = false;
  private centerButtonAction: (() => void) | null = null;
  private originalCenterButtonAction: (() => void) | null = null;
  private backAction: (() => void) | null = null;

  private isTransitioning: boolean = false;

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

  private selectedItemId: string | null = null;
  private submenuHoverTimeout: number | null = null;
  private backButtonHoverTimeout: number | null = null;
  private navigationInProgress: boolean = false;
  private originalCenterButtonIcon: string = "";

  constructor(config: RadialMenuConfig = {}) {
    this.menuSize = config.menuSize || 190;
    this.submenuScale = config.submenuScale || 1.5;
    this.centerButtonSize = config.centerButtonSize || 30;
    this.iconSize = config.iconSize || 32;
    this.centerIconSize = config.centerIconSize || 48;
    this.backIconSize = config.centerIconSize
      ? config.centerIconSize * 0.8
      : 36;
    this.disabledColor =
      config.disabledColor || d3.rgb(128, 128, 128).toString();
    this.menuTransitionDuration = config.menuTransitionDuration || 300;
    this.mainMenuInnerRadius = config.mainMenuInnerRadius || 40;
    this.centerButtonIcon = config.centerButtonIcon || "";
    this.originalCenterButtonIcon = config.centerButtonIcon || "";
    this.maxNestedLevels = config.maxNestedLevels || 3;
    this.innerRadiusIncrement = config.innerRadiusIncrement || 20;
  }

  init() {
    this.createMenuElement();
  }

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
        this.hideRadialMenu();
      })
      .on("contextmenu", (e) => {
        e.preventDefault();
        this.hideRadialMenu();
      });

    // Calculate the total svg size needed for all potential nested menus
    const totalSize =
      this.menuSize * Math.pow(this.submenuScale, this.maxNestedLevels - 1);

    const svg = this.menuElement
      .append("svg")
      .attr("width", totalSize)
      .attr("height", totalSize)
      .style("position", "absolute")
      .style("top", "50%")
      .style("left", "50%")
      .style("transform", "translate(-50%, -50%)")
      .style("pointer-events", "all")
      .on("click", (event) => this.hideRadialMenu());

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
      .attr("xlink:href", this.centerButtonIcon)
      .attr("width", this.centerIconSize)
      .attr("height", this.centerIconSize)
      .attr("x", -this.centerIconSize / 2)
      .attr("y", -this.centerIconSize / 2)
      .style("pointer-events", "none");
  }

  private getInnerRadiusForLevel(level: number): number {
    const baseInnerRadius = this.mainMenuInnerRadius;

    if (level === 0) return baseInnerRadius;
    else if (level === 1)
      return baseInnerRadius + this.innerRadiusIncrement + 20;
    else
      return (
        baseInnerRadius +
        this.innerRadiusIncrement +
        20 +
        (level - 1) * (this.innerRadiusIncrement / 2)
      );
  }

  private getOuterRadiusForLevel(level: number): number {
    const innerRadius = this.getInnerRadiusForLevel(level);

    const arcWidth = this.menuSize / 2 - this.mainMenuInnerRadius - 10;

    return innerRadius + arcWidth;
  }

  private renderMenuItems(items: MenuItem[], level: number) {
    const container = this.menuElement.select(".menu-container");

    container.selectAll(`.menu-level-${level}`).remove();

    const menuGroup = container
      .append("g")
      .attr("class", `menu-level-${level}`);

    // Set initial animation styles
    if (level === 0) {
      menuGroup.style("opacity", 0.5).style("transform", "scale(0.2)");
    } else {
      menuGroup.style("opacity", 0).style("transform", "scale(0.5)");
    }

    this.menuGroups.set(level, menuGroup as any);

    const pie = d3
      .pie<MenuItem>()
      .value(() => 1)
      .padAngle(0.03)
      .startAngle(Math.PI / 4)
      .endAngle(2 * Math.PI + Math.PI / 4);

    const innerRadius = this.getInnerRadiusForLevel(level);
    const outerRadius = this.getOuterRadiusForLevel(level);

    const arc = d3
      .arc<d3.PieArcDatum<MenuItem>>()
      .innerRadius(innerRadius)
      .outerRadius(outerRadius);

    const arcs = menuGroup
      .selectAll(".menu-item")
      .data(pie(items))
      .enter()
      .append("g")
      .attr("class", "menu-item-group");

    const paths = arcs
      .append("path")
      .attr("class", "menu-item-path")
      .attr("d", arc)
      .attr("fill", (d) => {
        const color = d.data.disabled
          ? this.disabledColor
          : d.data.color || "#333333";
        const opacity = d.data.disabled ? 0.5 : 0.7;

        if (d.data.id === this.selectedItemId && this.currentLevel > level) {
          return color;
        }

        return d3.color(color)?.copy({ opacity: opacity })?.toString() || color;
      })
      .attr("stroke", "#ffffff")
      .attr("stroke-width", "2")
      .style("cursor", (d) => (d.data.disabled ? "not-allowed" : "pointer"))
      .style("opacity", (d) => (d.data.disabled ? 0.5 : 1))
      .style(
        "transition",
        `filter ${this.menuTransitionDuration / 2}ms, stroke-width ${this.menuTransitionDuration / 2}ms, fill ${this.menuTransitionDuration / 2}ms`,
      )
      .attr("data-id", (d) => d.data.id);

    paths.each((d) => {
      const path = d3.select(`path[data-id="${d.data.id}"]`) as any;
      this.menuPaths.set(d.data.id, path);

      if (
        d.data.id === this.selectedItemId &&
        level === 0 &&
        this.currentLevel > 0
      ) {
        path.attr("filter", "url(#glow)");
        path.attr("stroke-width", "3");

        const color = d.data.disabled
          ? this.disabledColor
          : d.data.color || "#333333";
        path.attr("fill", color);
      }
    });

    // Disable pointer events on previous menu levels
    this.menuGroups.forEach((group, menuLevel) => {
      if (menuLevel < this.currentLevel) {
        group.selectAll("path").each(function () {
          const pathElement = d3.select(this);
          pathElement.style("pointer-events", "none");
        });
      } else if (menuLevel === this.currentLevel) {
        group.selectAll("path").style("pointer-events", "auto");
      }
    });

    const onHover = (
      d: d3.PieArcDatum<MenuItem>,
      path: d3.Selection<any, any, any, any>,
    ) => {
      if (
        d.data.disabled ||
        (this.currentLevel > 0 && this.currentLevel !== level) ||
        this.navigationInProgress
      )
        return;

      path.attr("filter", "url(#glow)");
      path.attr("stroke-width", "3");
      const color = d.data.disabled
        ? this.disabledColor
        : d.data.color || "#333333";
      path.attr("fill", color);

      if (
        d.data.children &&
        d.data.children.length > 0 &&
        !d.data.disabled &&
        !(
          this.currentLevel > 0 &&
          d.data.id === this.selectedItemId &&
          level === 0
        )
      ) {
        if (this.submenuHoverTimeout !== null) {
          window.clearTimeout(this.submenuHoverTimeout);
        }

        // Set a small delay before opening submenu to prevent accidental triggers
        this.submenuHoverTimeout = window.setTimeout(() => {
          if (this.navigationInProgress) return;
          this.navigationInProgress = true;
          this.selectedItemId = d.data.id;
          this.navigateToSubMenu(d.data.children || []);
          this.setCenterButtonAsBack();
        }, 200);
      }
    };

    const onMouseOut = (
      d: d3.PieArcDatum<MenuItem>,
      path: d3.Selection<any, any, any, any>,
    ) => {
      if (this.submenuHoverTimeout !== null) {
        window.clearTimeout(this.submenuHoverTimeout);
        this.submenuHoverTimeout = null;
      }

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
      if (d.data.disabled || this.navigationInProgress) return;

      if (
        this.currentLevel > 0 &&
        level === 0 &&
        d.data.id !== this.selectedItemId
      )
        return;

      if (d.data.children && d.data.children.length > 0) {
        this.navigationInProgress = true;
        this.selectedItemId = d.data.id;
        this.navigateToSubMenu(d.data.children || []);
        this.setCenterButtonAsBack();
      } else if (typeof d.data.action === "function") {
        d.data.action();
        this.hideRadialMenu();
      } else {
        console.warn("Menu item action is not a function", d.data);
        this.hideRadialMenu();
      }
    };

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

    icons.each((d) => {
      const icon = d3.select(`image[data-id="${d.data.id}"]`) as any;
      this.menuIcons.set(d.data.id, icon);
    });

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

  private navigateToSubMenu(children: MenuItem[]) {
    this.isTransitioning = true;

    this.menuStack.push(this.currentMenuItems);
    this.currentMenuItems = children;
    this.currentLevel++;

    const container = this.menuElement.select(".menu-container");
    const currentMenu = container.select(
      `.menu-level-${this.currentLevel - 1}`,
    );

    this.renderMenuItems(children, this.currentLevel);

    for (let i = 0; i < this.currentLevel; i++) {
      const menuGroup = this.menuGroups.get(i);
      if (menuGroup) {
        menuGroup.selectAll("path").each(function () {
          const pathElement = d3.select(this);
          pathElement.style("pointer-events", "none");
        });
      }
    }

    currentMenu
      .transition()
      .duration(this.menuTransitionDuration * 0.8)
      .style("transform", `scale(${this.currentLevel > 1 ? 0.65 : 0.8})`)
      .style("opacity", 0.8)
      .on("end", () => {
        this.navigationInProgress = false;
      });
  }

  private navigateBack() {
    if (this.menuStack.length === 0) {
      return;
    }

    this.isTransitioning = true;

    const previousItems = this.menuStack.pop();
    const previousLevel = this.currentLevel - 1;
    this.currentLevel = previousLevel;

    // Clear the hover state on the item that opened the submenu
    if (this.selectedItemId) {
      const selectedPath = this.menuPaths.get(this.selectedItemId);
      if (selectedPath) {
        selectedPath.attr("filter", null);
        selectedPath.attr("stroke-width", "2");

        const item = this.findMenuItem(this.selectedItemId);
        if (item) {
          const color = item.disabled
            ? this.disabledColor
            : item.color || "#333333";
          const opacity = item.disabled ? 0.5 : 0.7;
          selectedPath.attr(
            "fill",
            d3.color(color)?.copy({ opacity: opacity })?.toString() || color,
          );
        }
      }
    }

    if (previousLevel === 0) {
      this.selectedItemId = null;
    }

    this.currentMenuItems = previousItems || [];

    const container = this.menuElement.select(".menu-container");
    const currentSubmenu = container.select(
      `.menu-level-${this.currentLevel + 1}`,
    );
    const previousMenu = container.select(`.menu-level-${this.currentLevel}`);

    if (this.currentLevel === 0) {
      this.resetCenterButton();
    }

    currentSubmenu
      .transition()
      .duration(this.menuTransitionDuration * 0.8)
      .style("transform", "scale(0.5)")
      .style("opacity", 0)
      .on("end", function () {
        d3.select(this).remove();
      });

    if (previousMenu.empty()) {
      const menu = this.renderMenuItems(
        this.currentMenuItems,
        this.currentLevel,
      );
      menu
        .style("transform", "scale(0.8)")
        .style("opacity", 0.3)
        .transition()
        .duration(this.menuTransitionDuration * 0.8)
        .style("transform", "scale(1)")
        .style("opacity", 1)
        .on("end", () => {
          this.isTransitioning = false;
          this.navigationInProgress = false;
        });
    } else {
      previousMenu
        .transition()
        .duration(this.menuTransitionDuration * 0.8)
        .style("transform", "scale(1)")
        .style("opacity", 1)
        .on("end", () => {
          this.isTransitioning = false;
          this.navigationInProgress = false;
        });

      previousMenu.selectAll("path").style("pointer-events", "auto");
    }
  }

  private setCenterButtonAsBack() {
    if (this.currentLevel === 1) {
      this.originalCenterButtonEnabled = this.isCenterButtonEnabled;
      this.originalCenterButtonAction = this.centerButtonAction;
    }

    this.backAction = () => {
      this.navigateBack();
    };

    // Clear any hover state on the center button
    this.menuElement
      .select(".center-button-hitbox")
      .transition()
      .duration(0)
      .attr("r", this.centerButtonSize);
    this.menuElement
      .select(".center-button-visible")
      .transition()
      .duration(0)
      .attr("r", this.centerButtonSize);

    const backIconImg = this.menuElement.select(".center-button-icon");
    backIconImg
      .attr("xlink:href", backIcon)
      .attr("width", this.backIconSize)
      .attr("height", this.backIconSize)
      .attr("x", -this.backIconSize / 2)
      .attr("y", -this.backIconSize / 2);

    this.enableCenterButton(true, this.backAction);
  }

  private resetCenterButton() {
    this.backAction = null;

    const iconImg = this.menuElement.select(".center-button-icon");
    iconImg
      .attr("xlink:href", this.originalCenterButtonIcon)
      .attr("width", this.centerIconSize)
      .attr("height", this.centerIconSize)
      .attr("x", -this.centerIconSize / 2)
      .attr("y", -this.centerIconSize / 2);

    this.enableCenterButton(
      this.originalCenterButtonEnabled,
      this.originalCenterButtonAction,
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

    this.menuElement.style("display", "block");

    this.menuElement
      .select("svg")
      .style("top", `${y}px`)
      .style("left", `${x}px`)
      .style("transform", `translate(-50%, -50%)`);

    this.isVisible = true;

    this.renderMenuItems(this.currentMenuItems, this.currentLevel);
    this.onCenterButtonHover(true);
  }

  public hideRadialMenu() {
    if (!this.isVisible || this.isTransitioning) {
      return;
    }

    this.menuElement.style("display", "none");
    this.isVisible = false;
    this.selectedItemId = null;

    this.resetMenu();
    this.isTransitioning = false;

    this.menuGroups.clear();
    this.menuPaths.clear();
    this.menuIcons.clear();
  }

  private handleCenterButtonClick() {
    if (
      !this.isCenterButtonEnabled ||
      !this.centerButtonAction ||
      this.navigationInProgress
    ) {
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

  public disableAllButtons() {
    this.originalCenterButtonEnabled = this.isCenterButtonEnabled;
    this.originalCenterButtonAction = this.centerButtonAction;

    this.enableCenterButton(false);

    for (const item of this.currentMenuItems) {
      item.disabled = true;
      item.color = this.disabledColor;
    }
  }

  public enableCenterButton(enabled: boolean, action?: (() => void) | null) {
    if (this.currentLevel > 0 && this.backAction) {
      this.isCenterButtonEnabled = true;

      if (action !== undefined && action !== this.backAction) {
        this.originalCenterButtonAction = action;
      }

      this.centerButtonAction = this.backAction;
    } else {
      this.isCenterButtonEnabled = enabled;
      if (action !== undefined) {
        this.centerButtonAction = action;
      }
    }

    const centerButton = this.menuElement.select(".center-button");

    centerButton
      .select(".center-button-hitbox")
      .style("cursor", this.isCenterButtonEnabled ? "pointer" : "not-allowed");

    centerButton
      .select(".center-button-visible")
      .attr("fill", this.isCenterButtonEnabled ? "#2c3e50" : "#999999");

    centerButton
      .select(".center-button-icon")
      .style("opacity", this.isCenterButtonEnabled ? 1 : 0.5);
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

    if (this.currentLevel > 0 && this.backAction) {
      if (isHovering) {
        if (this.backButtonHoverTimeout !== null) {
          window.clearTimeout(this.backButtonHoverTimeout);
        }

        this.backButtonHoverTimeout = window.setTimeout(() => {
          if (this.navigationInProgress || !this.backAction) return;

          this.navigationInProgress = true;
          this.backAction();
        }, 300);
      } else {
        if (this.backButtonHoverTimeout !== null) {
          window.clearTimeout(this.backButtonHoverTimeout);
          this.backButtonHoverTimeout = null;
        }
      }
    }
  }

  public isMenuVisible(): boolean {
    return this.isVisible;
  }

  public getCurrentLevel(): number {
    return this.currentLevel;
  }

  public updateMenuItem(
    id: string,
    enabled: boolean,
    color?: string,
    icon?: string,
  ) {
    const path = this.menuPaths.get(id);
    if (!path) return;

    const item = this.findMenuItem(id);
    if (item) {
      item.disabled = !enabled;
      if (color) item.color = enabled ? color : this.disabledColor;
      if (icon) item.icon = icon;
    }

    const fillColor = enabled && color ? color : this.disabledColor;
    const opacity = enabled ? 0.7 : 0.5;

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

    const iconElement = this.menuIcons.get(id);
    if (iconElement && icon) {
      iconElement.attr("xlink:href", enabled ? icon : disabledIcon);
    }
  }

  public setRootMenuItems(items: MenuItem[]) {
    this.currentMenuItems = [...items];
    if (this.isVisible) {
      this.refreshMenu();
    }
  }

  private findMenuItem(id: string): MenuItem | undefined {
    return this.currentMenuItems.find((item) => item.id === id);
  }

  private resetMenu() {
    this.currentLevel = 0;
    this.menuStack = [];
    this.backAction = null;
    this.navigationInProgress = false;

    this.menuGroups.clear();
    this.menuPaths.clear();
    this.menuIcons.clear();

    const menuContainer = this.menuElement?.select(".menu-container");
    if (menuContainer) {
      menuContainer.selectAll("[class^='menu-level-']").remove();
    }

    this.resetCenterButton();

    if (this.submenuHoverTimeout !== null) {
      window.clearTimeout(this.submenuHoverTimeout);
      this.submenuHoverTimeout = null;
    }

    if (this.backButtonHoverTimeout !== null) {
      window.clearTimeout(this.backButtonHoverTimeout);
      this.backButtonHoverTimeout = null;
    }
  }

  private refreshMenu() {
    if (!this.isVisible) return;
    this.renderMenuItems(this.currentMenuItems, this.currentLevel);
  }

  renderLayer(context: CanvasRenderingContext2D) {
    // No need to render anything on the canvas
  }

  shouldTransform(): boolean {
    return false;
  }
}
