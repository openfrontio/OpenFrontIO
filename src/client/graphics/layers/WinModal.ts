import { LitElement, TemplateResult, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { translateText } from "../../../client/Utils";
import { ColorPalette, Pattern } from "../../../core/CosmeticSchemas";
import { EventBus } from "../../../core/EventBus";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { GameView } from "../../../core/game/GameView";
import "../../components/PatternButton";
import {
  fetchCosmetics,
  handlePurchase,
  patternRelationship,
} from "../../Cosmetics";
import { getUserMe } from "../../jwt";
import { SendWinnerEvent } from "../../Transport";
import { Layer } from "./Layer";

@customElement("win-modal")
export class WinModal extends LitElement implements Layer {
  public game: GameView;
  public eventBus: EventBus;

  private hasShownDeathModal = false;

  @state()
  isVisible = false;

  @state()
  showButtons = false;

  @state()
  private patternContent: TemplateResult | null = null;

  @state()
  private rewardedAdAvailable = false;

  private _title: string;

  // Override to prevent shadow DOM creation
  createRenderRoot() {
    return this;
  }

  constructor() {
    super();
    this.setupRewardedAdEventListeners();
  }

  private setupRewardedAdEventListeners() {
    // Listen for rewarded ad lifecycle events
    window.addEventListener(
      "rewardedAdVideoRewardReady",
      this.onRewardedAdReady.bind(this),
    );
    window.addEventListener(
      "userAcceptsRewardedAd",
      this.onUserAcceptsRewardedAd.bind(this),
    );
    window.addEventListener(
      "rewardedAdCompleted",
      this.onRewardedAdCompleted.bind(this),
    );
    window.addEventListener(
      "rewardedAdRewardGranted",
      this.onRewardedAdRewardGranted.bind(this),
    );
    window.addEventListener(
      "rewardedCloseButtonTriggered",
      this.onRewardedAdClosed.bind(this),
    );
    window.addEventListener(
      "userClosedWithRewardCanResolve",
      this.onUserClosedWithReward.bind(this),
    );
    window.addEventListener(
      "rejectAdCloseCta",
      this.onRejectAdClose.bind(this),
    );
  }

  private onRewardedAdReady() {
    console.log("🎥 Rewarded ad is ready to play!");
    this.rewardedAdAvailable = true;
    this.requestUpdate();
  }

  private onUserAcceptsRewardedAd() {
    console.log("👆 User clicked to begin watching an ad");
  }

  private onRewardedAdCompleted() {
    console.log("✅ Ad was watched in full");
  }

  private onRewardedAdRewardGranted() {
    console.log("🎁 User watched enough to earn a reward");
  }

  private onRewardedAdClosed() {
    console.log("❌ User closed the ad early");
  }

  private onUserClosedWithReward() {
    console.log("🎁 User closed the ad after qualifying for the reward");
  }

  private onRejectAdClose() {
    console.log("❌ User closed the call-to-action prompt");
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    // Clean up event listeners
    window.removeEventListener(
      "rewardedAdVideoRewardReady",
      this.onRewardedAdReady.bind(this),
    );
    window.removeEventListener(
      "userAcceptsRewardedAd",
      this.onUserAcceptsRewardedAd.bind(this),
    );
    window.removeEventListener(
      "rewardedAdCompleted",
      this.onRewardedAdCompleted.bind(this),
    );
    window.removeEventListener(
      "rewardedAdRewardGranted",
      this.onRewardedAdRewardGranted.bind(this),
    );
    window.removeEventListener(
      "rewardedCloseButtonTriggered",
      this.onRewardedAdClosed.bind(this),
    );
    window.removeEventListener(
      "userClosedWithRewardCanResolve",
      this.onUserClosedWithReward.bind(this),
    );
    window.removeEventListener(
      "rejectAdCloseCta",
      this.onRejectAdClose.bind(this),
    );
  }

  render() {
    return html`
      <div
        class="${this.isVisible
          ? "fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gray-800/70 p-6 rounded-lg z-[9999] shadow-2xl backdrop-blur-sm text-white w-[350px] max-w-[90%] md:w-[700px] md:max-w-[700px] animate-fadeIn"
          : "hidden"}"
      >
        <h2 class="m-0 mb-4 text-[26px] text-center text-white">
          ${this._title || ""}
        </h2>
        ${this.innerHtml()}
        <div class="mb-4">
          <button
            @click=${this._handleRewardedAd}
            class="w-full px-4 py-3 text-base cursor-pointer ${this
              .rewardedAdAvailable
              ? "bg-gradient-to-r from-purple-500/80 to-pink-500/80 hover:from-purple-500 hover:to-pink-500"
              : "bg-gray-500/60 cursor-not-allowed"} text-white border-0 rounded transition-all duration-200 hover:-translate-y-px active:translate-y-px font-semibold"
            ?disabled=${!this.rewardedAdAvailable}
          >
            ${this.rewardedAdAvailable ? "Rewarded Ad" : "Loading Ad..."}
          </button>
        </div>
        <div
          class="${this.showButtons
            ? "flex justify-between gap-2.5"
            : "hidden"}"
        >
          <button
            @click=${this._handleExit}
            class="flex-1 px-3 py-3 text-base cursor-pointer bg-blue-500/60 text-white border-0 rounded transition-all duration-200 hover:bg-blue-500/80 hover:-translate-y-px active:translate-y-px"
          >
            ${translateText("win_modal.exit")}
          </button>
          <button
            @click=${this.hide}
            class="flex-1 px-3 py-3 text-base cursor-pointer bg-blue-500/60 text-white border-0 rounded transition-all duration-200 hover:bg-blue-500/80 hover:-translate-y-px active:translate-y-px"
          >
            ${translateText("win_modal.keep")}
          </button>
        </div>
      </div>

      <style>
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translate(-50%, -48%);
          }
          to {
            opacity: 1;
            transform: translate(-50%, -50%);
          }
        }

        .animate-fadeIn {
          animation: fadeIn 0.3s ease-out;
        }
      </style>
    `;
  }

  innerHtml() {
    return html`<div
        id="rewarded-ad-container"
        class="w-full h-full flex items-center justify-center"
      ></div>
      ${this.renderPatternButton()}`;
  }

  renderPatternButton() {
    return html`
      <div class="text-center mb-6 bg-black/30 p-2.5 rounded">
        <h3 class="text-xl font-semibold text-white mb-3">
          ${translateText("win_modal.support_openfront")}
        </h3>
        <p class="text-white mb-3">
          ${translateText("win_modal.territory_pattern")}
        </p>
        <div class="flex justify-center">${this.patternContent}</div>
      </div>
    `;
  }

  async loadPatternContent() {
    const me = await getUserMe();
    const patterns = await fetchCosmetics();

    const purchasablePatterns: {
      pattern: Pattern;
      colorPalette: ColorPalette;
    }[] = [];

    for (const pattern of Object.values(patterns?.patterns ?? {})) {
      for (const colorPalette of pattern.colorPalettes ?? []) {
        if (
          patternRelationship(
            pattern,
            colorPalette,
            me !== false ? me : null,
            null,
          ) === "purchasable"
        ) {
          const palette = patterns?.colorPalettes?.[colorPalette.name];
          if (palette) {
            purchasablePatterns.push({
              pattern,
              colorPalette: palette,
            });
          }
        }
      }
    }

    if (purchasablePatterns.length === 0) {
      this.patternContent = html``;
      return;
    }

    // Shuffle the array and take patterns based on screen size
    const shuffled = [...purchasablePatterns].sort(() => Math.random() - 0.5);
    const isMobile = window.innerWidth < 768; // md breakpoint
    const maxPatterns = isMobile ? 1 : 3;
    const selectedPatterns = shuffled.slice(
      0,
      Math.min(maxPatterns, shuffled.length),
    );

    this.patternContent = html`
      <div class="flex gap-4 flex-wrap justify-start">
        ${selectedPatterns.map(
          ({ pattern, colorPalette }) => html`
            <pattern-button
              .pattern=${pattern}
              .colorPalette=${colorPalette}
              .requiresPurchase=${true}
              .onSelect=${(p: Pattern | null) => {}}
              .onPurchase=${(p: Pattern, colorPalette: ColorPalette | null) =>
                handlePurchase(p, colorPalette)}
            ></pattern-button>
          `,
        )}
      </div>
    `;
  }

  steamWishlist(): TemplateResult {
    return html`<p class="m-0 mb-5 text-center bg-black/30 p-2.5 rounded">
      <a
        href="https://store.steampowered.com/app/3560670"
        target="_blank"
        rel="noopener noreferrer"
        class="text-[#4a9eff] underline font-medium transition-colors duration-200 text-2xl hover:text-[#6db3ff]"
      >
        ${translateText("win_modal.wishlist")}
      </a>
    </p>`;
  }

  async show() {
    this.loadAds();
    await this.loadPatternContent();
    this.initializeRewardedAd();
    this.isVisible = true;
    this.requestUpdate();
    setTimeout(() => {
      this.showButtons = true;
      this.requestUpdate();
    }, 3000);
  }

  private initializeRewardedAd() {
    if (!window.ramp) {
      console.warn("Playwire RAMP not available for rewarded ads");
      return;
    }

    // For out-of-the-box approach, we don't need complex initialization
    // Just enable the button after a short delay to allow RAMP to load
    setTimeout(() => {
      console.log("🎬 Enabling rewarded ad button");
      this.rewardedAdAvailable = true;
      this.requestUpdate();
    }, 2000);
  }

  hide() {
    this.isVisible = false;
    this.showButtons = false;
    this.requestUpdate();
  }

  private loadAds() {
    if (!window.ramp) {
      console.warn("Playwire RAMP not available");
      return;
    }

    window.ramp.que.push(() => {
      window.ramp.spaAddAds([
        {
          type: "rewarded_ad_video",
          selectorId: "rewarded-ad-container",
        },
      ]);
      console.log("Playwire ad loaded:", "rewarded_ad_video");
    });
  }

  private _handleRewardedAd() {
    console.log("🎯 Rewarded Ad button clicked");

    if (!window.ramp) {
      console.warn("Playwire RAMP not available");
      return;
    }

    // Disable button during playback
    this.rewardedAdAvailable = false;
    this.requestUpdate();

    const modalConfig = {
      title: "Earn a reward!",
      confirmButtonText: "Watch the Video!",
      backgroundOverlay: true,
      backgroundColor: "",
      confirmButtonColor: undefined,
      titleColor: undefined,
      logoSrc: "",
      nameLogoSrc: "",
    };

    const confirmModalConfig = {
      title: "Thank you for watching",
      subTitle: "You have earned 2 coins!",
      closeButtonText: "",
      backgroundOverlay: false,
      backgroundColor: "",
      subTitleTextColor: "#FF0000",
      buttonColor: undefined,
      titleColor: "#FF0000",
      logoSrc: "",
    };

    console.log(
      "window.ramp methods:",
      Object.getOwnPropertyNames(window.ramp),
    );
    window.ramp
      .showRewardedVideoModal(modalConfig, confirmModalConfig)
      .then(() => console.log("✅ Reward granted"))
      .then(() => window.ramp.showRewardedVideoConfirmationModal())
      .catch((error) => console.error("❌ Rewarded video error:", error));
  }

  private grantReward() {
    // Implement your reward logic here
    // This could be:
    // - Adding coins to the player's account
    // - Unlocking special patterns
    // - Giving extra lives
    // - Any other in-game benefit

    console.log("🎁 Player earned a reward!");
    // Show Playwire confirmation modal if available
    try {
      if (window.ramp.showRewardedVideoConfirmationModal) {
        window.ramp.showRewardedVideoConfirmationModal();
      } else if (window.ramp.showRewardedVideoConfirmModal) {
        window.ramp.showRewardedVideoConfirmModal();
      }
    } catch (e) {
      // no-op
    }

    // Re-enable button after flow
    this.rewardedAdAvailable = true;
    this.requestUpdate();
  }

  private showRewardError() {
    // Show user-friendly error message
    console.log("❌ Unable to show ad at this time. Please try again later.");
    // You could show a toast notification or modal here
  }

  private _handleExit() {
    this.hide();
    window.location.href = "/";
  }

  init() {}

  tick() {
    const myPlayer = this.game.myPlayer();
    if (
      !this.hasShownDeathModal &&
      myPlayer &&
      !myPlayer.isAlive() &&
      !this.game.inSpawnPhase() &&
      myPlayer.hasSpawned()
    ) {
      this.hasShownDeathModal = true;
      this._title = translateText("win_modal.died");
      this.show();
    }
    const updates = this.game.updatesSinceLastTick();
    const winUpdates = updates !== null ? updates[GameUpdateType.Win] : [];
    winUpdates.forEach((wu) => {
      if (wu.winner === undefined) {
        // ...
      } else if (wu.winner[0] === "team") {
        this.eventBus.emit(new SendWinnerEvent(wu.winner, wu.allPlayersStats));
        if (wu.winner[1] === this.game.myPlayer()?.team()) {
          this._title = translateText("win_modal.your_team");
        } else {
          this._title = translateText("win_modal.other_team", {
            team: wu.winner[1],
          });
        }
        this.show();
      } else {
        const winner = this.game.playerByClientID(wu.winner[1]);
        if (!winner?.isPlayer()) return;
        const winnerClient = winner.clientID();
        if (winnerClient !== null) {
          this.eventBus.emit(
            new SendWinnerEvent(["player", winnerClient], wu.allPlayersStats),
          );
        }
        if (
          winnerClient !== null &&
          winnerClient === this.game.myPlayer()?.clientID()
        ) {
          this._title = translateText("win_modal.you_won");
        } else {
          this._title = translateText("win_modal.other_won", {
            player: winner.name(),
          });
        }
        this.show();
      }
    });
  }

  renderLayer(/* context: CanvasRenderingContext2D */) {}

  shouldTransform(): boolean {
    return false;
  }
}
