export interface CrazyGamesUser {
  username: string;
  profilePictureUrl: string;
}

declare global {
  interface Window {
    CrazyGames?: {
      SDK: {
        init: () => Promise<void>;
        user: {
          isUserAccountAvailable: boolean;
          getUser(): Promise<CrazyGamesUser | null>;
          getUserToken(): Promise<string>;
          showAuthPrompt(): Promise<CrazyGamesUser | null>;
          addAuthListener: (
            listener: (user: CrazyGamesUser | null) => void,
          ) => void;
        };
        ad: {
          requestAd: (
            adType: string,
            callbacks: {
              adStarted: () => void;
              adFinished: () => void;
              adError: (error: any) => void;
            },
          ) => void;
        };
        game: {
          gameplayStart: () => Promise<void>;
          gameplayStop: () => Promise<void>;
          happytime: () => Promise<void>;
          loadingStart: () => void;
          loadingStop: () => void;
          showInviteButton: (options: {
            gameId: string | number;
            [key: string]: string | number;
          }) => string;
          hideInviteButton: () => void;
          inviteLink: (params: { [key: string]: string | number }) => string;
          getInviteParam: (paramName: string) => string | null;
          isInstantMultiplayer?: boolean;
        };
      };
    };
  }
}

export class CrazyGamesSDK {
  private initialized = false;
  private isGameplayActive = false;
  // Resolves true once the SDK initialized, false once init definitively
  // failed (not on CrazyGames, SDK never loaded, init threw).
  private readyPromise: Promise<boolean>;
  private resolveReady!: (ready: boolean) => void;

  constructor() {
    this.readyPromise = new Promise((resolve) => {
      this.resolveReady = resolve;
    });
  }

  async ready(): Promise<boolean> {
    const timeout = new Promise<boolean>((resolve) => {
      setTimeout(() => resolve(false), 3000);
    });

    return Promise.race([this.readyPromise, timeout]);
  }

  // Like ready() but without the 3s cap: waits for maybeInit() to actually
  // finish (SDK load alone can take ~10s on a slow network). Use this for
  // auth-critical calls, where a premature false logs the player out.
  private whenReady(): Promise<boolean> {
    if (!this.isOnCrazyGames()) {
      return Promise.resolve(false);
    }
    return this.readyPromise;
  }

  isOnCrazyGames(): boolean {
    try {
      // Check if we're in an iframe
      if (window.self !== window.top) {
        // Try to access parent URL
        return window?.top?.location?.hostname.includes("crazygames") ?? false;
      }
      return false;
    } catch (e) {
      // If we get a cross-origin error, we're definitely iframed
      // Check our own referrer as fallback
      const isCrazyGames = document.referrer.includes("crazygames");
      if (isCrazyGames) {
        return true;
      }

      // Fallback: on safari private we can't get referrer, so just assume we are in crazygames if in iframe
      return window.self !== window.top;
    }
  }

  isReady(): boolean {
    return this.isOnCrazyGames() && this.initialized;
  }

  async maybeInit(): Promise<void> {
    if (this.initialized) {
      console.warn("CrazyGames SDK already initialized");
      return;
    }

    if (!this.isOnCrazyGames()) {
      console.log("Not running on CrazyGames platform, not initializing SDK");
      this.resolveReady(false);
      return;
    }

    // Wait for SDK to load
    let attempts = 0;
    while (typeof window.CrazyGames === "undefined" && attempts < 100) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      attempts++;
    }

    if (typeof window.CrazyGames === "undefined") {
      console.warn("CrazyGames SDK not available");
      this.resolveReady(false);
      return;
    }

    try {
      await window.CrazyGames.SDK.init();
      this.initialized = true;
      this.resolveReady(true);
      console.log("CrazyGames SDK initialized");
    } catch (error) {
      console.error("Failed to initialize CrazyGames SDK:", error);
      this.resolveReady(false);
    }
  }

  async getUsername(): Promise<string | null> {
    const isReady = await this.ready();
    if (!isReady) {
      return null;
    }
    try {
      return (await window.CrazyGames!.SDK.user.getUser())?.username ?? null;
    } catch (e) {
      console.log("error getting CrazyGames username: ", e);
      return null;
    }
  }

  // Returns a fresh CrazyGames-signed user token to exchange with our backend,
  // or null if accounts aren't available here or no user is signed in.
  // CrazyGames recommends fetching this fresh each time rather than caching it.
  async getUserToken(): Promise<string | null> {
    if (!(await this.whenReady())) {
      return null;
    }
    try {
      if (!window.CrazyGames!.SDK.user.isUserAccountAvailable) {
        return null;
      }
      return await window.CrazyGames!.SDK.user.getUserToken();
    } catch (e) {
      console.log("error getting CrazyGames user token: ", e);
      return null;
    }
  }

  // Returns the signed-in CrazyGames user (username + avatar), or null if
  // accounts aren't available here or no user is signed in.
  async getUserProfile(): Promise<CrazyGamesUser | null> {
    if (!(await this.whenReady())) {
      return null;
    }
    try {
      return await window.CrazyGames!.SDK.user.getUser();
    } catch (e) {
      console.log("error getting CrazyGames user: ", e);
      return null;
    }
  }

  // Opens CrazyGames' own sign-in prompt. On success the auth listener fires,
  // which drives our re-auth. Resolves regardless of outcome (e.g. cancelled).
  async showAuthPrompt(): Promise<void> {
    if (!(await this.whenReady())) {
      return;
    }
    try {
      await window.CrazyGames!.SDK.user.showAuthPrompt();
    } catch (e) {
      console.log("CrazyGames auth prompt dismissed: ", e);
    }
  }

  async addAuthListener(
    listener: (user: CrazyGamesUser | null) => void,
  ): Promise<void> {
    if (!(await this.whenReady())) {
      return;
    }

    try {
      console.log("registering CrazyGames auth listener");
      window.CrazyGames!.SDK.user.addAuthListener(listener);
    } catch (error) {
      console.error("Failed to add auth listener:", error);
    }
  }

  async isInstantMultiplayer(): Promise<boolean> {
    const isReady = await this.ready();
    if (!isReady) {
      return false;
    }
    const gameId = await this.getInviteGameId();
    if (gameId !== null) {
      // Game id exists, meaning we are joining the game, not hosting it.
      return false;
    }
    try {
      return window.CrazyGames!.SDK.game.isInstantMultiplayer ?? false;
    } catch (e) {
      console.log("Error getting instant multiplayer: ", e);
      return false;
    }
  }

  async gameplayStart(): Promise<void> {
    if (!this.isReady()) {
      return;
    }

    if (this.isGameplayActive) {
      console.warn("Gameplay already started");
      return;
    }

    try {
      await window.CrazyGames!.SDK.game.gameplayStart();
      this.isGameplayActive = true;
      console.log("CrazyGames: gameplay started");
    } catch (error) {
      console.error("Failed to report gameplay start:", error);
    }
  }

  async gameplayStop(): Promise<void> {
    if (!this.isReady()) {
      return;
    }

    if (!this.isGameplayActive) {
      return;
    }

    try {
      await window.CrazyGames!.SDK.game.gameplayStop();
      this.isGameplayActive = false;
      console.log("CrazyGames: gameplay stopped");
    } catch (error) {
      console.error("Failed to report gameplay stop:", error);
    }
  }

  async happytime(): Promise<void> {
    if (!this.isReady()) {
      return;
    }

    try {
      await window.CrazyGames!.SDK.game.happytime();
      console.log("CrazyGames: happy time triggered");
    } catch (error) {
      console.error("Failed to trigger happy time:", error);
    }
  }

  loadingStart(): void {
    if (!this.isReady()) {
      return;
    }

    try {
      window.CrazyGames!.SDK.game.loadingStart();
      console.log("CrazyGames: loading started");
    } catch (error) {
      console.error("Failed to report loading start:", error);
    }
  }

  loadingStop(): void {
    if (!this.isReady()) {
      return;
    }

    try {
      window.CrazyGames!.SDK.game.loadingStop();
      console.log("CrazyGames: loading stopped");
    } catch (error) {
      console.error("Failed to report loading stop:", error);
    }
  }

  showInviteButton(gameId: string): string | null {
    if (!this.isReady()) {
      return null;
    }
    try {
      const options: {
        gameId: string | number;
        [key: string]: string | number;
      } = {
        gameId,
      };
      const link = window.CrazyGames!.SDK.game.showInviteButton(options);
      // Store the game so we know that we are host. This way when player refreshes page,
      // It won't show up as "joining" a game we created.
      localStorage.setItem(gameId, "true");
      console.log("CrazyGames: invite button shown, link:", link);
      return link;
    } catch (error) {
      console.error("Failed to show invite button:", error);
      return null;
    }
  }

  hideInviteButton(): void {
    if (!this.isReady()) {
      return;
    }

    try {
      window.CrazyGames!.SDK.game.hideInviteButton();
      console.log("CrazyGames: invite button hidden");
    } catch (error) {
      console.error("Failed to hide invite button:", error);
    }
  }

  createInviteLink(gameId: string): string | null {
    if (!this.isReady()) {
      console.warn("CrazyGames SDK not ready, cannot create invite link");
      return null;
    }

    try {
      const link = window.CrazyGames!.SDK.game.inviteLink({ gameId });
      console.log("CrazyGames: created invite link:", link);
      return link;
    } catch (error) {
      console.error("Failed to create invite link:", error);
      return null;
    }
  }

  async getInviteGameId(): Promise<string | null> {
    if (!(await this.ready())) {
      return null;
    }
    try {
      const gameId = window.CrazyGames!.SDK.game.getInviteParam("gameId");
      if (gameId) {
        console.log("[CrazyGames] found invite link", gameId);
        // We already created this game, can't join a game we created.
        return localStorage.getItem(gameId) === "true" ? null : gameId;
      }
      return null;
    } catch (error) {
      console.error(`Failed to get invite gameId:`, error);
      return null;
    }
  }

  requestMidgameAd(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.isReady()) {
        resolve();
        return;
      }

      try {
        const callbacks = {
          adFinished: () => {
            console.log("End midgame ad");
            resolve();
          },
          adError: (error: any) => {
            console.log("Error midgame ad", error);
            resolve();
          },
          adStarted: () => console.log("Start midgame ad"),
        };
        window.CrazyGames!.SDK.ad.requestAd("midgame", callbacks);
      } catch (error) {
        console.error("Failed to request midgame ad:", error);
        resolve();
      }
    });
  }
}

export const crazyGamesSDK = new CrazyGamesSDK();
