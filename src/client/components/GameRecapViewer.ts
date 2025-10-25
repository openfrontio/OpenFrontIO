import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  RecapFrame,
  RecapFrameStore,
} from "../graphics/recapCapture/RecapFrameStore";

@customElement("game-recap-viewer")
export class GameRecapViewer extends LitElement {
  @property({ attribute: false })
  frameStore: RecapFrameStore | null = null;

  @property({ type: Boolean })
  autoplay: boolean = true;

  @state()
  private frames: readonly RecapFrame[] = [];

  @state()
  private currentIndex = 0;

  @state()
  private isPlaying = false;

  private unsubscribe: (() => void) | null = null;
  private playbackHandle: number | null = null;
  private lastFrameTime = 0;
  private canvas: HTMLCanvasElement | null = null;
  private readonly frameIntervalMs = 60;
  private loopPauseMs = 0;
  private loopHoldActive = false;
  private loopHoldConsumed = false;
  private loopHoldStart = 0;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.attachStore();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.detachStore();
    this.stopPlayback();
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has("frameStore")) {
      this.attachStore();
    }
    if (changed.has("frames")) {
      this.onFramesUpdated();
    }
  }

  render() {
    const hasFrames = this.frames.length > 0;
    const firstFrame = this.frames[0];
    const aspect = firstFrame
      ? `${firstFrame.width} / ${firstFrame.height}`
      : "16 / 9";
    const containerStyle = `width: 100%; aspect-ratio: ${aspect}; max-height: min(60vh, 420px);`;
    const showDownloadButton = hasFrames;
    return html`
      <div
        class="relative bg-black rounded overflow-hidden mb-4"
        style="${containerStyle}"
      >
        <canvas class="w-full h-full bg-black block" translate="no"></canvas>
        ${showDownloadButton
          ? html`<button
              class="absolute top-2 right-2 flex items-center justify-center w-9 h-9 bg-blue-500/80 hover:bg-blue-500 text-white rounded shadow"
              aria-label="Download recap"
              @click=${this.downloadAutoRecording}
            >
              <span class="text-lg leading-none" aria-hidden="true">⬇️</span>
            </button>`
          : null}
        ${!hasFrames
          ? html`<div
              class="absolute inset-0 flex items-center justify-center text-sm text-white/70"
            >
              ${"Recap capture warming up"}
            </div>`
          : null}
      </div>
    `;
  }

  private attachStore() {
    this.detachStore();
    if (!this.frameStore) {
      return;
    }
    this.unsubscribe = this.frameStore.subscribe((frames) => {
      this.loopPauseMs = this.frameStore?.getLoopPauseMs() ?? 0;
      this.frames = [...frames];
    });
  }

  private detachStore() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.loopPauseMs = 0;
  }

  private onFramesUpdated() {
    if (this.frames.length === 0) {
      this.currentIndex = 0;
      this.stopPlayback();
      this.paintFrame();
      return;
    }

    if (this.currentIndex >= this.frames.length) {
      this.currentIndex = Math.max(0, this.frames.length - 1);
    }

    const nextPause = this.frameStore?.getLoopPauseMs() ?? this.loopPauseMs;
    if (nextPause !== this.loopPauseMs) {
      this.loopPauseMs = nextPause;
      this.loopHoldConsumed = nextPause <= 0 ? true : false;
      if (nextPause <= 0) {
        this.loopHoldActive = false;
      }
    }

    this.paintFrame();

    if (this.autoplay && !this.isPlaying) {
      this.startPlayback();
    }
  }

  private startPlayback() {
    if (this.frames.length === 0) {
      return;
    }
    this.isPlaying = true;
    this.lastFrameTime = performance.now();
    this.loopHoldActive = false;
    this.loopHoldConsumed = this.loopPauseMs <= 0;
    this.playbackHandle = requestAnimationFrame((time) =>
      this.advanceLoop(time),
    );
  }

  private stopPlayback() {
    if (this.playbackHandle !== null) {
      cancelAnimationFrame(this.playbackHandle);
      this.playbackHandle = null;
    }
    this.isPlaying = false;
  }

  private advanceLoop(time: number) {
    if (!this.isPlaying || this.frames.length === 0) {
      return;
    }

    if (this.loopHoldActive) {
      if (time - this.loopHoldStart < this.loopPauseMs) {
        this.playbackHandle = requestAnimationFrame((nextTime) =>
          this.advanceLoop(nextTime),
        );
        return;
      }
      this.loopHoldActive = false;
      this.lastFrameTime = time - this.frameIntervalMs;
    }

    if (time - this.lastFrameTime >= this.frameIntervalMs) {
      const atLastFrame = this.currentIndex === this.frames.length - 1;
      if (
        atLastFrame &&
        this.loopPauseMs > 0 &&
        !this.loopHoldActive &&
        !this.loopHoldConsumed
      ) {
        this.loopHoldActive = true;
        this.loopHoldConsumed = true;
        this.loopHoldStart = time;
        this.playbackHandle = requestAnimationFrame((nextTime) =>
          this.advanceLoop(nextTime),
        );
        return;
      }

      const wrapped = atLastFrame;
      this.stepFrame(1);
      this.lastFrameTime = time;
      if (wrapped) {
        this.handleLoopCompleted();
      }
    }
    this.playbackHandle = requestAnimationFrame((nextTime) =>
      this.advanceLoop(nextTime),
    );
  }

  private stepFrame(delta: number) {
    if (this.frames.length === 0) {
      return;
    }
    const nextIndex =
      (this.currentIndex + delta + this.frames.length) % this.frames.length;
    this.currentIndex = nextIndex;
    this.paintFrame();
  }

  private paintFrame() {
    this.canvas =
      this.canvas ?? (this.querySelector("canvas") as HTMLCanvasElement | null);
    if (!this.canvas) {
      return;
    }
    const context = this.canvas.getContext("2d");
    if (!context) {
      return;
    }

    if (this.frames.length === 0) {
      context.clearRect(0, 0, this.canvas.width, this.canvas.height);
      return;
    }

    const frame = this.frames[this.currentIndex];
    if (
      this.canvas.width !== frame.width ||
      this.canvas.height !== frame.height
    ) {
      this.canvas.width = frame.width;
      this.canvas.height = frame.height;
    }
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    context.clearRect(0, 0, this.canvas.width, this.canvas.height);

    if (frame.imageBitmap) {
      context.drawImage(frame.imageBitmap, 0, 0, frame.width, frame.height);
      return;
    }

    const image = new Image();
    image.onload = () => {
      context.drawImage(image, 0, 0, frame.width, frame.height);
    };
    image.src = frame.objectUrl;
  }

  private handleLoopCompleted() {
    this.loopHoldConsumed = this.loopPauseMs <= 0;
  }

  private downloadAutoRecording = () => {
    this.dispatchEvent(
      new CustomEvent("recap-request-export", { bubbles: true }),
    );
  };
}
