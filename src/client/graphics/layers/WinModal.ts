import { LitElement, TemplateResult, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  getGamesPlayed,
  isInIframe,
  translateText,
} from "../../../client/Utils";
import { ColorPalette, Pattern } from "../../../core/CosmeticSchemas";
import { EventBus } from "../../../core/EventBus";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { GameView } from "../../../core/game/GameView";
import { getUserMe } from "../../Api";
import "../../components/PatternButton";
import {
  fetchCosmetics,
  handlePurchase,
  patternRelationship,
} from "../../Cosmetics";
import { crazyGamesSDK } from "../../CrazyGamesSDK";
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
  private isWin = false;

  @state()
  private patternContent: TemplateResult | null = null;

  private _title: string;

  private rand = Math.random();

  // Override to prevent shadow DOM creation
  createRenderRoot() {
    return this;
  }

  constructor() {
    super();
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
            ${this.isWin
              ? translateText("win_modal.keep")
              : translateText("win_modal.spectate")}
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
    if (isInIframe()) {
      return this.steamWishlist();
    }

    if (!this.isWin && getGamesPlayed() < 3) {
      return this.renderYoutubeTutorial();
    }
    if (this.rand < 0.25) {
      return this.steamWishlist();
    } else if (this.rand < 0.5) {
      return this.discordDisplay();
    } else {
      return this.renderPatternButton();
    }
  }

  renderYoutubeTutorial() {
    return html`
      <div class="text-center mb-6 bg-black/30 p-2.5 rounded">
        <h3 class="text-xl font-semibold text-white mb-3">
          ${translateText("win_modal.youtube_tutorial")}
        </h3>
        <div class="relative w-full" style="padding-bottom: 56.25%;">
          <iframe
            class="absolute top-0 left-0 w-full h-full rounded"
            src="${this.isVisible
              ? "https://www.youtube.com/embed/EN2oOog3pSs"
              : ""}"
            title="YouTube video player"
            frameborder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowfullscreen
          ></iframe>
        </div>
      </div>
    `;
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
          patternRelationship(pattern, colorPalette, me, null) === "purchasable"
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

  discordDisplay(): TemplateResult {
    return html`
      <div class="text-center mb-6 bg-black/30 p-2.5 rounded">
        <h3 class="text-xl font-semibold text-white mb-3">
          ${translateText("win_modal.join_discord")}
        </h3>
        <p class="text-white mb-3">
          ${translateText("win_modal.discord_description")}
        </p>
        <a
          href="https://discord.com/invite/openfront"
          target="_blank"
          rel="noopener noreferrer"
          class="inline-block px-6 py-3 bg-indigo-600 text-white rounded font-semibold transition-all duration-200 hover:bg-indigo-700 hover:-translate-y-px no-underline"
        >
          ${translateText("win_modal.join_server")}
        </a>
      </div>
    `;
  }

  async show() {
    await this.loadPatternContent();
    this.isVisible = true;
    this.requestUpdate();
    setTimeout(() => {
      this.showButtons = true;
      this.requestUpdate();
    }, 3000);
  }

  hide() {
    this.isVisible = false;
    this.showButtons = false;
    this.requestUpdate();
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
          this.isWin = true;
          crazyGamesSDK.happytime();
        } else {
          this._title = translateText("win_modal.other_team", {
            team: wu.winner[1],
          });
          this.isWin = false;
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
          this.isWin = true;
          crazyGamesSDK.happytime();
        } else {
          this._title = translateText("win_modal.other_won", {
            player: winner.name(),
          });
          this.isWin = false;
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
