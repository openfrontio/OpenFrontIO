import { Howler } from "howler";
import type { PortalUser } from "./GamePortal";

const POKI_SDK_URL = "https://game-cdn.poki.com/scripts/v2/poki-sdk.js";

// Cap on loading and initializing the SDK. Token refresh waits for the SDK to
// be ready, so one that never settles must not hold sign-in up forever.
const SDK_DEADLINE_MS = 10_000;

// Poki's game frame (games.poki.com), their build CDN (*.poki-gdn.com) and the
// Poki Inspector (inspector.poki.dev).
const POKI_HOST = /(^|\.)(poki\.com|poki-gdn\.com|poki\.dev)$/;

declare global {
  interface Window {
    PokiSDK?: {
      init(): Promise<void>;
      gameLoadingFinished(): void;
      gameplayStart(): void;
      gameplayStop(): void;
      commercialBreak(onStart?: () => void): Promise<void>;
      shareableURL(params: Record<string, string>): Promise<string>;
      getURLParam(name: string): string;
      openExternalLink(url: string): void;
      login(): Promise<void>;
      getUser(): Promise<{ username: string; avatarUrl: string } | null>;
      getToken(): Promise<string | null>;
    };
  }
}

function isPokiHost(url: string): boolean {
  try {
    return POKI_HOST.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

const POKI_SESSION_KEY = "onPoki";

// Storage can throw in a sandboxed or private frame; Poki requires the game
// to keep working there, so detection just falls back to the live check.
function readSession(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSession(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // See readSession.
  }
}

// Mirrors CrazyGamesSDK's surface so GamePortal can route to either. Poki has
// no loading events per join, no invite button, no instant multiplayer and no
// happytime, so those are no-ops here.
export class PokiSDK {
  private initialized = false;
  private isGameplayActive = false;
  private authListeners: ((user: PortalUser | null) => void)[] = [];
  private readyPromise: Promise<boolean>;
  private resolveReady!: (ready: boolean) => void;

  constructor() {
    this.readyPromise = new Promise((resolve) => {
      this.resolveReady = resolve;
    });
  }

  // Poki frames us, so our parent is a Poki origin. ancestorOrigins survives
  // in-frame navigations; Firefox lacks it, and the referrer it falls back to
  // becomes our own URL after one (leaving a game, a lobby redirect). So a
  // positive answer is kept for the frame's session: sessionStorage survives
  // those navigations and is scoped to this frame, never a top-level tab.
  isOnPoki(): boolean {
    if (window.self === window.top) return false;
    if (readSession(POKI_SESSION_KEY) === "true") return true;
    const ancestors = window.location.ancestorOrigins;
    const onPoki =
      ancestors !== undefined && ancestors.length > 0
        ? Array.from(ancestors).some(isPokiHost)
        : isPokiHost(document.referrer);
    if (onPoki) writeSession(POKI_SESSION_KEY, "true");
    return onPoki;
  }

  isReady(): boolean {
    return this.isOnPoki() && this.initialized;
  }

  private whenReady(): Promise<boolean> {
    if (!this.isOnPoki()) {
      return Promise.resolve(false);
    }
    return this.readyPromise;
  }

  async maybeInit(): Promise<void> {
    if (this.initialized) {
      console.warn("Poki SDK already initialized");
      return;
    }
    if (!this.isOnPoki()) {
      this.resolveReady(false);
      return;
    }

    const loaded = await new Promise<boolean>((resolve) => {
      const script = document.createElement("script");
      script.src = POKI_SDK_URL;
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      setTimeout(() => resolve(false), SDK_DEADLINE_MS);
      document.head.appendChild(script);
    });
    if (!loaded || window.PokiSDK === undefined) {
      console.warn("Poki SDK not available");
      this.resolveReady(false);
      return;
    }

    try {
      await Promise.race([
        window.PokiSDK.init(),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("init timed out")),
            SDK_DEADLINE_MS,
          ),
        ),
      ]);
      console.log("Poki SDK initialized");
    } catch (error) {
      // Typically an adblocker, which can also leave init() unsettled. Poki's
      // guidance is to run the game anyway; the SDK calls stay safe and ad
      // breaks resolve immediately.
      console.warn("Poki SDK initialized with an error:", error);
    }
    this.initialized = true;
    this.resolveReady(true);
    // Main has already rendered the homepage by the time the SDK is up.
    window.PokiSDK.gameLoadingFinished();
    this.routeExternalLinks();
  }

  // Poki requires every outbound link to go through openExternalLink. Every
  // external link in the app is an <a target="_blank">, so one capture-phase
  // listener covers them all, including those inside shadow roots.
  private routeExternalLinks(): void {
    document.addEventListener(
      "click",
      (event) => {
        const anchor = event
          .composedPath()
          .find(
            (el): el is HTMLAnchorElement =>
              el instanceof HTMLAnchorElement && el.target === "_blank",
          );
        if (anchor === undefined || anchor.href === "") return;
        event.preventDefault();
        window.PokiSDK!.openExternalLink(anchor.href);
      },
      true,
    );
  }

  async getUsername(): Promise<string | null> {
    return (await this.getUserProfile())?.username ?? null;
  }

  // A fresh Poki token for our backend to verify. It expires after a minute,
  // so it is fetched for each exchange and never cached.
  async getUserToken(): Promise<string | null> {
    if (!(await this.whenReady())) {
      return null;
    }
    try {
      return await window.PokiSDK!.getToken();
    } catch (e) {
      // Thrown when accounts aren't available or the player opted out.
      console.log("error getting Poki user token: ", e);
      return null;
    }
  }

  async getUserProfile(): Promise<PortalUser | null> {
    if (!(await this.whenReady())) {
      return null;
    }
    try {
      const user = await window.PokiSDK!.getUser();
      if (user === null) return null;
      return { username: user.username, profilePictureUrl: user.avatarUrl };
    } catch (e) {
      console.log("error getting Poki user: ", e);
      return null;
    }
  }

  // Poki has no auth listener, so a completed login notifies ours here. Only
  // call this from a click: Poki forbids prompting on its own.
  async showAuthPrompt(): Promise<void> {
    if (!(await this.whenReady())) {
      return;
    }
    try {
      await window.PokiSDK!.login();
    } catch (e) {
      console.log("Poki login dismissed: ", e);
      return;
    }
    const user = await this.getUserProfile();
    this.authListeners.forEach((listener) => listener(user));
  }

  async addAuthListener(
    listener: (user: PortalUser | null) => void,
  ): Promise<void> {
    this.authListeners.push(listener);
  }

  async isInstantMultiplayer(): Promise<boolean> {
    return false;
  }

  async gameplayStart(): Promise<void> {
    if (!this.isReady() || this.isGameplayActive) {
      return;
    }
    window.PokiSDK!.gameplayStart();
    this.isGameplayActive = true;
  }

  async gameplayStop(): Promise<void> {
    if (!this.isReady() || !this.isGameplayActive) {
      return;
    }
    window.PokiSDK!.gameplayStop();
    this.isGameplayActive = false;
  }

  async happytime(): Promise<void> {}

  loadingStart(): void {}

  loadingStop(): void {}

  showInviteButton(_gameId: string): string | null {
    return null;
  }

  hideInviteButton(): void {}

  // Resolves to a poki.com link carrying the id as a gd-prefixed param, which
  // getInviteGameId reads back on the invitee's side.
  async createInviteLink(gameId: string): Promise<string | null> {
    if (!this.isReady()) {
      return null;
    }
    try {
      return await window.PokiSDK!.shareableURL({ gameId });
    } catch (error) {
      console.error("Failed to create Poki invite link:", error);
      return null;
    }
  }

  async getInviteGameId(): Promise<string | null> {
    if (!(await this.whenReady())) {
      return null;
    }
    return window.PokiSDK!.getURLParam("gameId") || null;
  }

  // Poki decides whether an ad actually plays, and requires gameplay stopped
  // and audio muted for its duration.
  async requestMidgameAd(): Promise<void> {
    if (!this.isReady()) {
      return;
    }
    await this.gameplayStop();
    try {
      await window.PokiSDK!.commercialBreak(() => Howler.mute(true));
    } catch (error) {
      console.warn("Poki commercial break failed:", error);
    } finally {
      Howler.mute(false);
    }
  }
}

export const pokiSDK = new PokiSDK();
