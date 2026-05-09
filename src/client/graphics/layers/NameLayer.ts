import * as PIXI from "pixi.js";
import { assetUrl } from "../../../core/AssetUrls";
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
  computeAllianceTopCutPercent,
  EMOJI_ICON_KIND,
  getFirstPlacePlayer,
  getPlayerIcons,
  IMAGE_ICON_KIND,
  PlayerIconDescriptor,
  PlayerIconId,
  TRAITOR_ICON_ID,
} from "../PlayerIcons";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";
import { NameLayerAssets } from "./NameLayerAssets";
import {
  computeNameLayerLayout,
  computeNameLayerScreenMetrics,
  computeNameLayerVisible,
  computeTraitorFlashAlpha,
  replaceUnsupportedNameGlyphs,
} from "./NameLayerLayout";

const allianceIconFaded = assetUrl("images/AllianceIconFaded.svg");
const questionMarkIcon = assetUrl("images/QuestionMarkIcon.svg");

type PixiRenderer = PIXI.Renderer | PIXI.WebGLRenderer | PIXI.WebGPURenderer;

interface PixiIconRender {
  container: PIXI.Container;
  centered: boolean;
  src?: string;
  sprite?: PIXI.Sprite;
  alliance?: {
    base: PIXI.Sprite;
    colored: PIXI.Sprite;
    questionMark: PIXI.Sprite;
    mask: PIXI.Graphics;
  };
}

class RenderInfo {
  public icons: Map<PlayerIconId, PixiIconRender> = new Map();
  public location: Cell | null = null;
  public baseSize = 1;
  public fontSize = 0;
  public iconSize = 0;
  public fontColor = "";
  public flagSrc = "";
  public flagSprite: PIXI.Sprite | null = null;
  public lastDisplayName = "";
  public lastTroopsText = "";

  constructor(
    public player: PlayerView,
    public lastRenderCalc: number,
    public container: PIXI.Container,
    public nameText: PIXI.BitmapText,
    public troopsText: PIXI.BitmapText,
  ) {}
}

export class NameLayer implements Layer {
  private config: Config;
  private lastChecked = 0;
  private readonly renderCheckRate = 100;
  private readonly renderRefreshRate = 500;
  private readonly rand = new PseudoRandom(10);
  private readonly renders: RenderInfo[] = [];
  private readonly seenPlayers: Set<PlayerView> = new Set();
  private readonly rootStage: PIXI.Container = new PIXI.Container();
  private readonly labelStage: PIXI.Container = new PIXI.Container();
  private readonly assets = new NameLayerAssets();
  private theme: Theme;
  private userSettings: UserSettings = new UserSettings();
  private isVisible = true;
  private firstPlace: PlayerView | null = null;
  private allianceDuration: number;
  private alliancesDisabled = false;
  private myPlayer: PlayerView | null = null;
  private readonly pixiCanvas: HTMLCanvasElement =
    document.createElement("canvas");
  private readonly onWindowResize = () => this.resizeCanvas();
  private renderer: PixiRenderer | null = null;
  private rendererInitialized = false;
  private rebuildPending = false;

  constructor(
    private game: GameView,
    private transformHandler: TransformHandler,
    private eventBus: EventBus,
  ) {}

  shouldTransform(): boolean {
    return false;
  }

  async init() {
    this.myPlayer = this.game.myPlayer();
    this.config = this.game.config();
    this.theme = this.config.theme();
    this.alliancesDisabled = this.config.disableAlliances();
    this.allianceDuration = Math.max(1, this.config.allianceDuration());

    this.rootStage.addChild(this.labelStage);
    this.rootStage.position.set(0, 0);

    this.eventBus.on(AlternateViewEvent, (e) => this.onAlternateViewChange(e));
    window.addEventListener("resize", this.onWindowResize);

    await this.setupRenderer();
    this.resizeCanvas();
  }

  async redraw() {
    if (this.rebuildPending) {
      return;
    }
    this.rebuildPending = true;
    try {
      if (!this.renderer || this.renderer.name === "webgpu") {
        this.rendererInitialized = false;
        await this.setupRenderer();
      }
      this.resizeCanvas();
      for (const render of this.renders) {
        render.container.destroy({ children: true });
      }
      this.renders.length = 0;
      this.seenPlayers.clear();
    } catch (error) {
      console.error("NameLayer redraw failed; retrying next frame", error);
      this.renderer = null;
      this.rendererInitialized = false;
      requestAnimationFrame(() => {
        void this.redraw();
      });
    } finally {
      this.rebuildPending = false;
    }
  }

  getTickIntervalMs() {
    return 1000;
  }

  tick() {
    this.firstPlace = getFirstPlacePlayer(this.game);

    for (const player of this.game.playerViews()) {
      if (player.isAlive() && !this.seenPlayers.has(player)) {
        this.seenPlayers.add(player);
        const render = this.createPlayerRender(player);
        if (render) {
          this.renders.push(render);
        }
      }
    }
  }

  renderLayer(mainContext: CanvasRenderingContext2D) {
    if (this.rendererOrGLContextLost()) {
      return;
    }

    this.myPlayer ??= this.game.myPlayer();
    this.updateTransformsAndVisibility();

    const now = Date.now();
    if (now > this.lastChecked + this.renderCheckRate) {
      this.lastChecked = now;
      const transitiveTargets = this.myPlayer?.transitiveTargets() ?? [];
      for (const render of [...this.renders]) {
        this.renderPlayerInfo(render, transitiveTargets, now);
      }
    }

    this.renderer?.render(this.rootStage);
    if (this.renderer) {
      mainContext.drawImage(
        this.renderer.canvas,
        0,
        0,
        this.renderer.canvas.width,
        this.renderer.canvas.height,
        0,
        0,
        mainContext.canvas.width,
        mainContext.canvas.height,
      );
    }
  }

  private async setupRenderer() {
    if (this.renderer) {
      this.renderer.destroy(false);
      this.renderer = null;
      this.rendererInitialized = false;
      this.labelStage.removeChildren();
    }

    await this.assets.preload();

    const resolution = window.devicePixelRatio || 1;
    this.resizePixiCanvasElement(resolution);

    const renderer = await PIXI.autoDetectRenderer({
      canvas: this.pixiCanvas,
      resolution,
      width: window.innerWidth,
      height: window.innerHeight,
      antialias: false,
      clearBeforeRender: true,
      backgroundAlpha: 0,
      backgroundColor: 0x00000000,
    });

    console.info(`Using ${renderer.name} for name layer`);
    this.renderer = renderer;

    if (this.renderer.name === "webgpu") {
      const gpuRenderer = this.renderer as PIXI.WebGPURenderer;
      gpuRenderer.gpu.device.lost.then(() => {
        // device.lost is a one-time Promise; setupRenderer() intentionally
        // re-attaches this handler on rebuild so future losses are observed.
        void this.redraw();
      });
    }

    if (this.renderer.name === "webgl") {
      this.renderer.runners.contextChange.add({
        contextChange: () => {
          requestAnimationFrame(() => {
            void this.redraw();
          });
        },
      });
    }

    this.rendererInitialized = true;
  }

  private rendererOrGLContextLost(): boolean {
    if (!this.renderer || !this.rendererInitialized) return true;
    if (this.renderer.name === "webgl") {
      return (this.renderer as PIXI.WebGLRenderer).context?.isLost === true;
    }
    return false;
  }

  private resizeCanvas() {
    if (this.rendererOrGLContextLost()) {
      return;
    }
    const resolution = window.devicePixelRatio || 1;
    this.resizePixiCanvasElement(resolution);
    this.renderer?.resize(window.innerWidth, window.innerHeight, resolution);
  }

  private resizePixiCanvasElement(resolution: number) {
    this.pixiCanvas.width = Math.ceil(window.innerWidth * resolution);
    this.pixiCanvas.height = Math.ceil(window.innerHeight * resolution);
    this.pixiCanvas.style.width = `${window.innerWidth}px`;
    this.pixiCanvas.style.height = `${window.innerHeight}px`;
  }

  private onAlternateViewChange(event: AlternateViewEvent) {
    this.isVisible = !event.alternateView;
    this.updateTransformsAndVisibility();
  }

  private createPlayerRender(player: PlayerView): RenderInfo | null {
    if (!this.assets.fontReady) {
      return null;
    }

    const container = new PIXI.Container();
    container.visible = false;

    const nameText = this.createBitmapText("");
    const troopsText = this.createBitmapText("");

    container.addChild(nameText, troopsText);
    this.labelStage.addChild(container);

    const render = new RenderInfo(player, 0, container, nameText, troopsText);
    this.updateFlag(render);
    return render;
  }

  private createBitmapText(text: string): PIXI.BitmapText {
    if (!this.assets.fontReady || !this.assets.fontFamily) {
      throw new Error("NameLayer bitmap font is not ready");
    }

    const bitmapText = new PIXI.BitmapText({
      text,
      style: {
        fontFamily: this.assets.fontFamily,
        fontSize: 12,
        fill: "#ffffff",
      },
    });
    bitmapText.anchor.set(0.5);
    return bitmapText;
  }

  private updateTransformsAndVisibility() {
    const now = performance.now();
    for (const render of this.renders) {
      const nameLocation = render.player.nameLocation();
      if (!nameLocation || !render.player.isAlive()) {
        render.container.visible = false;
        continue;
      }

      render.baseSize = Math.max(1, Math.floor(nameLocation.size));
      const metrics = computeNameLayerScreenMetrics(
        render.baseSize,
        this.transformHandler.scale,
      );
      if (
        render.fontSize !== metrics.fontSize ||
        render.iconSize !== metrics.iconSize
      ) {
        render.fontSize = metrics.fontSize;
        render.iconSize = metrics.iconSize;
        this.updateText(render);
        this.resizeIcons(render, render.iconSize);
        this.layoutRender(render, render.iconSize);
      }
      render.location = new Cell(nameLocation.x, nameLocation.y);
      const isOnScreen = this.transformHandler.isOnScreen(render.location);
      render.container.visible = computeNameLayerVisible({
        isLayerVisible: this.isVisible,
        transformScale: this.transformHandler.scale,
        baseSize: render.baseSize,
        isOnScreen,
      });

      if (!render.container.visible) {
        continue;
      }

      const screenPos = this.transformHandler.worldToCanvasCoordinates(
        render.location,
      );
      render.container.position.set(screenPos.x, screenPos.y);
      render.container.scale.set(1);
      this.updateTraitorAlpha(render, now);
    }
  }

  private renderPlayerInfo(
    render: RenderInfo,
    transitiveTargets: PlayerView[],
    now: number,
  ) {
    if (!render.player.nameLocation()) {
      return;
    }
    if (!render.player.isAlive()) {
      this.deleteRender(render);
      return;
    }
    if (!render.container.visible) {
      return;
    }
    if (now - render.lastRenderCalc <= this.renderRefreshRate) {
      return;
    }
    render.lastRenderCalc = now + this.rand.nextInt(0, 100);

    this.updateText(render);
    this.updateFlag(render);

    const icons = getPlayerIcons({
      game: this.game,
      player: render.player,
      includeAllianceIcon: true,
      firstPlace: this.firstPlace,
      darkMode: this.userSettings.darkMode(),
      alliancesDisabled: this.alliancesDisabled,
      transitiveTargets,
    });

    this.updateIcons(render, icons, render.iconSize);
    this.layoutRender(render, render.iconSize);
  }

  private updateText(render: RenderInfo) {
    if (!this.assets.fontFamily) {
      return;
    }

    const displayName = replaceUnsupportedNameGlyphs(
      render.player.displayName(),
    );
    const troopsText = replaceUnsupportedNameGlyphs(
      renderTroops(render.player.troops()),
    );
    const fontColor = this.theme.textColor(render.player);
    const prevFontColor = render.fontColor;

    if (
      render.lastDisplayName !== displayName ||
      prevFontColor !== fontColor ||
      render.nameText.style.fontSize !== render.fontSize ||
      render.nameText.style.fontFamily !== this.assets.fontFamily
    ) {
      render.nameText.text = displayName;
      render.nameText.style = {
        fontFamily: this.assets.fontFamily,
        fontSize: render.fontSize,
        fill: fontColor,
      };
      render.lastDisplayName = displayName;
    }

    if (
      render.lastTroopsText !== troopsText ||
      prevFontColor !== fontColor ||
      render.troopsText.style.fontSize !== render.fontSize ||
      render.troopsText.style.fontFamily !== this.assets.fontFamily
    ) {
      render.troopsText.text = troopsText;
      render.troopsText.style = {
        fontFamily: this.assets.fontFamily,
        fontSize: render.fontSize,
        fill: fontColor,
      };
      render.lastTroopsText = troopsText;
    }

    render.fontColor = fontColor;
  }

  private updateFlag(render: RenderInfo) {
    const flag = render.player.cosmetics.flag;
    const src = flag ? assetUrl(flag) : "";
    if (!src) {
      this.hideFlag(render, true);
      return;
    }

    if (src !== render.flagSrc) {
      this.hideFlag(render, true);
    }

    const texture = this.assets.getTexture(src);
    if (!texture) {
      this.hideFlag(render, false);
      return;
    }

    if (!render.flagSprite) {
      render.flagSprite = new PIXI.Sprite(texture);
      render.flagSprite.anchor.set(0.5);
      render.flagSprite.alpha = 0.8;
      render.container.addChild(render.flagSprite);
    } else if (render.flagSprite.texture !== texture) {
      render.flagSprite.texture = texture;
    }

    render.flagSrc = src;
    render.flagSprite.visible = true;
  }

  private hideFlag(render: RenderInfo, clearSource: boolean) {
    render.flagSprite?.destroy();
    render.flagSprite = null;
    if (clearSource) {
      render.flagSrc = "";
    }
  }

  private updateIcons(
    render: RenderInfo,
    icons: PlayerIconDescriptor[],
    size: number,
  ) {
    const desiredIds = new Set(icons.map((icon) => icon.id));
    for (const [id, iconRender] of render.icons) {
      if (!desiredIds.has(id)) {
        iconRender.container.destroy({ children: true });
        render.icons.delete(id);
      }
    }

    for (const icon of icons) {
      if (icon.kind === EMOJI_ICON_KIND) {
        this.updateEmojiIcon(render, icon, size);
      } else if (icon.id === ALLIANCE_ICON_ID) {
        this.updateAllianceIcon(render, icon, size);
      } else if (icon.kind === IMAGE_ICON_KIND && icon.src) {
        this.updateImageIcon(render, icon, size);
      }
    }
  }

  private resizeIcons(render: RenderInfo, size: number) {
    for (const iconRender of render.icons.values()) {
      if (iconRender.sprite) {
        iconRender.sprite.width = size;
        iconRender.sprite.height = size;
      }
      if (iconRender.alliance) {
        const refs = iconRender.alliance;
        refs.base.width = size;
        refs.base.height = size;
        refs.colored.width = size;
        refs.colored.height = size;
        refs.questionMark.width = size;
        refs.questionMark.height = size;
        this.updateAllianceProgressMask(render, refs, size);
      }
    }
  }

  private updateImageIcon(
    render: RenderInfo,
    icon: PlayerIconDescriptor,
    size: number,
  ) {
    const src = icon.src;
    if (!src) {
      return;
    }

    let iconRender = render.icons.get(icon.id);
    if (!iconRender || iconRender.src !== src || !iconRender.sprite) {
      iconRender?.container.destroy({ children: true });
      const container = new PIXI.Container();
      container.alpha = 0.8;
      const sprite = new PIXI.Sprite();
      sprite.anchor.set(0.5);
      container.addChild(sprite);
      render.container.addChild(container);
      iconRender = {
        container,
        centered: icon.center ?? false,
        src,
        sprite,
      };
      render.icons.set(icon.id, iconRender);
    }

    iconRender.centered = icon.center ?? false;
    const texture = this.assets.getTexture(src);
    iconRender.container.visible = texture !== null;
    if (!texture) {
      return;
    }

    iconRender.sprite!.texture = texture;
    iconRender.sprite!.width = size;
    iconRender.sprite!.height = size;
  }

  private updateEmojiIcon(
    render: RenderInfo,
    icon: PlayerIconDescriptor,
    size: number,
  ) {
    const text = icon.text ?? "";
    const texture = text ? this.assets.getEmojiTexture(text) : null;
    if (!texture) {
      const existing = render.icons.get(icon.id);
      if (existing) {
        existing.container.visible = false;
      }
      return;
    }

    let iconRender = render.icons.get(icon.id);
    if (!iconRender || iconRender.src !== text || !iconRender.sprite) {
      iconRender?.container.destroy({ children: true });
      const container = new PIXI.Container();
      container.alpha = 0.8;
      const sprite = new PIXI.Sprite(texture);
      sprite.anchor.set(0.5);
      container.addChild(sprite);
      render.container.addChild(container);
      iconRender = {
        container,
        centered: icon.center ?? false,
        src: text,
        sprite,
      };
      render.icons.set(icon.id, iconRender);
    }

    iconRender.centered = icon.center ?? false;
    iconRender.sprite!.texture = texture;
    iconRender.sprite!.width = size;
    iconRender.sprite!.height = size;
    iconRender.container.visible = true;
  }

  private updateAllianceIcon(
    render: RenderInfo,
    icon: PlayerIconDescriptor,
    size: number,
  ) {
    let iconRender = render.icons.get(icon.id);
    if (!iconRender || !iconRender.alliance) {
      iconRender?.container.destroy({ children: true });
      const container = new PIXI.Container();
      container.alpha = 0.8;
      const base = new PIXI.Sprite();
      const colored = new PIXI.Sprite();
      const questionMark = new PIXI.Sprite();
      const mask = new PIXI.Graphics();
      for (const sprite of [base, colored, questionMark]) {
        sprite.anchor.set(0.5);
        container.addChild(sprite);
      }
      colored.mask = mask;
      container.addChild(mask);
      render.container.addChild(container);
      iconRender = {
        container,
        centered: false,
        src: icon.src,
        alliance: { base, colored, questionMark, mask },
      };
      render.icons.set(icon.id, iconRender);
    }

    const baseTexture = this.assets.getTexture(allianceIconFaded);
    const coloredTexture = icon.src ? this.assets.getTexture(icon.src) : null;
    const questionTexture = this.assets.getTexture(questionMarkIcon);
    iconRender.container.visible =
      baseTexture !== null && coloredTexture !== null;
    if (!baseTexture || !coloredTexture) {
      return;
    }

    const refs = iconRender.alliance!;
    refs.base.texture = baseTexture;
    refs.colored.texture = coloredTexture;
    iconRender.src = icon.src;
    refs.base.width = size;
    refs.base.height = size;
    refs.colored.width = size;
    refs.colored.height = size;

    this.updateAllianceProgressMask(render, refs, size);

    refs.questionMark.visible =
      this.hasAllianceExtensionRequest(render) && questionTexture !== null;
    if (questionTexture) {
      refs.questionMark.texture = questionTexture;
      refs.questionMark.width = size;
      refs.questionMark.height = size;
    }
  }

  private updateAllianceProgressMask(
    render: RenderInfo,
    refs: PixiIconRender["alliance"],
    size: number,
  ) {
    if (!refs) {
      return;
    }

    this.myPlayer ??= this.game.myPlayer();
    const allianceView = this.myPlayer
      ?.alliances()
      .find((a) => a.other === render.player.id());
    const remaining = allianceView
      ? Math.max(0, allianceView.expiresAt - this.game.ticks())
      : 0;
    const fraction = Math.max(
      0,
      Math.min(1, remaining / this.allianceDuration),
    );
    const topCut = (computeAllianceTopCutPercent(fraction) / 100) * size;
    refs.mask.clear();
    // computeAllianceTopCutPercent can intentionally make the visible alliance
    // height zero when remaining / this.allianceDuration is depleted; PIXI v8
    // tolerates the zero-area refs.mask.rect and the Math.max guard preserves it.
    refs.mask
      .rect(-size / 2, -size / 2 + topCut, size, Math.max(0, size - topCut))
      .fill(0xffffff);
  }

  private hasAllianceExtensionRequest(render: RenderInfo): boolean {
    this.myPlayer ??= this.game.myPlayer();
    return (
      this.myPlayer?.alliances().find((a) => a.other === render.player.id())
        ?.hasExtensionRequest === true
    );
  }

  private layoutRender(render: RenderInfo, iconSize: number) {
    const regularIcons = Array.from(render.icons.values()).filter(
      (icon) => !icon.centered && icon.container.visible,
    );
    const centeredIcons = Array.from(render.icons.values()).filter(
      (icon) => icon.centered && icon.container.visible,
    );
    const flagTexture = render.flagSprite?.visible
      ? render.flagSprite.texture
      : null;
    const flagAspectRatio =
      flagTexture && flagTexture.height > 0
        ? flagTexture.width / flagTexture.height
        : 1;

    const layout = computeNameLayerLayout({
      fontSize: render.fontSize,
      iconSize,
      iconCount: regularIcons.length,
      centeredIconCount: centeredIcons.length,
      hasFlag: render.flagSprite?.visible === true,
      flagAspectRatio,
      nameWidth: render.nameText.width,
      troopWidth: render.troopsText.width,
    });

    regularIcons.forEach((icon, index) => {
      const pos = layout.iconPositions[index];
      icon.container.position.set(pos.x, pos.y);
    });
    centeredIcons.forEach((icon, index) => {
      const pos = layout.centeredIconPositions[index];
      icon.container.position.set(pos.x, pos.y);
    });

    if (render.flagSprite && layout.flag) {
      render.flagSprite.position.set(layout.flag.x, layout.flag.y);
      render.flagSprite.width = layout.flag.width;
      render.flagSprite.height = layout.flag.height;
      render.flagSprite.visible = true;
    } else if (render.flagSprite) {
      render.flagSprite.visible = false;
    }

    render.nameText.position.set(layout.nameText.x, layout.nameText.y);
    render.troopsText.position.set(layout.troopText.x, layout.troopText.y);
  }

  private updateTraitorAlpha(render: RenderInfo, nowMs: number) {
    const traitorIcon = render.icons.get(TRAITOR_ICON_ID);
    if (!traitorIcon) {
      return;
    }
    traitorIcon.container.alpha =
      computeTraitorFlashAlpha(
        render.player.getTraitorRemainingTicks(),
        nowMs,
      ) * 0.8;
  }

  private deleteRender(render: RenderInfo) {
    const index = this.renders.indexOf(render);
    if (index >= 0) {
      this.renders.splice(index, 1);
    }
    this.seenPlayers.delete(render.player);
    render.container.destroy({ children: true });
  }

  destroy() {
    window.removeEventListener("resize", this.onWindowResize);
    for (const render of this.renders) {
      render.container.destroy({ children: true });
    }
    this.renders.length = 0;
    this.seenPlayers.clear();
    this.rootStage.removeChildren();
    this.renderer?.destroy(true);
    this.renderer = null;
    this.rendererInitialized = false;
  }
}
