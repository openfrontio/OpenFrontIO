import { assetUrl } from "src/core/AssetUrls";
import { EventBus } from "../../../core/EventBus";
import { PseudoRandom } from "../../../core/PseudoRandom";
import { Config, Theme } from "../../../core/configuration/Config";
import { Cell } from "../../../core/game/Game";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { UserSettings } from "../../../core/game/UserSettings";
import { AlternateViewEvent } from "../../InputHandler";
import { renderTroops } from "../../Utils";
import {
  ALLIANCE_ICON_ID,
  AllianceProgressIconRefs,
  createAllianceProgressIconRefs,
  EMOJI_ICON_KIND,
  getFirstPlacePlayer,
  getPlayerIcons,
  IMAGE_ICON_KIND,
  PlayerIconDescriptor,
  PlayerIconId,
  TRAITOR_ICON_ID,
  updateAllianceProgressIconRefs,
} from "../PlayerIcons";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

const PLAYER_NAME = "player-name";
const PLAYER_NAME_SPAN = "player-name-span";
const PLAYER_TROOPS = "player-troops";
const PLAYER_ICONS = "player-icons";
const PLAYER_FLAG = "player-flag";

class RenderInfo {
  public icons: Map<PlayerIconId, HTMLElement> = new Map();
  public allianceIconRefs: AllianceProgressIconRefs | null = null;

  constructor(
    public player: PlayerView,
    public lastRenderCalc: number,
    public location: Cell | null,
    public fontSize: number,
    public fontColor: string,
    public element: HTMLElement,
    public nameDiv: HTMLDivElement,
    public nameSpan: HTMLSpanElement,
    public troopsDiv: HTMLDivElement,
    public flagImg: HTMLImageElement,
    public iconsDiv: HTMLDivElement,
    public lastTransform: string = "",
  ) {}
}

export class NameLayer implements Layer {
  private config: Config;
  private lastChecked = 0;
  private renderCheckRate = 100;
  private renderRefreshRate = 500;
  private rand = new PseudoRandom(10);
  private renders: RenderInfo[] = [];
  private seenPlayers: Set<PlayerView> = new Set();
  private container: HTMLDivElement;
  private theme: Theme;
  private userSettings: UserSettings = new UserSettings();
  private isVisible: boolean = true;
  private firstPlace: PlayerView | null = null;
  private allianceDuration: number;
  private alliancesDisabled: boolean = false;
  private myPlayer: PlayerView | null = null;
  private lastContainerTransform: string = "";
  private basePlayerTemplate: HTMLDivElement;
  private iconTemplate: HTMLImageElement;
  private iconCenterTemplate: HTMLImageElement;
  private emojiTemplate: HTMLDivElement;

  constructor(
    private game: GameView,
    private transformHandler: TransformHandler,
    private eventBus: EventBus,
  ) {}

  shouldTransform(): boolean {
    return false;
  }

  redraw() {} // not affected by Canvas/WebGL context loss as this layer is DOM-based

  public init() {
    this.container = document.createElement("div");
    this.container.style.position = "fixed";
    this.container.style.left = "50%";
    this.container.style.top = "50%";
    this.container.style.pointerEvents = "none";
    this.container.style.zIndex = "2";
    document.body.appendChild(this.container);

    // Add CSS keyframes for traitor icon flashing animation
    // Append to container instead of document.head to keep styles scoped to this component
    const style = document.createElement("style");
    style.textContent = `
      @keyframes traitorFlash {
        0%, 100% {
          opacity: 1;
        }
        50% {
          opacity: 0.3;
        }
      }
    `;
    this.container.appendChild(style);

    this.myPlayer = this.game.myPlayer();
    this.config = this.game.config();
    this.theme = this.config.theme();

    this.alliancesDisabled = this.config.disableAlliances();
    this.allianceDuration = Math.max(1, this.config.allianceDuration());

    this.basePlayerTemplate = this.createBasePlayerElement();

    this.iconTemplate = document.createElement("img");

    this.iconCenterTemplate = document.createElement("img");
    this.iconCenterTemplate.style.position = "absolute";
    this.iconCenterTemplate.style.top = "50%";
    this.iconCenterTemplate.style.transform = "translateY(-50%)";

    this.emojiTemplate = document.createElement("div");
    this.emojiTemplate.style.position = "absolute";
    this.emojiTemplate.style.top = "50%";
    this.emojiTemplate.style.transform = "translateY(-50%)";

    this.eventBus.on(AlternateViewEvent, (e) => this.onAlternateViewChange(e));
  }

  private onAlternateViewChange(event: AlternateViewEvent) {
    this.isVisible = !event.alternateView;
    // Update visibility of all name elements immediately
    for (const render of this.renders) {
      this.updateElementVisibility(render);
    }
  }

  private updateElementVisibility(render: RenderInfo, baseSize?: number) {
    if (!render.player.nameLocation() || !render.player.isAlive()) {
      return;
    }

    baseSize =
      baseSize ?? Math.max(1, Math.floor(render.player.nameLocation().size));
    const size = this.transformHandler.scale * baseSize;
    const isOnScreen = render.location
      ? this.transformHandler.isOnScreen(render.location)
      : false;
    const maxZoomScale = 17;

    const display =
      !this.isVisible ||
      size < 7 ||
      (this.transformHandler.scale > maxZoomScale && size > 100) ||
      !isOnScreen
        ? "none"
        : "flex";
    if (render.element.style.display !== display) {
      render.element.style.display = display;
    }
  }

  getTickIntervalMs() {
    return 1000;
  }

  public tick() {
    // Precompute the first-place player for performance
    this.firstPlace = getFirstPlacePlayer(this.game);

    for (const player of this.game.playerViews()) {
      if (player.isAlive()) {
        if (!this.seenPlayers.has(player)) {
          this.seenPlayers.add(player);
          this.renders.push(this.createPlayerElement(player));
        }
      }
    }
  }

  public renderLayer() {
    const screenPosOld = this.transformHandler.worldToScreenCoordinates(
      new Cell(0, 0),
    );
    const screenPos = new Cell(
      screenPosOld.x - window.innerWidth / 2,
      screenPosOld.y - window.innerHeight / 2,
    );
    const newTransform = `translate(${screenPos.x}px, ${screenPos.y}px) scale(${this.transformHandler.scale})`;
    if (this.lastContainerTransform !== newTransform) {
      this.container.style.transform = newTransform;
      this.lastContainerTransform = newTransform;
    }

    const now = Date.now();
    if (now > this.lastChecked + this.renderCheckRate) {
      this.lastChecked = now;

      this.myPlayer ??= this.game.myPlayer();
      const transitiveTargets = this.myPlayer?.transitiveTargets() ?? [];

      for (const render of this.renders) {
        this.renderPlayerInfo(render, transitiveTargets);
      }
    }
  }

  private createBasePlayerElement(): HTMLDivElement {
    const element = document.createElement("div");
    element.style.position = "absolute";
    element.style.flexDirection = "column";
    element.style.alignItems = "center";
    element.style.gap = "0px";
    // Start off invisible so it doesn't flash at 0,0
    element.style.display = "none";

    const iconsDiv = document.createElement("div");
    iconsDiv.classList.add(PLAYER_ICONS);
    iconsDiv.style.display = "flex";
    iconsDiv.style.gap = "4px";
    iconsDiv.style.justifyContent = "center";
    iconsDiv.style.alignItems = "center";
    iconsDiv.style.zIndex = "2";
    iconsDiv.style.opacity = "0.8";
    element.appendChild(iconsDiv);

    const nameDiv = document.createElement("div");
    nameDiv.classList.add(PLAYER_NAME);
    nameDiv.style.whiteSpace = "nowrap";
    nameDiv.style.textOverflow = "ellipsis";
    nameDiv.style.zIndex = "3";
    nameDiv.style.display = "flex";
    nameDiv.style.justifyContent = "flex-end";
    nameDiv.style.alignItems = "center";

    const flagImg = document.createElement("img");
    flagImg.classList.add(PLAYER_FLAG);
    flagImg.style.opacity = "0.8";
    flagImg.style.zIndex = "1";
    flagImg.style.objectFit = "contain";
    flagImg.style.display = "none";
    nameDiv.appendChild(flagImg);

    const nameSpan = document.createElement("span");
    nameSpan.classList.add(PLAYER_NAME_SPAN);
    nameDiv.appendChild(nameSpan);
    element.appendChild(nameDiv);

    const troopsDiv = document.createElement("div");
    troopsDiv.classList.add(PLAYER_TROOPS);
    troopsDiv.setAttribute("translate", "no");
    troopsDiv.style.zIndex = "3";
    troopsDiv.style.marginTop = "-5%";
    element.appendChild(troopsDiv);

    return element;
  }

  private createPlayerElement(player: PlayerView): RenderInfo {
    const element = this.basePlayerTemplate.cloneNode(true) as HTMLDivElement;

    // Queryselector expensive but this runs only once per player and better maintainable
    const nameDiv = element.querySelector(`.${PLAYER_NAME}`) as HTMLDivElement;
    const nameSpan = element.querySelector(
      `.${PLAYER_NAME_SPAN}`,
    ) as HTMLSpanElement;
    const troopsDiv = element.querySelector(
      `.${PLAYER_TROOPS}`,
    ) as HTMLDivElement;
    const flagImg = element.querySelector(
      `.${PLAYER_FLAG}`,
    ) as HTMLImageElement;
    const iconsDiv = element.querySelector(
      `.${PLAYER_ICONS}`,
    ) as HTMLDivElement;

    const font = this.theme.font();
    nameDiv.style.fontFamily = font;

    const flag = player.cosmetics.flag;
    if (flag) {
      flagImg.src = assetUrl(flag);
      flagImg.style.display = "block";
    }

    const renderInfo = new RenderInfo(
      player,
      0,
      null,
      0,
      "",
      element,
      nameDiv,
      nameSpan,
      troopsDiv,
      flagImg,
      iconsDiv,
    );

    this.container.appendChild(element);
    return renderInfo;
  }

  renderPlayerInfo(render: RenderInfo, transitiveTargets: PlayerView[]) {
    if (!render.player.nameLocation()) {
      return;
    }
    if (!render.player.isAlive()) {
      this.renders = this.renders.filter((r) => r !== render);
      render.element.remove();
      return;
    }

    // Update location and size, show or hide dependent on those
    const nameLocation = render.player.nameLocation();
    const newX = nameLocation.x;
    const newY = nameLocation.y;

    if (
      !render.location ||
      render.location.x !== newX ||
      render.location.y !== newY
    ) {
      render.location = new Cell(newX, newY);
    }

    const baseSize = Math.max(1, Math.floor(nameLocation.size));
    this.updateElementVisibility(render, baseSize);

    if (render.element.style.display === "none") {
      return;
    }

    // Throttle further updates
    const now = Date.now();
    if (now - render.lastRenderCalc <= this.renderRefreshRate) {
      return;
    }
    render.lastRenderCalc = now + this.rand.nextInt(0, 100);

    // Update text sizes, content and color
    render.fontSize = Math.max(4, Math.floor(baseSize * 0.4));
    render.nameDiv.style.fontSize = `${render.fontSize}px`;
    render.nameDiv.style.lineHeight = `${render.fontSize}px`;
    render.flagImg.style.height = `${render.fontSize}px`;
    render.troopsDiv.style.fontSize = `${render.fontSize}px`;

    render.nameSpan.textContent = render.player.displayName();
    render.troopsDiv.textContent = renderTroops(render.player.troops());

    const fontColor = this.theme.textColor(render.player);
    if (render.fontColor !== fontColor) {
      render.fontColor = fontColor;
      render.nameDiv.style.color = fontColor;
      render.troopsDiv.style.color = fontColor;
    }

    // Handle icons
    const iconSize = Math.min(render.fontSize * 1.5, 48);
    const darkMode = this.userSettings.darkMode();
    const darkModeStr = darkMode.toString();

    // Compute which icons should be shown for this player using shared logic
    const icons = getPlayerIcons({
      game: this.game,
      player: render.player,
      includeAllianceIcon: true,
      firstPlace: this.firstPlace,
      darkMode: darkMode,
      alliancesDisabled: this.alliancesDisabled,
      transitiveTargets: transitiveTargets,
    });

    // Build a set of desired icon IDs
    const desiredIconIds = new Set(icons.map((icon) => icon.id));

    // Remove any icons that are no longer needed
    for (const [id, element] of render.icons) {
      if (!desiredIconIds.has(id)) {
        if (id === ALLIANCE_ICON_ID) {
          render.allianceIconRefs?.wrapper.remove();
          render.allianceIconRefs = null;
          render.icons.delete(ALLIANCE_ICON_ID);
        } else {
          element.remove();
          render.icons.delete(id);
        }
      }
    }

    // Add or update icons that should be shown
    for (const icon of icons) {
      if (icon.kind === EMOJI_ICON_KIND && icon.text) {
        this.handleEmojiIcon(render, icon, iconSize);
        continue;
      } else if (!(icon.kind === IMAGE_ICON_KIND && icon.src)) {
        continue;
      }
      // Special handling for alliance icon with progress indicator
      if (icon.id === ALLIANCE_ICON_ID) {
        this.handleAllianceIcons(render, iconSize, darkModeStr);
        continue; // Skip regular image handling
      }

      const imgElement = this.handleOtherIcons(
        render,
        icon,
        iconSize,
        darkModeStr,
      );

      // Traitor flashing - smooth speed increase starting at 15s
      if (icon.id === TRAITOR_ICON_ID) {
        this.handleTraitorIconFlashing(render.player, imgElement);
      }
    }

    // Position element with scale
    // Don't require nameLocation to be changed: Scale update otherwise sometimes only happens after seconds which looks buggy.
    // Because of sometimes overlapping delays of 20 ticks for nameLocation() (largestClusterBoundingBox in PlayerExecution)
    // and the 500ms renderRefreshRate in here.
    const scale = Math.min(baseSize * 0.25, 3);
    const transform = `translate(${newX}px, ${newY}px) translate(-50%, -50%) scale(${scale})`;
    if (render.lastTransform !== transform) {
      render.element.style.transform = transform;
      render.lastTransform = transform;
    }
  }

  private handleEmojiIcon(
    render: RenderInfo,
    icon: PlayerIconDescriptor,
    size: number,
  ) {
    let emojiDiv = render.icons.get(icon.id) as HTMLDivElement | undefined;

    if (!emojiDiv) {
      emojiDiv = this.emojiTemplate.cloneNode(true) as HTMLDivElement;
      render.iconsDiv.appendChild(emojiDiv);
      render.icons.set(icon.id, emojiDiv);
    }

    emojiDiv.textContent = icon.text ?? "";
    emojiDiv.style.fontSize = `${size}px`;
  }

  private handleAllianceIcons(
    render: RenderInfo,
    size: number,
    darkMode: string,
  ) {
    this.myPlayer ??= this.game.myPlayer();
    const allianceView = this.myPlayer
      ?.alliances()
      .find((a) => a.other === render.player.id());

    let fraction = 0;
    let hasExtensionRequest = false;
    if (allianceView) {
      const remaining = Math.max(0, allianceView.expiresAt - this.game.ticks());
      fraction = Math.max(0, Math.min(1, remaining / this.allianceDuration));
      hasExtensionRequest = allianceView.hasExtensionRequest;
    }

    if (!render.allianceIconRefs) {
      render.allianceIconRefs = createAllianceProgressIconRefs(
        size,
        fraction,
        hasExtensionRequest,
        darkMode,
      );

      render.iconsDiv.appendChild(render.allianceIconRefs.wrapper);
      render.icons.set(ALLIANCE_ICON_ID, render.allianceIconRefs.wrapper);
    } else {
      updateAllianceProgressIconRefs(
        render.allianceIconRefs,
        size,
        fraction,
        hasExtensionRequest,
        darkMode,
      );
    }
    return;
  }

  private handleOtherIcons(
    render: RenderInfo,
    icon: PlayerIconDescriptor,
    size: number,
    darkMode: string,
  ): HTMLImageElement {
    let imgElement = render.icons.get(icon.id) as HTMLImageElement | undefined;

    if (!imgElement) {
      imgElement = icon.center
        ? (this.iconCenterTemplate.cloneNode(true) as HTMLImageElement)
        : (this.iconTemplate.cloneNode(true) as HTMLImageElement);

      imgElement.src = icon.src ?? "";
      imgElement.style.width = `${size}px`;
      imgElement.style.height = `${size}px`;
      imgElement.setAttribute("dark-mode", darkMode);
      render.iconsDiv.appendChild(imgElement);
      render.icons.set(icon.id, imgElement);
    } else {
      // Update src if it changed (e.g., nuke red/white or dark-mode icons)
      if (imgElement.src !== icon.src) {
        imgElement.src = icon.src ?? "";
      }

      imgElement.style.width = `${size}px`;
      imgElement.style.height = `${size}px`;
      imgElement.setAttribute("dark-mode", darkMode);
    }
    return imgElement;
  }

  private handleTraitorIconFlashing(
    player: PlayerView,
    icon: HTMLImageElement,
  ) {
    const remainingTicks = player.getTraitorRemainingTicks();
    // Use precise seconds (not rounded) for smoother transitions, rounded to 0.5s intervals
    const remainingSeconds = Math.round((remainingTicks / 10) * 2) / 2;

    if (remainingSeconds <= 15) {
      // Smooth transition: starts at 1s at 15 seconds, decreases to 0.2s at 0 seconds
      // Using cubic ease-out for slower, more gradual acceleration
      const clampedSeconds = Math.max(0, Math.min(15, remainingSeconds));
      const normalizedTime = clampedSeconds / 15; // 0 to 1 (1 = 15s remaining, 0 = 0s remaining)

      // Cubic ease-out: slower acceleration, smoother transition
      const easedProgress = 1 - Math.pow(1 - normalizedTime, 3);
      const maxDuration = 1.0; // Slow flash at 15 seconds
      const minDuration = 0.2; // Fast flash at 0 seconds
      const duration =
        minDuration + (maxDuration - minDuration) * easedProgress;
      const animationDuration = `${duration.toFixed(2)}s`;

      icon.style.animation = `traitorFlash ${animationDuration} infinite`;
      icon.style.animationTimingFunction = "ease-in-out";
    } else {
      // Don't flash if more than 15 seconds remaining
      icon.style.animation = "none";
    }
  }
}
