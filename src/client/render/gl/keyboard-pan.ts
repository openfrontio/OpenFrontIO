/**
 * KeyboardPan — WASD camera panning, Q/E smooth zoom, and C fit-zoom.
 *
 * Tracks held keys and runs a requestAnimationFrame loop while any
 * direction or zoom key is pressed. All movement is frame-rate
 * independent. Pan speed is zoom-adaptive (faster when zoomed out).
 *
 * Skips all input when the user is typing in an input/textarea.
 */

const WASD = new Set(["w", "a", "s", "d"]);
const ZOOM_KEYS = new Set(["q", "e"]);
const DEFAULT_PAN_SPEED = 800; // tiles per second at zoom = 1
const DEFAULT_ZOOM_SPEED = 2.0; // zoom multiplier per second (e.g. 2× per second held)

interface KeyboardPanDeps {
  panBy(dx: number, dy: number): void;
  zoomBy(factor: number): void;
  focusOwner(ownerID: number): void;
  fitMap(): void;
  readonly zoom: number;
}

export class KeyboardPan {
  private deps: KeyboardPanDeps;
  private raf: typeof requestAnimationFrame;
  private caf: typeof cancelAnimationFrame;

  private held = new Set<string>();
  private animId: number | null = null;
  private lastTime = 0;
  private localPlayerID = 0;
  private panSpeed = DEFAULT_PAN_SPEED;
  private zoomSpeed = DEFAULT_ZOOM_SPEED;

  constructor(
    deps: KeyboardPanDeps,
    raf: typeof requestAnimationFrame = requestAnimationFrame.bind(window),
    caf: typeof cancelAnimationFrame = cancelAnimationFrame.bind(window),
  ) {
    this.deps = deps;
    this.raf = raf;
    this.caf = caf;
  }

  handleKeyDown(e: KeyboardEvent): boolean {
    if (isTyping()) return false;

    const key = e.key.toLowerCase();

    if (key === "c" && !e.repeat) {
      if (this.localPlayerID > 0) this.deps.focusOwner(this.localPlayerID);
      else this.deps.fitMap();
      return true;
    }

    if (WASD.has(key) || ZOOM_KEYS.has(key)) {
      this.held.add(key);
      if (this.animId === null) this.startLoop();
      return true;
    }

    return false;
  }

  handleKeyUp(e: KeyboardEvent): boolean {
    const key = e.key.toLowerCase();
    if (WASD.has(key) || ZOOM_KEYS.has(key)) {
      this.held.delete(key);
      if (this.held.size === 0) this.stopLoop();
      return true;
    }
    return false;
  }

  setLocalPlayerID(id: number): void {
    this.localPlayerID = id;
  }
  setPanSpeed(speed: number): void {
    this.panSpeed = speed;
  }
  setZoomSpeed(speed: number): void {
    this.zoomSpeed = speed;
  }

  dispose(): void {
    this.stopLoop();
    this.held.clear();
  }

  // ---- Animation loop ----

  private startLoop(): void {
    this.lastTime = performance.now();
    this.animId = this.raf(this.loop);
  }

  private stopLoop(): void {
    if (this.animId !== null) {
      this.caf(this.animId);
      this.animId = null;
    }
  }

  private loop = (): void => {
    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, 0.1); // cap at 100ms
    this.lastTime = now;

    const speed = this.panSpeed / this.deps.zoom;
    let dx = 0;
    let dy = 0;
    if (this.held.has("a")) dx -= speed * dt;
    if (this.held.has("d")) dx += speed * dt;
    if (this.held.has("w")) dy -= speed * dt;
    if (this.held.has("s")) dy += speed * dt;

    if (dx !== 0 || dy !== 0) this.deps.panBy(dx, dy);

    // Q/E smooth zoom: compute multiplicative factor for this frame
    let zoomDir = 0;
    if (this.held.has("e")) zoomDir += 1;
    if (this.held.has("q")) zoomDir -= 1;
    if (zoomDir !== 0) {
      const factor = this.zoomSpeed ** (zoomDir * dt);
      this.deps.zoomBy(factor);
    }

    if (this.held.size > 0) this.animId = this.raf(this.loop);
    else this.animId = null;
  };
}

function isTyping(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}
