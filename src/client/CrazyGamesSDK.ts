declare global {
  interface Window {
    CrazyGames?: {
      SDK: {
        init: () => Promise<void>;
        user: {
          getUser(): Promise<{
            username: string;
          } | null>;
          addAuthListener: (
            listener: (
              user: {
                username: string;
              } | null,
            ) => void,
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
  private readyPromise: Promise<void>;
  private resolveReady!: () => void;

  constructor() {
    this.readyPromise = new Promise((resolve) => {
      this.resolveReady = resolve;
    });
  }

  async ready(): Promise<boolean> {
    const timeout = new Promise<boolean>((resolve) => {
      setTimeout(() => resolve(false), 3000);
    });

    const ready = this.readyPromise.then(() => true);

    return Promise.race([ready, timeout]);
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
      console.log("[CrazyGames]: ", e);
      // If we get a cross-origin error, we're definitely iframed
      // Check our own referrer as fallback
      const isCrazyGames = document.referrer.includes("crazygames");
      console.log("[CrazyGames], contains referrer: ", isCrazyGames);
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
      return;
    }

    try {
      await window.CrazyGames.SDK.init();
      this.initialized = true;
      this.resolveReady();
      console.log("CrazyGames SDK initialized");
    } catch (error) {
      console.error("Failed to initialize CrazyGames SDK:", error);
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

  async addAuthListener(
    listener: (
      user: {
        username: string;
      } | null,
    ) => void,
  ): Promise<void> {
    if (!(await this.ready())) {
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
