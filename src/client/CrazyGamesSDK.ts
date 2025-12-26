declare global {
  interface Window {
    CrazyGames?: {
      SDK: {
        init: () => Promise<void>;
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
          getInviteParam: (paramName: string) => string | null;
        };
      };
    };
  }
}

export class CrazyGamesSDK {
  private initialized = false;
  private isGameplayActive = false;

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
      return document.referrer.includes("crazygames");
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
      console.log("CrazyGames SDK initialized");
    } catch (error) {
      console.error("Failed to initialize CrazyGames SDK:", error);
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

  getInviteGameId(): string | null {
    if (!this.isReady()) {
      return null;
    }

    try {
      const value = window.CrazyGames!.SDK.game.getInviteParam("gameId");
      console.log(`CrazyGames: got invite gameId:`, value);
      return value;
    } catch (error) {
      console.error(`Failed to get invite gameId:`, error);
      return null;
    }
  }
}

export const crazyGamesSDK = new CrazyGamesSDK();
