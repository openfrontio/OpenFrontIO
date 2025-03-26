import * as d3 from "d3";
import boatIcon from "../../../../resources/images/BoatIconWhite.svg";
import buildIcon from "../../../../resources/images/BuildIconWhite.svg";
import disabledIcon from "../../../../resources/images/DisabledIcon.svg";
import infoIcon from "../../../../resources/images/InfoIcon.svg";
import swordIcon from "../../../../resources/images/SwordIconWhite.svg";
import xIcon from "../../../../resources/images/XIcon.svg";
import { consolex } from "../../../core/Consolex";
import { EventBus } from "../../../core/EventBus";
import { Cell, PlayerActions } from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { ClientID } from "../../../core/Schemas";
import {
  CloseViewEvent,
  ContextMenuEvent,
  MouseUpEvent,
  ShowBuildMenuEvent,
} from "../../InputHandler";
import {
  SendAttackIntentEvent,
  SendBoatAttackIntentEvent,
  SendSpawnIntentEvent,
} from "../../Transport";
import { TransformHandler } from "../TransformHandler";
import { UIState } from "../UIState";
import { BuildMenu } from "./BuildMenu";
import { EmojiTable } from "./EmojiTable";
import { Layer } from "./Layer";
import { PlayerInfoOverlay } from "./PlayerInfoOverlay";
import { PlayerPanel } from "./PlayerPanel";

enum Slot {
  Info,
  Boat,
  Build,
  Close,
}

export class RadialMenu implements Layer {
  private clickedCell: Cell | null = null;
  private lastClosed: number = 0;

  private menuElement: d3.Selection<HTMLDivElement, unknown, null, undefined>;
  private isVisible: boolean = false;
  private readonly menuItems = new Map([
    [
      Slot.Boat,
      {
        name: "boat",
        disabled: true,
        action: () => {},
        color: null,
        icon: null,
      },
    ],
    [Slot.Close, { name: "close", disabled: true, action: () => {} }],
    [Slot.Build, { name: "build", disabled: true, action: () => {} }],
    [
      Slot.Info,
      {
        name: "info",
        disabled: true,
        action: () => {},
        color: null,
        icon: null,
      },
    ],
  ]);

  private readonly menuSize = 190;
  private readonly centerButtonSize = 30;
  private readonly iconSize = 32;
  private readonly centerIconSize = 48;
  private readonly disabledColor = d3.rgb(128, 128, 128).toString();

  private isCenterButtonEnabled = false;

  constructor(
    private eventBus: EventBus,
    private g: GameView,
    private transformHandler: TransformHandler,
    private clientID: ClientID,
    private emojiTable: EmojiTable,
    private buildMenu: BuildMenu,
    private uiState: UIState,
    private playerInfoOverlay: PlayerInfoOverlay,
    private playerPanel: PlayerPanel,
  ) {}

  init() {
    this.eventBus.on(ContextMenuEvent, (e) => this.onContextMenu(e));
    this.eventBus.on(MouseUpEvent, (e) => this.onPointerUp(e));
    this.eventBus.on(ShowBuildMenuEvent, (e) => {
      const clickedCell = this.transformHandler.screenToWorldCoordinates(
        e.x,
        e.y,
      );
      if (clickedCell == null) {
        return;
      }
      if (!this.g.isValidCoord(clickedCell.x, clickedCell.y)) {
        return;
      }
      const tile = this.g.ref(clickedCell.x, clickedCell.y);
      const p = this.g.playerByClientID(this.clientID);
      if (p == null) {
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

  private createMenuElement() {
    this.menuElement = d3
      .select(document.body)
      .append("div")
      .style("position", "fixed")
      .style("display", "none")
      .style("z-index", "9999")
      .style("touch-action", "none")
      .on("contextmenu", (e) => {
        e.preventDefault();
      });

    const svg = this.menuElement
      .append("svg")
      .attr("width", this.menuSize)
      .attr("height", this.menuSize)
      .append("g")
      .attr(
        "transform",
        `translate(${this.menuSize / 2},${this.menuSize / 2})`,
      );

    const pie = d3
      .pie<any>()
      .value(() => 1)
      .padAngle(0.03)
      .startAngle(Math.PI / 4) // Start at 45 degrees (π/4 radians)
      .endAngle(2 * Math.PI + Math.PI / 4); // Complete the circle but shifted by 45 degrees

    const arc = d3
      .arc<any>()
      .innerRadius(this.centerButtonSize + 5)
      .outerRadius(this.menuSize / 2 - 10);

    const arcs = svg
      .selectAll("path")
      .data(pie(Array.from(this.menuItems.values())))
      .enter()
      .append("g");

    arcs
      .append("path")
      .attr("d", arc)
      .attr("fill", (d) =>
        d.data.disabled ? this.disabledColor : d.data.color,
      )
      .attr("stroke", "#ffffff")
      .attr("stroke-width", "2")
      .style("cursor", (d) => (d.data.disabled ? "not-allowed" : "pointer"))
      .style("opacity", (d) => (d.data.disabled ? 0.5 : 1))
      .attr("data-name", (d) => d.data.name)
      .on("mouseover", function (event, d) {
        if (!d.data.disabled) {
          d3.select(this)
            .transition()
            .duration(200)
            .attr("transform", "scale(1.05)")
            .attr("filter", "url(#glow)");
        }
      })
      .on("mouseout", function (event, d) {
        if (!d.data.disabled) {
          d3.select(this)
            .transition()
            .duration(200)
            .attr("transform", "scale(1)")
            .attr("filter", null);
        }
      })
      .on("click", (event, d) => {
        if (!d.data.disabled) {
          d.data.action();
          this.hideRadialMenu();
        }
      })
      .on("touchstart", (event, d) => {
        event.preventDefault();
        if (!d.data.disabled) {
          d.data.action();
          this.hideRadialMenu();
        }
      });

    arcs
      .append("image")
      .attr("xlink:href", (d) => d.data.icon)
      .attr("width", this.iconSize)
      .attr("height", this.iconSize)
      .attr("x", (d) => arc.centroid(d)[0] - this.iconSize / 2)
      .attr("y", (d) => arc.centroid(d)[1] - this.iconSize / 2)
      .style("pointer-events", "none")
      .attr("data-name", (d) => d.data.name);

    // Add glow filter
    const defs = svg.append("defs");
    const filter = defs.append("filter").attr("id", "glow");
    filter
      .append("feGaussianBlur")
      .attr("stdDeviation", "3")
      .attr("result", "coloredBlur");
    const feMerge = filter.append("feMerge");
    feMerge.append("feMergeNode").attr("in", "coloredBlur");
    feMerge.append("feMergeNode").attr("in", "SourceGraphic");

    const centerButton = svg.append("g").attr("class", "center-button");

    centerButton
      .append("circle")
      .attr("class", "center-button-hitbox")
      .attr("r", this.centerButtonSize)
      .attr("fill", "transparent")
      .style("cursor", "pointer")
      .on("click", () => this.handleCenterButtonClick())
      .on("touchstart", (event: Event) => {
        event.preventDefault();
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

  tick() {
    // Update logic if needed
  }

  renderLayer(context: CanvasRenderingContext2D) {
    // No need to render anything on the canvas
  }

  shouldTransform(): boolean {
    return false;
  }

  private onContextMenu(event: ContextMenuEvent) {
    if (this.lastClosed + 200 > new Date().getTime()) return;
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
    this.enableCenterButton(false);
    for (const item of this.menuItems.values()) {
      item.disabled = true;
      this.updateMenuItemState(item);
    }

    this.clickedCell = this.transformHandler.screenToWorldCoordinates(
      event.x,
      event.y,
    );
    if (!this.g.isValidCoord(this.clickedCell.x, this.clickedCell.y)) {
      return;
    }
    const tile = this.g.ref(this.clickedCell.x, this.clickedCell.y);

    if (this.g.inSpawnPhase()) {
      if (this.g.isLand(tile) && !this.g.hasOwner(tile)) {
        this.enableCenterButton(true);
      }
      return;
    }

    const myPlayer = this.g
      .playerViews()
      .find((p) => p.clientID() == this.clientID);
    if (!myPlayer) {
      consolex.warn("my player not found");
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
    this.activateMenuElement(Slot.Build, "#ebe250", buildIcon, () => {
      this.buildMenu.showMenu(tile);
    });
    if (this.g.hasOwner(tile)) {
      this.activateMenuElement(Slot.Info, "#64748B", infoIcon, () => {
        this.playerPanel.show(actions, tile);
      });
    }
    this.activateMenuElement(Slot.Close, "#DC2626", xIcon, () => {});

    if (actions.canBoat) {
      this.activateMenuElement(Slot.Boat, "#3f6ab1", boatIcon, () => {
        this.eventBus.emit(
          new SendBoatAttackIntentEvent(
            this.g.owner(tile).id(),
            this.clickedCell,
            this.uiState.attackRatio * myPlayer.troops(),
          ),
        );
      });
    }
    if (actions.canAttack) {
      this.enableCenterButton(true);
    }

    if (!this.g.hasOwner(tile)) {
      return;
    }
  }

  private onPointerUp(event: MouseUpEvent) {
    this.hideRadialMenu();
    this.emojiTable.hideTable();
    this.buildMenu.hideMenu();
    this.playerInfoOverlay.hide();
  }

  private showRadialMenu(x: number, y: number) {
    // Delay so center button isn't clicked immediately on press.
    setTimeout(() => {
      this.menuElement
        .style("left", `${x - this.menuSize / 2}px`)
        .style("top", `${y - this.menuSize / 2}px`)
        .style("display", "block");
      this.playerInfoOverlay.maybeShow(x, y);
      this.isVisible = true;
    }, 50);
  }

  private hideRadialMenu() {
    this.menuElement.style("display", "none");
    this.isVisible = false;
    this.playerInfoOverlay.hide();
    this.lastClosed = new Date().getTime();
  }

  private handleCenterButtonClick() {
    if (!this.isCenterButtonEnabled) {
      return;
    }
    consolex.log("Center button clicked");
    const clicked = this.g.ref(this.clickedCell.x, this.clickedCell.y);
    if (this.g.inSpawnPhase()) {
      this.eventBus.emit(new SendSpawnIntentEvent(this.clickedCell));
    } else {
      const myPlayer = this.g.myPlayer();
      if (myPlayer != null && this.g.owner(clicked) != myPlayer) {
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

  private activateMenuElement(
    slot: Slot,
    color: string,
    icon: string,
    action: () => void,
  ) {
    const menuItem = this.menuItems.get(slot);
    menuItem.action = action;
    menuItem.disabled = false;
    menuItem.color = color;
    menuItem.icon = icon;
    this.updateMenuItemState(menuItem);
  }

  private updateMenuItemState(item: any) {
    const menuItem = this.menuElement.select(`path[data-name="${item.name}"]`);
    menuItem
      .attr("fill", item.disabled ? this.disabledColor : item.color)
      .style("cursor", item.disabled ? "not-allowed" : "pointer")
      .style("opacity", item.disabled ? 0.5 : 1);

    this.menuElement
      .select(`image[data-name="${item.name}"]`)
      .attr("xlink:href", item.disabled ? disabledIcon : item.icon)
      .attr("fill", item.disabled ? "#999999" : "white");
  }

  private onCenterButtonHover(isHovering: boolean) {
    if (!this.isCenterButtonEnabled) return;

    const scale = isHovering ? 1.2 : 1;
    const fontSize = isHovering ? "18px" : "16px";

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
    this.menuElement
      .select(".center-button-text")
      .transition()
      .duration(200)
      .style("font-size", fontSize);
  }

  private enableCenterButton(enabled: boolean) {
    this.isCenterButtonEnabled = enabled;
    const centerButton = this.menuElement.select(".center-button");

    centerButton
      .select(".center-button-hitbox")
      .style("cursor", enabled ? "pointer" : "not-allowed");

    centerButton
      .select(".center-button-visible")
      .attr("fill", enabled ? "#2c3e50" : "#999999");

    centerButton
      .select(".center-button-text")
      .attr("fill", enabled ? "white" : "#cccccc");
  }
}
