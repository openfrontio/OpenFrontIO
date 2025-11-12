import { NukeMagnitude } from "../../../core/configuration/Config";
import { Fx } from "./Fx";

export class NukeAreaFx implements Fx {
  private lifeTime = 0;
  private ended = false;
  private readonly endAnimationDuration = 300; // in ms
  private readonly startAnimationDuration = 200; // in ms

  private readonly innerDiameter: number;
  private readonly outerDiameter: number;

  private offset = 0;
  private readonly dashSize: number;
  private readonly rotationSpeed = 20; // px per seconds
  private readonly baseAlpha = 0.9;

  // Alert mode for inbound bombs - flashing increases as impact approaches
  private isInbound: boolean = false;
  private isOutbound: boolean = false;
  private remainingSeconds: number | null = null;
  private trajectoryIndex: number | undefined = undefined;
  private trajectoryLength: number | undefined = undefined;

  constructor(
    private x: number,
    private y: number,
    magnitude: NukeMagnitude,
    isInbound: boolean = false,
    isOutbound: boolean = false,
    remainingSeconds: number | null = null,
    trajectoryIndex?: number,
    trajectoryLength?: number,
  ) {
    this.innerDiameter = magnitude.inner;
    this.outerDiameter = magnitude.outer;
    const numDash = Math.max(1, Math.floor(this.outerDiameter / 3));
    this.dashSize = (Math.PI / numDash) * this.outerDiameter;
    this.isInbound = isInbound;
    this.isOutbound = isOutbound;
    this.remainingSeconds = remainingSeconds;
    this.trajectoryIndex = trajectoryIndex;
    this.trajectoryLength = trajectoryLength;
  }

  private calculateAlertIntensity(): number {
    if (
      this.trajectoryIndex !== undefined &&
      this.trajectoryLength !== undefined &&
      this.trajectoryLength > 0
    ) {
      // Calculate alert intensity: 0 = start of trajectory, 1 = end of trajectory
      // Scale based on progress through trajectory
      return Math.max(
        0,
        Math.min(1, this.trajectoryIndex / this.trajectoryLength),
      );
    }
    return 0;
  }

  setInbound(isInbound: boolean) {
    this.isInbound = isInbound;
  }

  isInboundBomb(): boolean {
    return this.isInbound;
  }

  updateTimer(
    remainingSeconds: number | null,
    isOutbound: boolean,
    trajectoryIndex?: number,
    trajectoryLength?: number,
  ) {
    this.remainingSeconds = remainingSeconds;
    this.isOutbound = isOutbound;
    this.trajectoryIndex = trajectoryIndex;
    this.trajectoryLength = trajectoryLength;
  }

  end() {
    this.ended = true;
    this.lifeTime = 0; // reset for fade-out timing
  }

  renderTick(frameTime: number, ctx: CanvasRenderingContext2D): boolean {
    this.lifeTime += frameTime;

    if (this.ended && this.lifeTime >= this.endAnimationDuration) return false;
    let t: number;
    if (this.ended) {
      t = Math.max(0, 1 - this.lifeTime / this.endAnimationDuration);
    } else {
      t = Math.min(1, this.lifeTime / this.startAnimationDuration);
    }
    let alpha = Math.max(0, Math.min(1, this.baseAlpha * t));

    // Add flashing effect for alerting inbound bombs
    // Flash speed increases as alertIntensity increases (0 = slow, 1 = fast)
    if (this.isInbound && !this.ended) {
      const alertIntensity = this.calculateAlertIntensity();
      if (alertIntensity > 0) {
        // Flash faster as intensity increases: 0.5s per flash at intensity 0, 0.2s per flash at intensity 1
        const maxFlashPeriod = 500; // ms at intensity 0
        const minFlashPeriod = 200; // ms at intensity 1
        const flashPeriod =
          maxFlashPeriod - (maxFlashPeriod - minFlashPeriod) * alertIntensity;
        const flashPhase = (this.lifeTime % flashPeriod) / flashPeriod;
        // Flash between 0.6 (60%) and 1.0 (100%) alpha in sinusoidal pattern
        const flashAlpha =
          0.6 + 0.4 * (0.5 + 0.5 * Math.sin(flashPhase * Math.PI * 2));
        alpha = flashAlpha;
      }
    }

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 1;
    ctx.strokeStyle = `rgba(255,0,0,${alpha})`;
    ctx.fillStyle = `rgba(255,0,0,${Math.max(0, alpha - 0.6)})`;

    // Inner circle
    ctx.beginPath();
    ctx.lineWidth = 1;
    const innerDiameter =
      (this.innerDiameter / 2) * (1 - t) + this.innerDiameter * t;
    ctx.arc(this.x, this.y, innerDiameter, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fill();

    // Outer circle
    this.offset += this.rotationSpeed * (frameTime / 1000);
    ctx.beginPath();
    ctx.strokeStyle = `rgba(255,0,0,${alpha})`;
    ctx.lineWidth = 1;
    ctx.lineDashOffset = this.offset;
    ctx.setLineDash([this.dashSize]);
    const outerDiameter =
      (this.outerDiameter + 20) * (1 - t) + this.outerDiameter * t;
    ctx.arc(this.x, this.y, outerDiameter, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();

    // Draw timer text if applicable (with full opacity, not affected by circle alpha)
    if (
      (this.isOutbound || this.isInbound) &&
      this.remainingSeconds !== null &&
      this.remainingSeconds >= 0 &&
      !this.ended
    ) {
      const text = `${this.remainingSeconds}s`;

      // Set text style
      ctx.font = "bold 10px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      // Measure text for background sizing
      const textMetrics = ctx.measureText(text);
      const padding = 3;
      const bgWidth = textMetrics.width + padding * 2;
      const bgHeight = 12 + padding * 2;
      const offsetY = 25; // Offset further up to avoid blocking

      const bgX = this.x - bgWidth / 2;
      const bgY = this.y - offsetY - bgHeight / 2;

      // Draw transparent background
      ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
      ctx.fillRect(bgX, bgY, bgWidth, bgHeight);

      // Set text color based on direction
      if (this.isInbound) {
        // Red for inbound
        ctx.fillStyle = "#ff6666";
        ctx.strokeStyle = "rgba(0, 0, 0, 0.5)";
      } else {
        // Yellow/orange for outbound
        ctx.fillStyle = "#ffcc66";
        ctx.strokeStyle = "rgba(0, 0, 0, 0.5)";
      }

      // Draw text with lighter stroke for less blocking
      ctx.lineWidth = 1;
      ctx.strokeText(text, this.x, this.y - offsetY);
      ctx.fillText(text, this.x, this.y - offsetY);
    }

    return true;
  }
}
