import { Colord, colord } from "colord";
import * as PIXI from "pixi.js";
import { EventBus } from "../../../core/EventBus";
import { Cell } from "../../../core/game/Game";
import { GameView } from "../../../core/game/GameView";
import { PingType } from "../../../core/game/Ping";
import { PingPlacedEvent } from "../../InputHandler";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

// URL imports for bundled assets
import retreatIconUrl from "../../../../resources/images/BackIconWhite.svg";
import watchOutIconUrl from "../../../../resources/images/QuestionMarkIcon.svg";
import defendIconUrl from "../../../../resources/images/ShieldIconWhite.svg";
import attackIconUrl from "../../../../resources/images/SwordIconWhite.svg";

// Configuration for pings
const PING_DURATION_MS = 3000; // 3 seconds
const PING_COLORS: Record<PingType, Colord> = {
  attack: colord("#ff0000"),
  retreat: colord("#ffa600"),
  defend: colord("#0000ff"),
  watchOut: colord("#ffff00"),
};
const PING_RING_MIN_RADIUS = 8;
const PING_RING_MAX_RADIUS = 32;

// The core class for a single ping marker, handles its own animation and rendering
class Ping {
  public readonly container: PIXI.Container;
  private readonly circle: PIXI.Graphics;
  private readonly sprite: PIXI.Sprite;
  private readonly createdAt: number;
  private readonly color: Colord;

  constructor(
    public readonly pingType: PingType,
    public readonly x: number,
    public readonly y: number,
    texture: PIXI.Texture,
  ) {
    this.createdAt = performance.now();
    this.color = PING_COLORS[pingType];
    this.container = new PIXI.Container();
    this.circle = new PIXI.Graphics();
    this.sprite = new PIXI.Sprite(texture);
    this.sprite.anchor.set(0.5);

    const aspectRatio = texture.width / texture.height;
    this.sprite.height = 24;
    this.sprite.width = 24 * aspectRatio;

    this.container.addChild(this.circle, this.sprite);
  }

  // Update animation state, returns true if still alive
  update(now: number): boolean {
    const elapsedTime = now - this.createdAt;
    if (elapsedTime >= PING_DURATION_MS) {
      return false;
    }

    const progress = elapsedTime / PING_DURATION_MS;

    this.sprite.alpha = 1 - progress; // Fade out

    // Breathing ring animation
    const ringRadius =
      PING_RING_MIN_RADIUS +
      (PING_RING_MAX_RADIUS - PING_RING_MIN_RADIUS) *
        (0.5 + 0.5 * Math.sin(elapsedTime / 200));

    this.drawBreathingRing(
      PING_RING_MIN_RADIUS,
      PING_RING_MAX_RADIUS,
      ringRadius,
      this.color.alpha(0.4), // Static outer ring
      this.color.alpha(0.8), // Pulsing inner ring
    );

    return true;
  }

  // Custom drawing logic for the breathing ring using PIXI.Graphics
  private drawBreathingRing(
    minRad: number,
    maxRad: number,
    currentRadius: number,
    staticColor: Colord,
    pulseColor: Colord,
  ) {
    this.circle.clear();

    const progress = (currentRadius - minRad) / (maxRad - minRad);
    const alpha = 1 - progress;

    // Outer static ring
    this.circle.stroke({ width: 2, color: staticColor.toRgb(), alpha: 0.4 });
    this.circle.circle(0, 0, maxRad);

    // Inner pulsing ring
    this.circle.stroke({
      width: 4,
      color: pulseColor.toRgb(),
      alpha: alpha * 0.8,
    });
    this.circle.circle(0, 0, currentRadius);
  }

  destroy() {
    this.container.destroy({ children: true });
  }
}

// The main layer for managing and rendering all ping markers
export class PingMarkerLayer implements Layer {
  private pings: Ping[] = [];
  private stage: PIXI.Container;
  private renderer: PIXI.Renderer | undefined;
  private textures: Record<PingType, PIXI.Texture> | undefined;

  constructor(
    private game: GameView,
    private eventBus: EventBus,
    private transformHandler: TransformHandler,
  ) {
    this.stage = new PIXI.Container();
  }

  async init() {
    try {
      // Setup renderer to match the game canvas environment
      this.renderer = await PIXI.autoDetectRenderer({
        width: window.innerWidth,
        height: window.innerHeight,
        backgroundAlpha: 0,
        antialias: true,
        resolution: window.devicePixelRatio || 1,
      });

      // Load all necessary textures
      this.textures = {
        attack: await PIXI.Assets.load(attackIconUrl),
        defend: await PIXI.Assets.load(defendIconUrl),
        watchOut: await PIXI.Assets.load(watchOutIconUrl),
        retreat: await PIXI.Assets.load(retreatIconUrl),
      };

      this.eventBus.on(PingPlacedEvent, this.handlePingPlaced);
      window.addEventListener("resize", this.resizeCanvas);
    } catch (error) {
      console.error("Failed to initialize PingMarkerLayer:", error);
      throw error; // Propagate failure
    }
  }

  destroy() {
    this.eventBus.off(PingPlacedEvent, this.handlePingPlaced);
    window.removeEventListener("resize", this.resizeCanvas);
    this.renderer?.destroy();
    this.stage.destroy(true);
  }

  private resizeCanvas = () => {
    if (this.renderer) {
      this.renderer.resize(window.innerWidth, window.innerHeight);
    }
  };

  private handlePingPlaced = (event: PingPlacedEvent) => {
    if (!this.textures || !this.game.isValidCoord(event.x, event.y)) {
      return;
    }

    const ping = new Ping(
      event.pingType,
      event.x,
      event.y,
      this.textures[event.pingType],
    );
    this.pings.push(ping);
    this.stage.addChild(ping.container);
  };

  tick() {
    const now = performance.now();

    // Filter out expired pings and remove them from the stage
    const stillActivePings: Ping[] = [];
    for (const ping of this.pings) {
      if (ping.update(now)) {
        stillActivePings.push(ping);
      } else {
        this.stage.removeChild(ping.container);
        ping.destroy();
      }
    }
    this.pings = stillActivePings;
  }

  renderLayer(context: CanvasRenderingContext2D): void {
    if (!this.renderer) return;

    // Update positions of all pings based on camera transform
    for (const ping of this.pings) {
      const screenPos = this.transformHandler.worldToScreenCoordinates(
        new Cell(ping.x, ping.y),
      );
      ping.container.position.set(screenPos.x, screenPos.y);
    }

    // Render the entire PIXI stage and draw it onto the main canvas
    this.renderer.render(this.stage);
    context.drawImage(this.renderer.canvas, 0, 0);
  }

  shouldTransform(): boolean {
    return false; // We handle our own transformations
  }
}
