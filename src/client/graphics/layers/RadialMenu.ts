import * as d3 from "d3";
import backIcon from "../../../../resources/images/BackIconWhite.svg";
import { Layer } from "./Layer";
import {
  CenterButtonElement,
  MenuElement,
  MenuElementParams,
} from "./RadialMenuElements";

export interface TooltipItem {
  text: string;
  className: string;
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
  tooltipStyle?: string;
}

type CenterButtonState = "default" | "back";

type RequiredRadialMenuConfig = Required<RadialMenuConfig>;

export class RadialMenu implements Layer {
  private menuElement: d3.Selection<HTMLDivElement, unknown, null, undefined>;
  private tooltipElement: HTMLDivElement | null = null;
  private isVisible: boolean = false;

  private currentLevel: number = 0; // Current menu level (0 = main menu, 1 = submenu, etc.)
  private menuStack: MenuElement[][] = []; // Stack to track menu navigation history
  private currentMenuItems: MenuElement[] = []; // Current active menu items (changes based on level)
  private rootMenuItems: MenuElement[] = []; // Store the original root menu items

  private readonly config: RequiredRadialMenuConfig;
  private readonly backIconSize: number;

  private centerButtonState: CenterButtonState = "default";
  private centerButtonElement: CenterButtonElement | null = null;

  private isTransitioning: boolean = false;
  private lastHideTime: number = 0;
  private reopenCooldownMs: number = 300;

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

  private params: MenuElementParams | null = null;

  constructor(config: RadialMenuConfig = {}) {
    this.config = {
      menuSize: config.menuSize ?? 190,
      submenuScale: config.submenuScale ?? 1.5,
      centerButtonSize: config.centerButtonSize ?? 30,
      iconSize: config.iconSize ?? 32,
      centerIconSize: config.centerIconSize ?? 48,
      disabledColor: config.disabledColor ?? d3.rgb(128, 128, 128).toString(),
      menuTransitionDuration: config.menuTransitionDuration ?? 300,
      mainMenuInnerRadius: config.mainMenuInnerRadius ?? 40,
      centerButtonIcon: config.centerButtonIcon ?? "",
      maxNestedLevels: config.maxNestedLevels ?? 3,
      innerRadiusIncrement: config.innerRadiusIncrement ?? 20,
      tooltipStyle: config.tooltipStyle ?? "",
    };
    this.originalCenterButtonIcon = this.config.centerButtonIcon;
    this.backIconSize = this.config.centerIconSize * 0.8;
  }

  init() {
    this.createMenuElement();
    this.createTooltipElement();
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
      this.config.menuSize *
      Math.pow(this.config.submenuScale, this.config.maxNestedLevels - 1);

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
      .attr("r", this.config.centerButtonSize)
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
      .attr("r", this.config.centerButtonSize)
      .attr("fill", "#2c3e50")
      .style("pointer-events", "none");

    centerButton
      .append("image")
      .attr("class", "center-button-icon")
      .attr("xlink:href", this.config.centerButtonIcon)
      .attr("width", this.config.centerIconSize)
      .attr("height", this.config.centerIconSize)
      .attr("x", -this.config.centerIconSize / 2)
      .attr("y", -this.config.centerIconSize / 2)
      .style("pointer-events", "none");
  }

  private createTooltipElement() {
    this.tooltipElement = document.createElement("div");
    this.tooltipElement.className = "radial-tooltip";
    this.tooltipElement.style.position = "absolute";
    this.tooltipElement.style.pointerEvents = "none";
    this.tooltipElement.style.background = "rgba(0, 0, 0, 0.7)";
    this.tooltipElement.style.color = "white";
    this.tooltipElement.style.padding = "6px 10px";
    this.tooltipElement.style.borderRadius = "6px";
    this.tooltipElement.style.fontSize = "12px";
    this.tooltipElement.style.zIndex = "10000";
    this.tooltipElement.style.maxWidth = "250px";
    this.tooltipElement.style.display = "none";
    document.body.appendChild(this.tooltipElement);

    const style = document.createElement("style");
    style.textContent = `
      .radial-tooltip .title {
        font-weight: bold;
        font-size: 14px;
        margin-bottom: 4px;
      }

      ${this.config.tooltipStyle}
    `;
    document.head.appendChild(style);
  }

  private getInnerRadiusForLevel(level: number): number {
    return level === 0 ? 50 : 50 + 25;
  }

  private getOuterRadiusForLevel(level: number): number {
    const innerRadius = this.getInnerRadiusForLevel(level);
    let arcWidth = 55;
    if (level !== 0) {
      arcWidth = 65;
    }
    return innerRadius + arcWidth;
  }

  private renderMenuItems(items: MenuElement[], level: number) {
    const container = this.menuElement.select(".menu-container");
    container.selectAll(`.menu-level-${level}`).remove();

    const menuGroup = container
      .append("g")
      .attr("class", `menu-level-${level}`);

    // Set initial animation styles only for submenus (level > 0)
    if (level === 0) {
      // Main menu appears immediately without animation
      menuGroup.style("opacity", 1).style("transform", "scale(1)");
    } else {
      // Submenus get the expansion animation
      menuGroup.style("opacity", 0).style("transform", "scale(0.5)");
    }

    this.menuGroups.set(level, menuGroup as any);

    const offset = -Math.PI / items.length;

    const pie = d3
      .pie<MenuElement>()
      .value(() => 1)
      .padAngle(0.03)
      .startAngle(offset)
      .endAngle(2 * Math.PI + offset);

    const innerRadius = this.getInnerRadiusForLevel(level);
    const outerRadius = this.getOuterRadiusForLevel(level);

    const arc = d3
      .arc<d3.PieArcDatum<MenuElement>>()
      .innerRadius(innerRadius)
      .outerRadius(outerRadius);

    const arcs = menuGroup
      .selectAll(".menu-item")
      .data(pie(items))
      .enter()
      .append("g")
      .attr("class", "menu-item-group");

    this.renderPaths(arcs, arc, level);
    this.setupEventHandlers(arcs, level);
    this.renderIconsAndText(arcs, arc);
    this.setupAnimations(menuGroup);

    return menuGroup;
  }

  private renderPaths(
    arcs: d3.Selection<
      SVGGElement,
      d3.PieArcDatum<MenuElement>,
      SVGGElement,
      unknown
    >,
    arc: d3.Arc<any, d3.PieArcDatum<MenuElement>>,
    level: number,
  ) {
    arcs
      .append("path")
      .attr("class", "menu-item-path")
      .attr("d", arc)
      .attr("fill", (d) => {
        const disabled = this.params === null || d.data.disabled(this.params);
        const color = disabled
          ? this.config.disabledColor
          : d.data.color || "#333333";
        const opacity = disabled ? 0.5 : 0.7;

        if (d.data.id === this.selectedItemId && this.currentLevel > level) {
          return color;
        }

        return d3.color(color)?.copy({ opacity: opacity })?.toString() || color;
      })
      .attr("stroke", "#ffffff")
      .attr("stroke-width", "2")
      .style("cursor", (d) =>
        this.params === null || d.data.disabled(this.params)
          ? "not-allowed"
          : "pointer",
      )
      .style("opacity", (d) =>
        this.params === null || d.data.disabled(this.params) ? 0.5 : 1,
      )
      .style(
        "transition",
        `filter ${this.config.menuTransitionDuration / 2}ms, stroke-width ${
          this.config.menuTransitionDuration / 2
        }ms, fill ${this.config.menuTransitionDuration / 2}ms`,
      )
      .attr("data-id", (d) => d.data.id);

    arcs.each((d) => {
      const pathId = d.data.id;
      const path = d3.select(`path[data-id="${pathId}"]`);
      this.menuPaths.set(pathId, path as any);

      if (
        pathId === this.selectedItemId &&
        level === 0 &&
        this.currentLevel > 0
      ) {
        path.attr("filter", "url(#glow)");
        path.attr("stroke-width", "3");

        const color =
          this.params === null || d.data.disabled(this.params)
            ? this.config.disabledColor
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
  }

  private setupEventHandlers(
    arcs: d3.Selection<
      SVGGElement,
      d3.PieArcDatum<MenuElement>,
      SVGGElement,
      unknown
    >,
    level: number,
  ) {
    const onHover = (d: d3.PieArcDatum<MenuElement>, path: any) => {
      const disabled = this.params === null || d.data.disabled(this.params);
      if (d.data.tooltipItems && d.data.tooltipItems.length > 0) {
        this.showTooltip(d.data.tooltipItems);
      }
      if (
        disabled ||
        (this.currentLevel > 0 && this.currentLevel !== level) ||
        this.navigationInProgress
      ) {
        return;
      }

      path.attr("filter", "url(#glow)");
      path.attr("stroke-width", "3");
    };

    const onMouseOut = (d: d3.PieArcDatum<MenuElement>, path: any) => {
      const disabled = this.params === null || d.data.disabled(this.params);
      if (this.submenuHoverTimeout !== null) {
        window.clearTimeout(this.submenuHoverTimeout);
        this.submenuHoverTimeout = null;
      }

      this.hideTooltip();

      if (
        disabled ||
        (this.currentLevel > 0 &&
          level === 0 &&
          d.data.id === this.selectedItemId)
      )
        return;
      path.attr("filter", null);
      path.attr("stroke-width", "2");
      const color = disabled
        ? this.config.disabledColor
        : d.data.color || "#333333";
      const opacity = disabled ? 0.5 : 0.7;
      path.attr(
        "fill",
        d3.color(color)?.copy({ opacity: opacity })?.toString() || color,
      );
    };

    const onClick = (d: d3.PieArcDatum<MenuElement>, event: Event) => {
      event.stopPropagation();
      if (
        this.params === null ||
        d.data.disabled(this.params) ||
        this.navigationInProgress
      )
        return;

      if (
        this.currentLevel > 0 &&
        level === 0 &&
        d.data.id !== this.selectedItemId
      )
        return;

      const subMenu = d.data.subMenu?.(this.params);
      if (subMenu && subMenu.length > 0) {
        this.navigationInProgress = true;
        this.selectedItemId = d.data.id;
        this.navigateToSubMenu(subMenu);
        this.updateCenterButtonState("back");
      } else {
        d.data.action?.(this.params);
        this.hideRadialMenu();
      }
    };

    function handleMouseMove(event: MouseEvent) {
      const tooltipEl = document.querySelector(
        ".radial-tooltip",
      ) as HTMLElement;
      if (tooltipEl && tooltipEl.style.display !== "none") {
        tooltipEl.style.left = event.pageX + 10 + "px";
        tooltipEl.style.top = event.pageY + 10 + "px";
      }
    }

    arcs.each((d) => {
      const pathId = d.data.id;
      const path = d3.select(`path[data-id="${pathId}"]`);

      path.on("mouseover", function () {
        onHover(d, path);
      });

      path.on("mouseout", function () {
        onMouseOut(d, path);
      });

      path.on("mousemove", function (event) {
        handleMouseMove(event as MouseEvent);
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
  }

  private renderIconsAndText(
    arcs: d3.Selection<
      SVGGElement,
      d3.PieArcDatum<MenuElement>,
      SVGGElement,
      unknown
    >,
    arc: d3.Arc<any, d3.PieArcDatum<MenuElement>>,
  ) {
    arcs
      .append("g")
      .attr("class", "menu-item-content")
      .style("pointer-events", "none")
      .attr("data-id", (d) => d.data.id)
      .each((d) => {
        const contentId = d.data.id;
        const content = d3.select(`g[data-id="${contentId}"]`);
        const disabled =
          this.params === null ||
          this.params.game.inSpawnPhase() ||
          d.data.disabled(this.params);

        if (d.data.text) {
          content
            .append("text")
            .attr("text-anchor", "middle")
            .attr("dominant-baseline", "central")
            .attr("x", arc.centroid(d)[0])
            .attr("y", arc.centroid(d)[1])
            .attr("fill", "white")
            .attr("font-size", d.data.fontSize ?? "12px")
            .attr("font-family", "Arial, sans-serif")
            .style("opacity", disabled ? 0.5 : 1)
            .text(d.data.text);
        } else {
          content
            .append("image")
            .attr("xlink:href", d.data.icon!)
            .attr("width", this.config.iconSize)
            .attr("height", this.config.iconSize)
            .attr("x", arc.centroid(d)[0] - this.config.iconSize / 2)
            .attr("y", arc.centroid(d)[1] - this.config.iconSize / 2)
            .attr("opacity", disabled ? 0.5 : 1);
        }

        this.menuIcons.set(contentId, content as any);
      });
  }

  private setupAnimations(
    menuGroup: d3.Selection<SVGGElement, unknown, null, undefined>,
  ) {
    menuGroup
      .transition()
      .duration(this.config.menuTransitionDuration * 0.8)
      .style("opacity", 1)
      .style("transform", "scale(1)")
      .on("start", () => {
        this.isTransitioning = true;
      })
      .on("end", () => {
        this.isTransitioning = false;
      });
  }

  private navigateToSubMenu(children: MenuElement[]) {
    this.isTransitioning = true;

    this.menuStack.push(this.currentMenuItems);
    this.currentMenuItems = children;
    this.currentLevel++;

    this.renderMenuItems(this.currentMenuItems, this.currentLevel);
    this.updateMenuGroupVisibility();
    this.animatePreviousMenu();
  }

  private updateMenuGroupVisibility() {
    // Hide all menus except the current and immediate previous one
    this.menuGroups.forEach((menuGroup, level) => {
      if (level === this.currentLevel) {
        menuGroup.style("display", "block");
      } else if (level === this.currentLevel - 1) {
        menuGroup.style("display", "block");

        menuGroup
          .transition()
          .duration(this.config.menuTransitionDuration * 0.8)
          .style("transform", "scale(0.5)")
          .style("opacity", 0.8);

        menuGroup.selectAll("path").each(function () {
          const pathElement = d3.select(this);
          pathElement.style("pointer-events", "none");
        });
      } else {
        menuGroup
          .transition()
          .duration(this.config.menuTransitionDuration * 0.5)
          .style("transform", "scale(0.5)")
          .style("opacity", 0)
          .on("end", function () {
            d3.select(this).style("display", "none");
          });
      }
    });
  }

  private animatePreviousMenu() {
    const container = this.menuElement.select(".menu-container");
    const currentMenu = container.select(
      `.menu-level-${this.currentLevel - 1}`,
    );

    currentMenu
      .transition()
      .duration(this.config.menuTransitionDuration * 0.8)
      .style("transform", `scale(${this.currentLevel === 1 ? "0.65" : "0.5"})`)
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

    this.updateMenuLevels();
    this.clearSelectedItemHoverState();
    this.updateMenuVisibility();
    this.animateMenuTransitions();
  }

  private updateMenuLevels() {
    const previousItems = this.menuStack.pop();
    const previousLevel = this.currentLevel - 1;
    this.currentLevel = previousLevel;

    if (previousLevel === 0) {
      this.selectedItemId = null;
    }

    this.currentMenuItems = previousItems || [];

    if (this.currentLevel === 0) {
      this.updateCenterButtonState("default");
    }
  }

  private clearSelectedItemHoverState() {
    // Clear the hover state on the item that opened the submenu
    if (this.selectedItemId) {
      const selectedPath = this.menuPaths.get(this.selectedItemId);
      if (selectedPath) {
        selectedPath.attr("filter", null);
        selectedPath.attr("stroke-width", "2");

        const item = this.findMenuItem(this.selectedItemId);
        if (item) {
          const disabled = this.params === null || item.disabled(this.params);
          const color = disabled
            ? this.config.disabledColor
            : item.color || "#333333";
          const opacity = disabled ? 0.5 : 0.7;
          selectedPath.attr(
            "fill",
            d3.color(color)?.copy({ opacity: opacity })?.toString() || color,
          );
        }
      }
    }
  }

  private updateMenuVisibility() {
    this.menuGroups.forEach((menuGroup, level) => {
      if (level === this.currentLevel) {
        menuGroup.style("display", "block");
        menuGroup
          .transition()
          .duration(this.config.menuTransitionDuration * 0.8)
          .style("transform", "scale(1)")
          .style("opacity", 1);

        menuGroup.selectAll("path").style("pointer-events", "auto");
      } else if (level === this.currentLevel - 1 && this.currentLevel > 0) {
        menuGroup.style("display", "block");
        menuGroup
          .transition()
          .duration(this.config.menuTransitionDuration * 0.8)
          .style(
            "transform",
            `scale(${this.currentLevel === 1 ? "0.65" : "0.5"})`,
          )
          .style("opacity", 0.8);
      } else if (level !== this.currentLevel + 1) {
        menuGroup
          .transition()
          .duration(this.config.menuTransitionDuration * 0.5)
          .style("opacity", 0)
          .on("end", function () {
            d3.select(this).style("display", "none");
          });
      }
    });
  }

  private animateMenuTransitions() {
    const container = this.menuElement.select(".menu-container");
    const currentSubmenu = container.select(
      `.menu-level-${this.currentLevel + 1}`,
    );
    const previousMenu = container.select(`.menu-level-${this.currentLevel}`);

    // Animate the current submenu (sliding out)
    currentSubmenu
      .transition()
      .duration(this.config.menuTransitionDuration * 0.8)
      .style("transform", "scale(0.5)")
      .style("opacity", 0)
      .on("end", function () {
        d3.select(this).remove();
      });

    // Handle previous menu animation
    if (previousMenu.empty()) {
      this.renderAndAnimateNewMenu();
    } else {
      this.animateExistingMenu(previousMenu);
    }
  }

  private renderAndAnimateNewMenu() {
    const menu = this.renderMenuItems(this.currentMenuItems, this.currentLevel);
    menu
      .style("transform", "scale(0.8)")
      .style("opacity", 0.3)
      .transition()
      .duration(this.config.menuTransitionDuration * 0.8)
      .style("transform", "scale(1)")
      .style("opacity", 1)
      .on("end", () => {
        this.isTransitioning = false;
        this.navigationInProgress = false;
      });
  }

  private animateExistingMenu(
    previousMenu: d3.Selection<any, unknown, null, undefined>,
  ) {
    previousMenu
      .transition()
      .duration(this.config.menuTransitionDuration * 0.8)
      .style("transform", "scale(1)")
      .style("opacity", 1)
      .on("end", () => {
        this.isTransitioning = false;
        this.navigationInProgress = false;
      });

    previousMenu.selectAll("path").style("pointer-events", "auto");
  }

  public showRadialMenu(x: number, y: number) {
    if (!this.isReopeningAllowed()) return;

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
    this.hideTooltip();

    this.resetMenu();
    this.isTransitioning = false;

    this.menuGroups.clear();
    this.menuPaths.clear();
    this.menuIcons.clear();

    this.lastHideTime = Date.now();
  }

  private handleCenterButtonClick() {
    if (this.centerButtonState === "default") {
      if (this.params) {
        this.centerButtonElement?.action(this.params);
      }
      return;
    }

    if (this.centerButtonState === "back") {
      this.navigationInProgress = true;
      this.navigateBack();
      return;
    }
  }

  public disableAllButtons() {
    this.updateCenterButtonState("default");

    for (const item of this.currentMenuItems) {
      item.color = this.config.disabledColor;
    }
  }

  public updateCenterButtonState(state: CenterButtonState) {
    this.centerButtonState = state;
    if (state === "back") {
      this.menuElement
        .select(".center-button-hitbox")
        .transition()
        .duration(0)
        .attr("r", this.config.centerButtonSize);
      this.menuElement
        .select(".center-button-visible")
        .transition()
        .duration(0)
        .attr("r", this.config.centerButtonSize);

      const backIconImg = this.menuElement.select(".center-button-icon");
      backIconImg
        .attr("xlink:href", backIcon)
        .attr("width", this.backIconSize)
        .attr("height", this.backIconSize)
        .attr("x", -this.backIconSize / 2)
        .attr("y", -this.backIconSize / 2);
    }
    if (state === "default") {
      const iconImg = this.menuElement.select(".center-button-icon");
      iconImg
        .attr("xlink:href", this.originalCenterButtonIcon)
        .attr("width", this.config.centerIconSize)
        .attr("height", this.config.centerIconSize)
        .attr("x", -this.config.centerIconSize / 2)
        .attr("y", -this.config.centerIconSize / 2);
    }

    const centerButton = this.menuElement.select(".center-button");

    const enabled = this.isCenterButtonEnabled();

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

  private isCenterButtonEnabled(): boolean {
    // Back button should always be enabled when in submenu levels
    if (this.currentLevel > 0) {
      return true;
    }

    if (this.params && this.centerButtonElement) {
      return !this.centerButtonElement.disabled(this.params);
    }
    return false;
  }

  private onCenterButtonHover(isHovering: boolean) {
    if (!this.isCenterButtonEnabled()) return;

    const scale = isHovering ? 1.2 : 1;

    this.menuElement
      .select(".center-button-hitbox")
      .transition()
      .duration(200)
      .attr("r", this.config.centerButtonSize * scale);

    this.menuElement
      .select(".center-button-visible")
      .transition()
      .duration(200)
      .attr("r", this.config.centerButtonSize * scale);
  }

  public isMenuVisible(): boolean {
    return this.isVisible;
  }

  public getCurrentLevel(): number {
    return this.currentLevel;
  }

  public setRootMenuItems(
    items: MenuElement[],
    centerButton: CenterButtonElement,
  ) {
    this.currentMenuItems = [...items];
    this.rootMenuItems = [...items];
    this.centerButtonElement = centerButton;
    if (this.isVisible) {
      this.refreshMenu();
    }
  }

  public setParams(params: MenuElementParams) {
    this.params = params;
  }

  private findMenuItem(id: string): MenuElement | undefined {
    return this.currentMenuItems.find((item) => item.id === id);
  }

  private resetMenu() {
    this.currentLevel = 0;
    this.menuStack = [];

    this.currentMenuItems = [...this.rootMenuItems];

    this.navigationInProgress = false;

    this.menuGroups.clear();
    this.menuPaths.clear();
    this.menuIcons.clear();

    const menuContainer = this.menuElement?.select(".menu-container");
    if (menuContainer) {
      menuContainer.selectAll("[class^='menu-level-']").remove();
    }

    this.updateCenterButtonState("default");

    if (this.submenuHoverTimeout !== null) {
      window.clearTimeout(this.submenuHoverTimeout);
      this.submenuHoverTimeout = null;
    }

    if (this.backButtonHoverTimeout !== null) {
      window.clearTimeout(this.backButtonHoverTimeout);
      this.backButtonHoverTimeout = null;
    }
  }

  public refreshMenu() {
    if (!this.isVisible) return;
    this.renderMenuItems(this.currentMenuItems, this.currentLevel);
  }

  renderLayer(context: CanvasRenderingContext2D) {
    // No need to render anything on the canvas
  }

  shouldTransform(): boolean {
    return false;
  }

  private isReopeningAllowed(): boolean {
    const now = Date.now();
    const timeSinceHide = now - this.lastHideTime;
    return timeSinceHide >= this.reopenCooldownMs;
  }

  private showTooltip(items: TooltipItem[]) {
    if (!this.tooltipElement) return;

    this.tooltipElement.innerHTML = "";

    for (const item of items) {
      const div = document.createElement("div");
      div.className = item.className;
      div.textContent = item.text;
      this.tooltipElement.appendChild(div);
    }

    this.tooltipElement.style.display = "block";
  }

  private hideTooltip() {
    if (this.tooltipElement) {
      this.tooltipElement.style.display = "none";
    }
  }
}
