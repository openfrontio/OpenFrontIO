import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { Layer } from "./Layer";

@customElement("fps-display")
export class FPSDisplay extends LitElement implements Layer {
  @state()
  private currentFPS: number = 0;

  @state()
  private averageFPS: number = 0;

  @state()
  private frameTime: number = 0;

  @state()
  private isVisible: boolean = false;
  private frameCount: number = 0;
  private lastTime: number = 0;
  private frameTimes: number[] = [];
  private fpsHistory: number[] = [];
  private lastSecondTime: number = 0;
  private framesThisSecond: number = 0;

  // Only show in development mode
  private isDevelopment: boolean = false;

  static styles = css`
    .fps-display {
      position: fixed;
      top: 20px; /* Move closer to the top */
      left: 50%; /* Center horizontally */
      transform: translateX(-50%); /* Center the element */
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 8px 12px;
      border-radius: 4px;
      font-family: monospace;
      font-size: 12px;
      z-index: 9999;
      pointer-events: none;
      user-select: none;
    }
    .fps-line {
      margin: 2px 0;
    }

    .fps-good {
      color: #4ade80; /* green-400 */
    }

    .fps-warning {
      color: #fbbf24; /* amber-400 */
    }

    .fps-bad {
      color: #f87171; /* red-400 */
    }

    .close-button {
      position: absolute;
      top: 8px;
      right: 8px;
      width: 20px;
      height: 20px;
      background-color: rgba(0, 0, 0, 0.8);
      border-radius: 4px;
      color: white;
      font-size: 14px;
      font-weight: bold;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      line-height: 1;
      user-select: none;
      pointer-events: auto;
    }
  `;

  constructor() {
    super();
    this.isVisible = this.isDevelopment;
  }

  init() {
    // No initialization needed for this layer
  }

  setVisible(visible: boolean) {
    this.isVisible = visible;
  }

  private handleClose() {
    this.isVisible = false;
  }

  updateFPS(frameDuration: number) {
    if (!this.isVisible) return;

    const now = performance.now();

    // Initialize timing on first call
    if (this.lastTime === 0) {
      this.lastTime = now;
      this.lastSecondTime = now;
      return;
    }

    const deltaTime = now - this.lastTime;

    // Track frame times for current FPS calculation (last 60 frames)
    this.frameTimes.push(deltaTime);
    if (this.frameTimes.length > 60) {
      this.frameTimes.shift();
    }

    // Calculate current FPS based on average frame time
    if (this.frameTimes.length > 0) {
      const avgFrameTime =
        this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
      this.currentFPS = Math.round(1000 / avgFrameTime);
      this.frameTime = Math.round(avgFrameTime);
    }

    // Track FPS for 60-second average
    this.framesThisSecond++;

    // Update every second
    if (now - this.lastSecondTime >= 1000) {
      this.fpsHistory.push(this.framesThisSecond);
      if (this.fpsHistory.length > 60) {
        this.fpsHistory.shift();
      }

      // Calculate 60-second average
      if (this.fpsHistory.length > 0) {
        this.averageFPS = Math.round(
          this.fpsHistory.reduce((a, b) => a + b, 0) / this.fpsHistory.length,
        );
      }

      this.framesThisSecond = 0;
      this.lastSecondTime = now;
    }

    this.lastTime = now;
    this.frameCount++;

    this.requestUpdate();
  }

  shouldTransform(): boolean {
    return false;
  }

  private getFPSColor(fps: number): string {
    if (fps >= 55) return "fps-good";
    if (fps >= 30) return "fps-warning";
    return "fps-bad";
  }

  render() {
    if (!this.isVisible) {
      return html``;
    }
    return html`
      <div class="fps-display">
        <button class="close-button" @click="${this.handleClose}">×</button>
        <div class="fps-line">
          FPS:
          <span class="${this.getFPSColor(this.currentFPS)}"
            >${this.currentFPS}</span
          >
        </div>
        <div class="fps-line">
          Avg (60s):
          <span class="${this.getFPSColor(this.averageFPS)}"
            >${this.averageFPS}</span
          >
        </div>
        <div class="fps-line">
          Frame:
          <span class="${this.getFPSColor(1000 / this.frameTime)}"
            >${this.frameTime}ms</span
          >
        </div>
      </div>
    `;
  }
}
