import allianceIcon from "../../../../resources/images/AllianceIcon.svg";
import allianceRequestBlackIcon from "../../../../resources/images/AllianceRequestBlackIcon.svg";
import allianceRequestWhiteIcon from "../../../../resources/images/AllianceRequestWhiteIcon.svg";
import crownIcon from "../../../../resources/images/CrownIcon.svg";
import disconnectedIcon from "../../../../resources/images/DisconnectedIcon.svg";
import embargoBlackIcon from "../../../../resources/images/EmbargoBlackIcon.svg";
import embargoWhiteIcon from "../../../../resources/images/EmbargoWhiteIcon.svg";
import nukeRedIcon from "../../../../resources/images/NukeIconRed.svg";
import nukeWhiteIcon from "../../../../resources/images/NukeIconWhite.svg";
import shieldIcon from "../../../../resources/images/ShieldIconBlack.svg";
import targetIcon from "../../../../resources/images/TargetIcon.svg";
import traitorIcon from "../../../../resources/images/TraitorIcon.svg";
import { PseudoRandom } from "../../../core/PseudoRandom";
import { Theme } from "../../../core/configuration/Config";
import { AllPlayers, Cell, nukeTypes, UnitType } from "../../../core/game/Game";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { UserSettings } from "../../../core/game/UserSettings";
import { createCanvas, renderNumber, renderTroops } from "../../Utils";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

class RenderInfo {
  public icons: Map<string, HTMLImageElement> = new Map(); // Track icon elements

  constructor(
    public player: PlayerView,
    public lastRenderCalc: number,
    public location: Cell | null,
    public fontSize: number,
    public fontColor: string,
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
  private disconnectedIconImage: HTMLImageElement;
  private allianceRequestBlackIconImage: HTMLImageElement;
  private allianceRequestWhiteIconImage: HTMLImageElement;
  private allianceIconImage: HTMLImageElement;
  private targetIconImage: HTMLImageElement;
  private crownIconImage: HTMLImageElement;
  private embargoBlackIconImage: HTMLImageElement;
  private embargoWhiteIconImage: HTMLImageElement;
  private nukeWhiteIconImage: HTMLImageElement;
  private nukeRedIconImage: HTMLImageElement;
  private shieldIconImage: HTMLImageElement;
  private container: HTMLDivElement;
  private firstPlace: PlayerView | null = null;
  private theme: Theme = this.game.config().theme();
  private userSettings: UserSettings = new UserSettings();

  constructor(
    private game: GameView,
    private transformHandler: TransformHandler,
  ) {
    this.traitorIconImage = new Image();
    this.traitorIconImage.src = traitorIcon;
    this.disconnectedIconImage = new Image();
    this.disconnectedIconImage.src = disconnectedIcon;
    this.allianceIconImage = new Image();
    this.allianceIconImage.src = allianceIcon;
    this.allianceRequestBlackIconImage = new Image();
    this.allianceRequestBlackIconImage.src = allianceRequestBlackIcon;
    this.allianceRequestWhiteIconImage = new Image();
    this.allianceRequestWhiteIconImage.src = allianceRequestWhiteIcon;
    this.crownIconImage = new Image();
    this.crownIconImage.src = crownIcon;
    this.targetIconImage = new Image();
    this.targetIconImage.src = targetIcon;
    this.embargoBlackIconImage = new Image();
    this.embargoBlackIconImage.src = embargoBlackIcon;
    this.embargoWhiteIconImage = new Image();
    this.embargoWhiteIconImage.src = embargoWhiteIcon;
    this.nukeWhiteIconImage = new Image();
    this.nukeWhiteIconImage.src = nukeWhiteIcon;
    this.nukeRedIconImage = new Image();
    this.nukeRedIconImage.src = nukeRedIcon;
    this.shieldIconImage = new Image();
    this.shieldIconImage.src = shieldIcon;
  }

  resizeCanvas() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  shouldTransform(): boolean {
    return false;
  }

  redraw() {
    this.theme = this.game.config().theme();
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
    if (this.game.ticks() % 10 !== 0) {
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
              "",
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

    const iconsDiv = document.createElement("div");
    iconsDiv.classList.add("player-icons");
    iconsDiv.style.display = "flex";
    iconsDiv.style.gap = "4px";
    iconsDiv.style.justifyContent = "center";
    iconsDiv.style.alignItems = "center";
    iconsDiv.style.zIndex = "2";
    iconsDiv.style.opacity = "0.8";
    element.appendChild(iconsDiv);

    const nameDiv = document.createElement("div");
    if (player.flag()) {
      const flagImg = document.createElement("img");
      flagImg.classList.add("player-flag");
      flagImg.style.opacity = "0.8";
      flagImg.src = "/flags/" + player.flag() + ".svg";
      flagImg.style.zIndex = "1";
      flagImg.style.aspectRatio = "3/4";
      nameDiv.appendChild(flagImg);
    }
    nameDiv.classList.add("player-name");
    nameDiv.style.color = this.theme.textColor(player);
    nameDiv.style.fontFamily = this.theme.font();
    nameDiv.style.whiteSpace = "nowrap";
    nameDiv.style.textOverflow = "ellipsis";
    nameDiv.style.zIndex = "3";
    nameDiv.style.display = "flex";
    nameDiv.style.justifyContent = "flex-end";
    nameDiv.style.alignItems = "center";

    const nameSpan = document.createElement("span");
    nameSpan.className = "player-name-span";
    nameSpan.innerHTML = player.name();
    nameDiv.appendChild(nameSpan);
    element.appendChild(nameDiv);

    const troopsDiv = document.createElement("div");
    troopsDiv.classList.add("player-troops");
    troopsDiv.setAttribute("translate", "no");
    troopsDiv.textContent = renderTroops(player.troops());
    troopsDiv.style.color = this.theme.textColor(player);
    troopsDiv.style.fontFamily = this.theme.font();
    troopsDiv.style.zIndex = "3";
    troopsDiv.style.marginTop = "-5%";
    element.appendChild(troopsDiv);

    // TODO: Remove the shield icon.
    /* eslint-disable no-constant-condition */
    if (false) {
      const shieldDiv = document.createElement("div");
      shieldDiv.classList.add("player-shield");
      shieldDiv.style.zIndex = "3";
      shieldDiv.style.marginTop = "-5%";
      shieldDiv.style.display = "flex";
      shieldDiv.style.alignItems = "center";
      shieldDiv.style.gap = "0px";
      const shieldImg = document.createElement("img");
      shieldImg.src = this.shieldIconImage.src;
      shieldImg.style.width = "16px";
      shieldImg.style.height = "16px";

      const shieldSpan = document.createElement("span");
      shieldSpan.textContent = "0";
      shieldSpan.style.color = "black";
      shieldSpan.style.fontSize = "10px";
      shieldSpan.style.marginTop = "-2px";

      shieldDiv.appendChild(shieldImg);
      shieldDiv.appendChild(shieldSpan);
      element.appendChild(shieldDiv);
    }
    /* eslint-enable no-constant-condition */

    // Start off invisible so it doesn't flash at 0,0
    element.style.display = "none";

    this.container.appendChild(element);
    return element;
  }

  renderPlayerInfo(render: RenderInfo) {
    if (!render.player.nameLocation() || !render.player.isAlive()) {
      this.renders = this.renders.filter((r) => r !== render);
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
    render.fontColor = this.theme.textColor(render.player);

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
    const flagDiv = render.element.querySelector(
      ".player-flag",
    ) as HTMLDivElement;
    const troopsDiv = render.element.querySelector(
      ".player-troops",
    ) as HTMLDivElement;
    nameDiv.style.fontSize = `${render.fontSize}px`;
    nameDiv.style.lineHeight = `${render.fontSize}px`;
    nameDiv.style.color = render.fontColor;
    const span = nameDiv.querySelector(".player-name-span");
    if (span) {
      span.innerHTML = render.player.name();
    }
    if (flagDiv) {
      flagDiv.style.height = `${render.fontSize}px`;
    }
    troopsDiv.style.fontSize = `${render.fontSize}px`;
    troopsDiv.style.color = render.fontColor;
    troopsDiv.textContent = renderTroops(render.player.troops());

    const density = renderNumber(
      render.player.troops() / render.player.numTilesOwned(),
    );
    const shieldDiv: HTMLDivElement | null =
      render.element.querySelector(".player-shield");
    const shieldImg = shieldDiv?.querySelector("img");
    const shieldNumber = shieldDiv?.querySelector("span");
    if (shieldImg) {
      shieldImg.style.width = `${render.fontSize * 0.8}px`;
      shieldImg.style.height = `${render.fontSize * 0.8}px`;
    }
    if (shieldNumber) {
      shieldNumber.style.fontSize = `${render.fontSize * 0.6}px`;
      shieldNumber.style.marginTop = `${-render.fontSize * 0.1}px`;
      shieldNumber.textContent = density;
    }

    // Handle icons
    const iconsDiv = render.element.querySelector(
      ".player-icons",
    ) as HTMLDivElement;
    const iconSize = Math.min(render.fontSize * 1.5, 48);
    const myPlayer = this.game.myPlayer();
    const isDarkMode = this.userSettings.darkMode();

    // Crown icon
    const existingCrown = iconsDiv.querySelector('[data-icon="crown"]');
    if (render.player === this.firstPlace) {
      if (!existingCrown) {
        iconsDiv.appendChild(
          this.createIconElement(
            this.crownIconImage.src,
            iconSize,
            "crown",
            false,
          ),
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

    // Disconnected icon
    const existingDisconnected = iconsDiv.querySelector(
      '[data-icon="disconnected"]',
    );
    if (render.player.isDisconnected()) {
      if (!existingDisconnected) {
        iconsDiv.appendChild(
          this.createIconElement(
            this.disconnectedIconImage.src,
            iconSize,
            "disconnected",
          ),
        );
      }
    } else if (existingDisconnected) {
      existingDisconnected.remove();
    }

    // Alliance icon
    const existingAlliance = iconsDiv.querySelector('[data-icon="alliance"]');
    if (myPlayer !== null && myPlayer.isAlliedWith(render.player)) {
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

    // Alliance request icon
    let existingRequestAlliance = iconsDiv.querySelector(
      '[data-icon="alliance-request"]',
    );
    const isThemeAllianceRequestIcon =
      existingRequestAlliance?.getAttribute("dark-mode") ===
      isDarkMode.toString();
    const AllianceRequestIconImageSrc = isDarkMode
      ? this.allianceRequestWhiteIconImage.src
      : this.allianceRequestBlackIconImage.src;

    if (myPlayer !== null && render.player.isRequestingAllianceWith(myPlayer)) {
      // Create new icon to match theme
      if (existingRequestAlliance && !isThemeAllianceRequestIcon) {
        existingRequestAlliance.remove();
        existingRequestAlliance = null;
      }

      if (!existingRequestAlliance) {
        iconsDiv.appendChild(
          this.createIconElement(
            AllianceRequestIconImageSrc,
            iconSize,
            "alliance-request",
          ),
        );
      }
    } else if (existingRequestAlliance) {
      existingRequestAlliance.remove();
    }

    // Target icon
    const existingTarget = iconsDiv.querySelector('[data-icon="target"]');
    if (
      myPlayer !== null &&
      new Set(myPlayer.transitiveTargets()).has(render.player)
    ) {
      if (!existingTarget) {
        iconsDiv.appendChild(
          this.createIconElement(
            this.targetIconImage.src,
            iconSize,
            "target",
            true,
          ),
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
          emoji.recipientID === AllPlayers ||
          emoji.recipientID === myPlayer?.smallID(),
      );

    if (this.game.config().userSettings()?.emojis() && emojis.length > 0) {
      if (!existingEmoji) {
        const emojiDiv = document.createElement("div");
        emojiDiv.setAttribute("data-icon", "emoji");
        emojiDiv.style.fontSize = `${iconSize}px`;
        emojiDiv.textContent = emojis[0].message;
        emojiDiv.style.position = "absolute";
        emojiDiv.style.top = "50%";
        emojiDiv.style.transform = "translateY(-50%)";
        iconsDiv.appendChild(emojiDiv);
      }
    } else if (existingEmoji) {
      existingEmoji.remove();
    }

    // Embargo icon
    let existingEmbargo = iconsDiv.querySelector('[data-icon="embargo"]');
    const hasEmbargo =
      myPlayer &&
      (render.player.hasEmbargoAgainst(myPlayer) ||
        myPlayer.hasEmbargoAgainst(render.player));
    const isThemeEmbargoIcon =
      existingEmbargo?.getAttribute("dark-mode") === isDarkMode.toString();
    const embargoIconImageSrc = isDarkMode
      ? this.embargoWhiteIconImage.src
      : this.embargoBlackIconImage.src;

    if (myPlayer && hasEmbargo) {
      // Create new icon to match theme
      if (existingEmbargo && !isThemeEmbargoIcon) {
        existingEmbargo.remove();
        existingEmbargo = null;
      }

      if (!existingEmbargo) {
        iconsDiv.appendChild(
          this.createIconElement(embargoIconImageSrc, iconSize, "embargo"),
        );
      }
    } else if (existingEmbargo) {
      existingEmbargo.remove();
    }

    const nukesSentByOtherPlayer = this.game.units().filter((unit) => {
      const isSendingNuke = render.player.id() === unit.owner().id();
      const notMyPlayer = !myPlayer || unit.owner().id() !== myPlayer.id();
      return (
        (nukeTypes as UnitType[]).includes(unit.type()) &&
        isSendingNuke &&
        notMyPlayer &&
        unit.isActive()
      );
    });
    const isMyPlayerTarget = nukesSentByOtherPlayer.find((unit) => {
      const detonationDst = unit.targetTile();
      if (detonationDst === undefined) return false;
      const targetId = this.game.owner(detonationDst).id();
      return myPlayer && targetId === myPlayer.id();
    });
    const existingNuke = iconsDiv.querySelector(
      '[data-icon="nuke"]',
    ) as HTMLImageElement;

    if (existingNuke) {
      if (nukesSentByOtherPlayer.length === 0) {
        existingNuke.remove();
      } else if (
        isMyPlayerTarget &&
        existingNuke.src !== this.nukeRedIconImage.src
      ) {
        existingNuke.src = this.nukeRedIconImage.src;
      } else if (
        !isMyPlayerTarget &&
        existingNuke.src !== this.nukeWhiteIconImage.src
      ) {
        existingNuke.src = this.nukeWhiteIconImage.src;
      }
    } else if (nukesSentByOtherPlayer.length > 0) {
      if (!existingNuke) {
        const icon = isMyPlayerTarget
          ? this.nukeRedIconImage.src
          : this.nukeWhiteIconImage.src;
        iconsDiv.appendChild(this.createIconElement(icon, iconSize, "nuke"));
      }
    }
    // Update all icon sizes
    const icons = iconsDiv.getElementsByTagName("img");
    for (const icon of icons) {
      icon.style.width = `${iconSize}px`;
      icon.style.height = `${iconSize}px`;
    }

    // Position element with scale
    if (render.location && render.location !== oldLocation) {
      const scale = Math.min(baseSize * 0.25, 3);
      render.element.style.transform = `translate(${render.location.x}px, ${render.location.y}px) translate(-50%, -50%) scale(${scale})`;
    }
  }

  private createIconElement(
    src: string,
    size: number,
    id: string,
    center: boolean = false,
  ): HTMLImageElement {
    const icon = document.createElement("img");
    icon.src = src;
    icon.style.width = `${size}px`;
    icon.style.height = `${size}px`;
    icon.setAttribute("data-icon", id);
    icon.setAttribute("dark-mode", this.userSettings.darkMode().toString());
    if (center) {
      icon.style.position = "absolute";
      icon.style.top = "50%";
      icon.style.transform = "translateY(-50%)";
    }
    return icon;
  }
}
