import {
  AllPlayers,
  Cell,
  Game,
  Player,
  PlayerType,
} from "../../../core/game/Game";
import { PseudoRandom } from "../../../core/PseudoRandom";
import { Theme } from "../../../core/configuration/Config";
import { Layer } from "./Layer";
import { TransformHandler } from "../TransformHandler";
import traitorIcon from "../../../../resources/images/TraitorIcon.svg";
import allianceIcon from "../../../../resources/images/AllianceIcon.svg";
import crownIcon from "../../../../resources/images/CrownIcon.svg";
import targetIcon from "../../../../resources/images/TargetIcon.svg";
import { ClientID } from "../../../core/Schemas";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { createCanvas, renderTroops } from "../../Utils";
import { sanitize } from "../../../core/Util";

class RenderInfo {
  public icons: Map<string, HTMLImageElement> = new Map(); // Track icon elements

  constructor(
    public player: PlayerView,
    public lastRenderCalc: number,
    public location: Cell,
    public fontSize: number,
    public element: HTMLElement,
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
    private clientID: ClientID,
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
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
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
            new RenderInfo(
              player,
              0,
              null,
              0,
              this.createPlayerElement(player),
            ),
          );
        }
      }
    }
  }

  public renderLayer(mainContex: CanvasRenderingContext2D) {
    const screenPosOld = this.transformHandler.worldToScreenCoordinates(
      new Cell(0, 0),
    );
    const screenPos = new Cell(
      screenPosOld.x - window.innerWidth / 2,
      screenPosOld.y - window.innerHeight / 2,
    );
    this.container.style.transform = `translate(${screenPos.x}px, ${screenPos.y}px) scale(${this.transformHandler.scale})`;

    const now = Date.now();
    if (now > this.lastChecked + this.renderCheckRate) {
      this.lastChecked = now;
      for (const render of this.renders) {
        this.renderPlayerInfo(render);
      }
    }

    mainContex.drawImage(
      this.canvas,
      0,
      0,
      mainContex.canvas.width,
      mainContex.canvas.height,
    );
  }

  private createPlayerElement(player: PlayerView): HTMLDivElement {
    const element = document.createElement("div");
    element.style.position = "absolute";
    element.style.display = "flex";
    element.style.flexDirection = "column";
    element.style.alignItems = "center";
    element.style.gap = "0px";

    const textColor = player.type() == PlayerType.Human ? "#000000" : "#4D4D4D";

    const nameDiv = document.createElement("div");
    nameDiv.classList.add("player-name");
    nameDiv.innerHTML = player.name();
    nameDiv.style.color = textColor;
    nameDiv.style.fontFamily = this.theme.font();
    nameDiv.style.whiteSpace = "nowrap";
    nameDiv.style.overflow = "hidden";
    nameDiv.style.textOverflow = "ellipsis";
    nameDiv.style.zIndex = "3";
    element.appendChild(nameDiv);

    if (player.flag()) {
      const flagImg = document.createElement("img");
      flagImg.classList.add("player-flag");
      flagImg.style.marginBottom = "-10%";
      flagImg.style.marginTop = "-17%";
      flagImg.style.opacity = "0.8";
      flagImg.src = "/flags/" + sanitize(player.flag()) + ".svg";
      flagImg.style.zIndex = "1";
      flagImg.style.width = "30%";
      flagImg.style.aspectRatio = "3/4";
      element.appendChild(flagImg);
    }

    const troopsDiv = document.createElement("div");
    troopsDiv.classList.add("player-troops");
    troopsDiv.textContent = renderTroops(player.troops());
    troopsDiv.style.color = textColor;
    troopsDiv.style.fontFamily = this.theme.font();
    troopsDiv.style.zIndex = "3";
    troopsDiv.style.marginTop = "-5%";
    element.appendChild(troopsDiv);

    const iconsDiv = document.createElement("div");
    iconsDiv.classList.add("player-icons");
    iconsDiv.style.display = "flex";
    iconsDiv.style.gap = "4px";
    iconsDiv.style.justifyContent = "center";
    iconsDiv.style.alignItems = "center";
    iconsDiv.style.position = "absolute";
    iconsDiv.style.zIndex = "2";
    iconsDiv.style.width = "100%";
    iconsDiv.style.height = "100%";
    element.appendChild(iconsDiv);

    // Start off invisible so it doesn't flash at 0,0
    element.style.display = "none";

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
      render.player.nameLocation().y,
    );

    // Calculate base size and scale
    const baseSize = Math.max(1, Math.floor(render.player.nameLocation().size));
    render.fontSize = Math.max(4, Math.floor(baseSize * 0.4));

    // Screen space calculations
    const size = this.transformHandler.scale * baseSize;
    if (size < 7 || !this.transformHandler.isOnScreen(render.location)) {
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

    // Update text sizes
    const nameDiv = render.element.querySelector(
      ".player-name",
    ) as HTMLDivElement;
    const troopsDiv = render.element.querySelector(
      ".player-troops",
    ) as HTMLDivElement;
    nameDiv.style.fontSize = `${render.fontSize}px`;
    troopsDiv.style.fontSize = `${render.fontSize}px`;
    troopsDiv.textContent = renderTroops(render.player.troops());

    // Handle icons
    const iconsDiv = render.element.querySelector(
      ".player-icons",
    ) as HTMLDivElement;
    const iconSize = Math.min(render.fontSize * 1.5, 48);
    const myPlayer = this.getPlayer();

    // Crown icon
    const existingCrown = iconsDiv.querySelector('[data-icon="crown"]');
    if (render.player === this.firstPlace) {
      if (!existingCrown) {
        iconsDiv.appendChild(
          this.createIconElement(this.crownIconImage.src, iconSize, "crown"),
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
          this.createIconElement(
            this.traitorIconImage.src,
            iconSize,
            "traitor",
          ),
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
            "alliance",
          ),
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
          this.createIconElement(this.targetIconImage.src, iconSize, "target"),
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
          emoji.recipientID == myPlayer?.smallID(),
      );

    if (this.game.config().userSettings().emojis() && emojis.length > 0) {
      if (!existingEmoji) {
        const emojiDiv = document.createElement("div");
        emojiDiv.setAttribute("data-icon", "emoji");
        emojiDiv.style.fontSize = `${iconSize}px`;
        // emojiDiv.textAlign = 'center'
        emojiDiv.textContent = emojis[0].message;
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

    // Position element with scale
    if (render.location && render.location != oldLocation) {
      const scale = Math.min(baseSize * 0.25, 3);
      render.element.style.transform = `translate(${render.location.x}px, ${render.location.y}px) translate(-50%, -50%) scale(${scale})`;
    }
  }

  private createIconElement(
    src: string,
    size: number,
    id: string,
  ): HTMLImageElement {
    const icon = document.createElement("img");
    icon.src = src;
    icon.style.width = `${size}px`;
    icon.style.height = `${size}px`;
    icon.setAttribute("data-icon", id);
    icon.style.position = "absolute";
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
