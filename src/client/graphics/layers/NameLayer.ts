import { AllPlayers, Cell, PlayerType } from "../../../core/game/Game";
import { PseudoRandom } from "../../../core/PseudoRandom";
import { Theme } from "../../../core/configuration/Config";
import { Layer } from "./Layer";
import { TransformHandler } from "../TransformHandler";
import traitorIcon from "../../../../resources/images/TraitorIcon.png";
import allianceIcon from "../../../../resources/images/AllianceIcon.png";
import crownIcon from "../../../../resources/images/CrownIcon.png";
import targetIcon from "../../../../resources/images/TargetIcon.png";
import { ClientID } from "../../../core/Schemas";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { createCanvas, renderTroops } from "../../Utils";

class RenderInfo {
  public icons: Map<string, HTMLImageElement> = new Map(); // Track icon elements

  constructor(
    public player: PlayerView,
    public lastRenderCalc: number,
    public location: Cell,
    public fontSize: number,
    public element: HTMLElement
  ) {}
}

export class NameLayer implements Layer {
  private canvas: HTMLCanvasElement;
  private lastChecked = 0;
  private renderCheckRate = 100;
  private renderRefreshRate = 500;
  private rand = new PseudoRandom(10);
  private renders: RenderInfo[] = [];
  private seenPlayers: Set<PlayerView> = new Set();
  private traitorIconImage: HTMLImageElement;
  private allianceIconImage: HTMLImageElement;
  private targetIconImage: HTMLImageElement;
  private crownIconImage: HTMLImageElement;
  private container: HTMLDivElement;
  private myPlayer: PlayerView | null = null;
  private firstPlace: PlayerView | null = null;

  constructor(
    private game: GameView,
    private theme: Theme,
    private transformHandler: TransformHandler,
    private clientID: ClientID
  ) {
    this.traitorIconImage = new Image();
    this.traitorIconImage.src = traitorIcon;
    this.allianceIconImage = new Image();
    this.allianceIconImage.src = allianceIcon;
    this.crownIconImage = new Image();
    this.crownIconImage.src = crownIcon;
    this.targetIconImage = new Image();
    this.targetIconImage.src = targetIcon;
  }

  resizeCanvas() {
    // Initialize 2D context with proper DPR scaling
    const ctx = this.canvas.getContext("2d", { alpha: true });
    const dpr = window.devicePixelRatio || 1;
    ctx.scale(dpr, dpr);

    // Set proper canvas size accounting for DPR
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.canvas.width = width * dpr;
    this.canvas.height = height * dpr;

    // Set display size
    this.canvas.style.width = width + "px";
    this.canvas.style.height = height + "px";
  }

  shouldTransform(): boolean {
    return false;
  }

  public init() {
    this.canvas = createCanvas();
    window.addEventListener("resize", () => this.resizeCanvas());
    this.resizeCanvas();

    this.container = document.createElement("div");
    this.container.style.position = "fixed";
    this.container.style.left = "50%";
    this.container.style.top = "50%";
    this.container.style.pointerEvents = "none";
    this.container.style.zIndex = "2";
    // Add transform-style for container
    this.container.style.transformStyle = "preserve-3d";
    this.container.style.backfaceVisibility = "hidden";
    document.body.appendChild(this.container);
  }

  public tick() {
    if (this.game.ticks() % 10 != 0) {
      return;
    }
    const sorted = this.game
      .playerViews()
      .sort((a, b) => b.numTilesOwned() - a.numTilesOwned());
    if (sorted.length > 0) {
      this.firstPlace = sorted[0];
    }

    for (const player of this.game.playerViews()) {
      if (player.isAlive()) {
        if (!this.seenPlayers.has(player)) {
          this.seenPlayers.add(player);
          this.renders.push(
            new RenderInfo(player, 0, null, 0, this.createPlayerElement(player))
          );
        }
      }
    }
  }

  public renderLayer(mainContext: CanvasRenderingContext2D) {
    const dpr = window.devicePixelRatio || 1;
    const screenPosOld = this.transformHandler.worldToScreenCoordinates(
      new Cell(0, 0)
    );
    const screenPos = new Cell(
      screenPosOld.x - window.innerWidth / 2,
      screenPosOld.y - window.innerHeight / 2
    );

    this.container.style.transform = `translate3d(${screenPos.x}px, ${screenPos.y}px, 0) scale(${this.transformHandler.scale})`;

    const now = Date.now();
    if (now > this.lastChecked + this.renderCheckRate) {
      this.lastChecked = now;
      for (const render of this.renders) {
        this.renderPlayerInfo(render);
      }
    }

    mainContext.save();
    mainContext.scale(dpr, dpr);
    mainContext.drawImage(
      this.canvas,
      0,
      0,
      mainContext.canvas.width / dpr,
      mainContext.canvas.height / dpr
    );
    mainContext.restore();
  }

  private createPlayerElement(player: PlayerView): HTMLDivElement {
    const element = document.createElement("div");
    element.style.position = "absolute";
    element.style.display = "flex";
    element.style.flexDirection = "column";
    element.style.alignItems = "center";
    element.style.gap = "0px";

    // Add transform-style to ensure crisp text rendering
    element.style.transformStyle = "preserve-3d";
    element.style.backfaceVisibility = "hidden";
    // Add will-change to optimize performance
    element.style.willChange = "transform";

    const nameDiv = document.createElement("div");
    nameDiv.innerHTML = player.name();
    nameDiv.style.color = this.theme.playerInfoColor(player.id()).toHex();
    nameDiv.style.fontFamily = this.theme.font();
    nameDiv.style.whiteSpace = "nowrap";
    nameDiv.style.overflow = "hidden";
    nameDiv.style.textOverflow = "ellipsis";
    nameDiv.style.zIndex = "2";
    // Add text rendering optimizations
    nameDiv.style.textRendering = "optimizeLegibility";
    // Force subpixel antialiasing where available
    (nameDiv.style as any)["-webkit-font-smoothing"] = "antialiased";
    (nameDiv.style as any)["-moz-osx-font-smoothing"] = "grayscale";
    element.appendChild(nameDiv);

    const troopsDiv = document.createElement("div");
    troopsDiv.textContent = renderTroops(player.troops());
    troopsDiv.style.color = this.theme.playerInfoColor(player.id()).toHex();
    troopsDiv.style.fontFamily = this.theme.font();
    troopsDiv.style.fontWeight = "bold";
    troopsDiv.style.zIndex = "2";
    // Apply same text optimizations to troops
    troopsDiv.style.textRendering = "optimizeLegibility";
    (troopsDiv.style as any)["-webkit-font-smoothing"] = "antialiased";
    (troopsDiv.style as any)["-moz-osx-font-smoothing"] = "grayscale";
    element.appendChild(troopsDiv);

    const iconsDiv = document.createElement("div");
    iconsDiv.style.display = "flex";
    iconsDiv.style.gap = "4px";
    iconsDiv.style.justifyContent = "center";
    iconsDiv.style.alignItems = "center";
    iconsDiv.style.position = "absolute";
    iconsDiv.style.zIndex = "1";
    iconsDiv.style.width = "100%";
    iconsDiv.style.height = "100%";
    element.appendChild(iconsDiv);

    this.container.appendChild(element);
    return element;
  }

  renderPlayerInfo(render: RenderInfo) {
    if (!render.player.nameLocation() || !render.player.isAlive()) {
      this.renders = this.renders.filter((r) => r != render);
      render.element.remove();
      return;
    }

    const oldLocation = render.location;
    render.location = new Cell(
      render.player.nameLocation().x,
      render.player.nameLocation().y
    );

    // Calculate base size with reduced scale
    const baseSize = Math.max(1, Math.floor(render.player.nameLocation().size));
    // Use smaller font multiplier but keep minimum size reasonable
    render.fontSize = Math.max(8, Math.floor(baseSize * 0.2));

    // Screen space calculations with larger minimum size
    const size = this.transformHandler.scale * baseSize;
    if (size < 8 || !this.transformHandler.isOnScreen(render.location)) {
      render.element.style.display = "none";
      return;
    }
    render.element.style.display = "flex";

    // Throttle updates
    const now = Date.now();
    if (now - render.lastRenderCalc <= this.renderRefreshRate) {
      return;
    }
    render.lastRenderCalc = now + this.rand.nextInt(0, 100);

    // Update text sizes with DPR consideration
    const nameDiv = render.element.children[0] as HTMLDivElement;
    const troopsDiv = render.element.children[1] as HTMLDivElement;

    // Apply font size directly without DPR scaling
    nameDiv.style.fontSize = `${render.fontSize}px`;
    troopsDiv.style.fontSize = `${render.fontSize}px`;
    troopsDiv.textContent = renderTroops(render.player.troops());

    // Handle icons
    const iconsDiv = render.element.children[2] as HTMLDivElement;
    const dpr = window.devicePixelRatio || 1;
    const iconSize = Math.min((render.fontSize * 1.5) / dpr, 48);
    const myPlayer = this.getPlayer();

    // Crown icon
    const existingCrown = iconsDiv.querySelector('[data-icon="crown"]');
    if (render.player === this.firstPlace) {
      if (!existingCrown) {
        iconsDiv.appendChild(
          this.createIconElement(this.crownIconImage.src, iconSize, "crown")
        );
      }
    } else if (existingCrown) {
      existingCrown.remove();
    }

    // Traitor icon
    const existingTraitor = iconsDiv.querySelector('[data-icon="traitor"]');
    if (render.player.isTraitor()) {
      if (!existingTraitor) {
        iconsDiv.appendChild(
          this.createIconElement(this.traitorIconImage.src, iconSize, "traitor")
        );
      }
    } else if (existingTraitor) {
      existingTraitor.remove();
    }

    // Alliance icon
    const existingAlliance = iconsDiv.querySelector('[data-icon="alliance"]');
    if (myPlayer != null && myPlayer.isAlliedWith(render.player)) {
      if (!existingAlliance) {
        iconsDiv.appendChild(
          this.createIconElement(
            this.allianceIconImage.src,
            iconSize,
            "alliance"
          )
        );
      }
    } else if (existingAlliance) {
      existingAlliance.remove();
    }

    // Target icon
    const existingTarget = iconsDiv.querySelector('[data-icon="target"]');
    if (
      myPlayer != null &&
      new Set(myPlayer.transitiveTargets()).has(render.player)
    ) {
      if (!existingTarget) {
        iconsDiv.appendChild(
          this.createIconElement(this.targetIconImage.src, iconSize, "target")
        );
      }
    } else if (existingTarget) {
      existingTarget.remove();
    }

    // Emoji handling
    const existingEmoji = iconsDiv.querySelector('[data-icon="emoji"]');
    const emojis = render.player
      .outgoingEmojis()
      .filter(
        (emoji) =>
          emoji.recipientID == AllPlayers ||
          emoji.recipientID == myPlayer?.smallID()
      );

    if (emojis.length > 0) {
      if (!existingEmoji) {
        const emojiDiv = document.createElement("div");
        emojiDiv.setAttribute("data-icon", "emoji");
        emojiDiv.style.fontSize = `${iconSize}px`;
        emojiDiv.textContent = emojis[0].message;
        emojiDiv.style.textRendering = "optimizeLegibility";
        (emojiDiv.style as any)["-webkit-font-smoothing"] = "antialiased";
        (emojiDiv.style as any)["-moz-osx-font-smoothing"] = "grayscale";
        iconsDiv.appendChild(emojiDiv);
      }
    } else if (existingEmoji) {
      existingEmoji.remove();
    }

    // Update all icon sizes
    const icons = iconsDiv.getElementsByTagName("img");
    for (const icon of icons) {
      icon.style.width = `${iconSize}px`;
      icon.style.height = `${iconSize}px`;
    }

    // Position element with reduced scale
    if (render.location && render.location != oldLocation) {
      const scale = Math.min(baseSize * 0.1, 3);
      // Use translate3d for hardware acceleration
      render.element.style.transform = `translate3d(${render.location.x}px, ${render.location.y}px, 0) translate(-50%, -50%) scale(${scale})`;
    }
  }

  private createIconElement(
    src: string,
    size: number,
    id: string
  ): HTMLImageElement {
    const icon = document.createElement("img");
    icon.src = src;
    icon.style.width = `${size}px`;
    icon.style.height = `${size}px`;
    icon.setAttribute("data-icon", id);
    icon.style.position = "absolute";
    // Add image rendering optimization
    icon.style.imageRendering = "crisp-edges";
    return icon;
  }

  private getPlayer(): PlayerView | null {
    if (this.myPlayer != null) {
      return this.myPlayer;
    }
    this.myPlayer = this.game
      .playerViews()
      .find((p) => p.clientID() == this.clientID);
    return this.myPlayer;
  }
}
