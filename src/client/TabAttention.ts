import { UserSettings } from "./UserSettings";
import { translateText } from "./Utils";

export type TabAttentionKind = "starting" | "spawn";

// Two full blinks per second: alert<->normal flips every 250 ms (500 ms per cycle).
const FLASH_INTERVAL_MS = 250;
// A safety net: if the game never reaches (or never leaves) the spawn phase,
// stop flashing rather than blinking in a background tab forever.
const MAX_FLASH_MS = 2 * 60 * 1000;

// The game's own warship favicon on a white tile. Same pixels and the same
// padded -2 -2 15 15 framing as Favicon.svg (which has a black tile), so the
// ship stays the same size and only the background flips between black and
// white. Inline so it needs no asset pipeline entry.
const ALERT_ICON_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="-2 -2 15 15" shape-rendering="crispEdges">` +
  `<rect x="-2" y="-2" width="15" height="15" fill="#fff"/>` +
  `<path fill="#0084d1" d="M2 0h4v1h-4zM2 1h4v1h-4zM4 2h4v1h-4zM4 3h4v1h-4zM6 4h4v1h-4zM6 5h4v1h-4zM6 6h4v1h-4zM4 7h4v1h-4zM4 8h4v1h-4zM2 9h4v1h-4zM2 10h4v1h-4z"/>` +
  `</svg>`;
const ALERT_ICON_SVG_HREF =
  "data:image/svg+xml," + encodeURIComponent(ALERT_ICON_SVG);

/**
 * Flashes the tab title and favicon while the page is in a background tab and
 * the player still has something to do (the game is starting, or they have yet
 * to pick a spawn). Flashing stops as soon as the tab is visible again, and
 * resumes if the player leaves while the need remains.
 */
export class TabAttention {
  private kind: TabAttentionKind | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private startedAt = 0;
  private alertShown = false;
  private originalTitle: string | null = null;
  private originalIconHref: string | null = null;
  private originalIconType: string | null = null;
  private listening = false;
  // Starts as the SVG; swapped for a PNG once it has been rendered, since not
  // every browser draws SVG favicons from data URIs reliably.
  private alertIconHref = ALERT_ICON_SVG_HREF;
  private alertIconType = "image/svg+xml";
  private pngRequested = false;

  /**
   * @param isEnabled Whether the player has the feature turned on. Checked on
   * every request and every blink, so switching it off takes effect at once.
   */
  constructor(private readonly isEnabled: () => boolean = () => true) {}

  /** Ask for the player's attention. Safe to call repeatedly. */
  request(kind: TabAttentionKind): void {
    if (!this.isEnabled()) {
      this.release();
      return;
    }
    if (this.kind === null) this.startedAt = Date.now();
    this.kind = kind;
    this.listen();
    this.preparePngIcon();
    this.sync();
  }

  /** The player no longer needs to be alerted. Safe to call repeatedly. */
  release(): void {
    if (this.kind === null) return;
    this.kind = null;
    this.sync();
  }

  private listen(): void {
    if (this.listening || typeof document === "undefined") return;
    this.listening = true;
    document.addEventListener("visibilitychange", this.sync);
    window.addEventListener("focus", this.sync);
  }

  private readonly sync = (): void => {
    const expired =
      this.kind !== null && Date.now() - this.startedAt > MAX_FLASH_MS;
    if (expired) this.kind = null;
    if (this.kind !== null && !this.isEnabled()) this.kind = null;
    const shouldFlash = this.kind !== null && document.hidden;
    if (shouldFlash) {
      this.startFlashing();
    } else {
      this.stopFlashing();
    }
  };

  private startFlashing(): void {
    if (this.timer !== null) return;
    this.originalTitle = document.title;
    const link = this.iconLink();
    this.originalIconHref = link?.getAttribute("href") ?? null;
    this.originalIconType = link?.getAttribute("type") ?? null;
    this.alertShown = false;
    this.flash();
    this.timer = setInterval(this.flash, FLASH_INTERVAL_MS);
  }

  private stopFlashing(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
    this.apply(false);
  }

  private readonly flash = (): void => {
    if (Date.now() - this.startedAt > MAX_FLASH_MS || !this.isEnabled()) {
      this.kind = null;
      this.stopFlashing();
      return;
    }
    this.apply(!this.alertShown);
  };

  private apply(alert: boolean): void {
    this.alertShown = alert;
    const link = this.iconLink();
    if (alert) {
      document.title = this.message();
      if (link) {
        link.setAttribute("type", this.alertIconType);
        link.setAttribute("href", this.alertIconHref);
      }
      return;
    }
    if (this.originalTitle !== null) document.title = this.originalTitle;
    if (link && this.originalIconHref !== null) {
      link.setAttribute("href", this.originalIconHref);
      if (this.originalIconType !== null) {
        link.setAttribute("type", this.originalIconType);
      } else {
        link.removeAttribute("type");
      }
    }
  }

  private preparePngIcon(): void {
    if (this.pngRequested || typeof Image === "undefined") return;
    this.pngRequested = true;
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, 0, 0, 64, 64);
        this.alertIconHref = canvas.toDataURL("image/png");
        this.alertIconType = "image/png";
      } catch {
        // Keep the SVG icon.
      }
    };
    img.src = ALERT_ICON_SVG_HREF;
  }

  private message(): string {
    return this.kind === "spawn"
      ? translateText("tab_attention.pick_spawn")
      : translateText("tab_attention.starting");
  }

  private iconLink(): HTMLLinkElement | null {
    return document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
  }
}

export const tabAttention = new TabAttention(() =>
  new UserSettings().tabAttention(),
);
