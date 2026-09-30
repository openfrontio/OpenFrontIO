import { html, LitElement, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  DESKTOP_TUTORIAL_VIDEO_URL,
  getGamesPlayed,
  homeHref,
  isInIframe,
  translateText,
  TUTORIAL_VIDEO_URL,
} from "../../../client/Utils";
import { Pattern } from "../../../core/CosmeticSchemas";
import { EventBus } from "../../../core/EventBus";
import { RankedType } from "../../../core/game/Game";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { hasLinkedIdentity } from "../../AccountIdentity";
import { getUserMe } from "../../Api";
import "../../components/CosmeticCard";
import { cosmeticSelectionLabel } from "../../components/CosmeticPresentation";
import "../../components/GameXpPanel";
import type { GameXpPanelState } from "../../components/GameXpPanel";
import "../../components/PurchaseButton";
import "../../components/SteamWishlist";
import { Controller } from "../../Controller";
import {
  fetchCosmetics,
  purchaseCosmetic,
  resolveCosmetics,
} from "../../Cosmetics";
import { crazyGamesSDK } from "../../CrazyGamesSDK";
import { isDesktopShell } from "../../DesktopShell";
import { Platform } from "../../Platform";
import { fetchProgressionConfig, pollGameXp } from "../../ProgressionApi";
import { PlaySoundEffectEvent } from "../../sound/Sounds";
import { steamSDK } from "../../SteamSDK";
import { SendWinnerEvent } from "../../Transport";
import { GameView } from "../../view";

@customElement("win-modal")
export class WinModal extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;

  private hasShownDeathModal = false;

  @state()
  isVisible = false;

  @state()
  private isWin = false;

  @state()
  private isRankedGame = false;

  @state()
  private patternContent: TemplateResult | null = null;

  // The XP this game earned. Stays hidden unless there is something to say:
  // no progression, a spectator or a replay never see the section at all.
  @state()
  private xpView: GameXpPanelState = { kind: "hidden" };
  // Polling starts once, at the end of the game.
  private xpPolling = false;
  private xpAbort: AbortController | null = null;

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
          ? "fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gray-800/70 p-4 md:p-6 shrink-0 rounded-lg z-[10010] shadow-2xl backdrop-blur-xs text-white w-[min(90vw,700px)] max-w-[90%] max-h-[90dvh] overflow-hidden flex flex-col"
          : "hidden"}"
      >
        <h2 class="m-0 mb-4 text-[26px] text-center text-white shrink-0">
          ${this._title || ""}
        </h2>
        <div class="min-h-0 flex-1 overflow-y-auto pr-0.5">
          <game-xp-panel .view=${this.xpView}></game-xp-panel>
          ${this.innerHtml()}
        </div>
        <!-- Leaving is the quieter action, on the left; staying in the game
             is the main one, on the right. -->
        <div class="mt-4 flex justify-between gap-2.5 shrink-0">
          ${this.actionButton(
            "quiet",
            translateText("win_modal.exit"),
            () => this._handleExit(),
            "exit",
          )}
          ${this.isRankedGame
            ? this.actionButton(
                "main",
                translateText("win_modal.requeue"),
                () => this._handleRequeue(),
                "requeue",
              )
            : null}
          ${this.actionButton(
            "main",
            this.game?.myPlayer()?.isAlive()
              ? translateText("win_modal.keep")
              : translateText("win_modal.spectate"),
            () => this.hide(),
            "keep",
          )}
        </div>
        ${this.renderActionStyles()}
      </div>
    `;
  }

  // The modal's own buttons, textured like the store's tiles and buy buttons:
  // a tinted gradient with a coloured border, and on hover they lift, glow
  // and a light streak sweeps across. "main" is the blue action (keep playing,
  // play again); "quiet" is leaving.
  private actionButton(
    tone: "main" | "quiet",
    label: string,
    onClick: () => void,
    action: string,
  ): TemplateResult {
    return html`<button
      type="button"
      data-win-action=${action}
      class="win-action win-action-${tone} flex-1"
      @click=${onClick}
    >
      <span class="relative">${label}</span>
    </button>`;
  }

  private renderActionStyles(): TemplateResult {
    return html`<style>
      .win-action {
        position: relative;
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 3rem;
        padding: 0.75rem 1rem;
        border-radius: 0.75rem;
        border: 1px solid;
        color: #fff;
        font-weight: 700;
        font-size: 1.0625rem;
        line-height: 1.25;
        letter-spacing: 0.02em;
        cursor: pointer;
        transition:
          transform 200ms ease-out,
          box-shadow 200ms ease-out,
          border-color 200ms ease-out,
          background 200ms ease-out;
      }
      /* The light streak, parked off the left edge until hover. */
      .win-action::after {
        content: "";
        position: absolute;
        top: -20%;
        bottom: -20%;
        left: -60%;
        width: 40%;
        transform: skewX(-20deg);
        background: linear-gradient(
          90deg,
          transparent,
          rgba(255, 255, 255, 0.28),
          transparent
        );
        pointer-events: none;
      }
      /* The streak sweeps across on the way in only; leaving, it snaps back
         out of sight rather than sweeping back across the button. */
      .win-action:hover::after,
      .win-action:focus-visible::after {
        left: 130%;
        transition: left 550ms ease-out;
      }
      .win-action:hover,
      .win-action:focus-visible {
        transform: translateY(-2px);
      }
      .win-action:active {
        transform: translateY(0) scale(0.98);
      }
      .win-action:focus-visible {
        outline: 2px solid #3fa9f5;
        outline-offset: 2px;
      }
      .win-action-main {
        background: linear-gradient(
          to top,
          rgba(0, 132, 209, 0.95) 0%,
          rgba(0, 101, 170, 0.8) 100%
        );
        border-color: rgba(63, 169, 245, 0.55);
      }
      .win-action-main:hover,
      .win-action-main:focus-visible {
        background: linear-gradient(
          to top,
          rgba(29, 150, 230, 1) 0%,
          rgba(0, 120, 200, 0.9) 100%
        );
        border-color: rgba(125, 200, 255, 0.9);
        box-shadow: 0 0 20px rgba(63, 169, 245, 0.55);
      }
      .win-action-quiet {
        background: linear-gradient(
          to top,
          rgba(80, 80, 80, 0.55) 0%,
          rgba(15, 15, 20, 0.85) 100%
        );
        border-color: rgba(255, 255, 255, 0.15);
      }
      .win-action-quiet:hover,
      .win-action-quiet:focus-visible {
        background: linear-gradient(
          to top,
          rgba(110, 110, 120, 0.6) 0%,
          rgba(25, 25, 32, 0.9) 100%
        );
        border-color: rgba(255, 255, 255, 0.35);
        box-shadow: 0 0 14px rgba(255, 255, 255, 0.25);
      }
      @media (prefers-reduced-motion: reduce) {
        .win-action,
        .win-action::after {
          transition: none;
        }
        .win-action:hover,
        .win-action:focus-visible,
        .win-action:active {
          transform: none;
        }
      }
    </style>`;
  }

  innerHtml() {
    // The Steam desktop build has nothing to wishlist — fall through to the
    // other promos so the box is never empty.
    const canWishlist = !steamSDK.isOnSteam();

    if (isInIframe()) {
      return canWishlist ? this.steamWishlist() : this.discordDisplay();
    }

    if (!this.isWin && getGamesPlayed() < 3) {
      return this.renderYoutubeTutorial();
    }
    if (this.rand < 0.25 && canWishlist) {
      return this.steamWishlist();
    } else if (this.rand < 0.5) {
      return this.discordDisplay();
    } else {
      return this.renderPatternButton();
    }
  }

  renderYoutubeTutorial() {
    return html`
      <div class="text-center mb-6 bg-black/30 p-2.5 rounded-sm">
        <h3 class="text-xl font-semibold text-white mb-3">
          ${translateText("win_modal.youtube_tutorial")}
        </h3>
        <!-- 56.25% = 9:16 -->
        <div class="relative w-full pb-[56.25%]">
          ${Platform.isElectron
            ? html`<video
                class="absolute top-0 left-0 w-full h-full rounded-sm"
                src="${this.isVisible ? DESKTOP_TUTORIAL_VIDEO_URL : ""}"
                controls
                preload="metadata"
              ></video>`
            : html`<iframe
                class="absolute top-0 left-0 w-full h-full rounded-sm"
                src="${this.isVisible ? TUTORIAL_VIDEO_URL : ""}"
                title="YouTube video player"
                frameborder="0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowfullscreen
              ></iframe>`}
        </div>
      </div>
    `;
  }

  renderPatternButton() {
    return html`
      <div class="text-center mb-6 bg-black/30 p-2.5 rounded-sm">
        <h3 class="text-xl font-semibold text-white mb-3">
          ${translateText("win_modal.support_openfront")}
        </h3>
        ${isDesktopShell()
          ? null
          : html`<p class="text-white mb-3">
              ${translateText("win_modal.territory_pattern")}
            </p>`}
        <div
          class="mx-auto w-full overflow-x-auto overflow-y-visible rounded-sm"
        >
          <div
            class="flex min-w-max items-start justify-center gap-4 px-1 py-1"
          >
            ${this.patternContent}
          </div>
        </div>
      </div>
    `;
  }

  async loadPatternContent() {
    const me = await getUserMe();
    const cosmetics = await fetchCosmetics();

    const purchasable = resolveCosmetics(cosmetics, me, null).filter(
      (r) => r.type === "pattern" && r.relationship === "purchasable",
    );

    if (purchasable.length === 0) {
      this.patternContent = html``;
      return;
    }

    // Shuffle the array and take patterns. Will always be 3 wide to allow scrolling
    const shuffled = [...purchasable].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, Math.min(3, shuffled.length));

    this.patternContent = html`
      <div class="flex gap-4 flex-nowrap justify-start items-start">
        ${selected.map((resolved) => {
          // Only patterns were selected above.
          const pattern = resolved.cosmetic as Pattern | null;
          return html`
            <div data-win-cosmetic-promo class="flex w-40 flex-col gap-2">
              <cosmetic-card
                .resolved=${resolved}
                .interactive=${false}
              ></cosmetic-card>
              <purchase-button
                .priceHard=${pattern?.priceHard ?? null}
                .priceSoft=${pattern?.priceSoft ?? null}
                .rarity=${pattern?.rarity ?? "common"}
                .itemName=${cosmeticSelectionLabel(resolved)}
                .onPurchaseHard=${() => purchaseCosmetic(resolved, "hard")}
                .onPurchaseSoft=${() => purchaseCosmetic(resolved, "soft")}
              ></purchase-button>
            </div>
          `;
        })}
      </div>
    `;
  }

  steamWishlist(): TemplateResult {
    return html`
      <div class="text-center mb-6 bg-black/30 p-2.5 rounded-sm">
        <h3 class="text-xl font-semibold text-white mb-3">
          ${translateText("steam_wishlist.buy_on_steam")}
        </h3>
        <steam-wishlist
          campaign="win_modal"
          .active=${this.isVisible}
        ></steam-wishlist>
      </div>
    `;
  }

  discordDisplay(): TemplateResult {
    return html`
      <div class="text-center mb-6 bg-black/30 p-2.5 rounded-sm">
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
          class="inline-block px-6 py-3 bg-indigo-600 text-white rounded-sm font-semibold transition-all duration-200 hover:bg-indigo-700 hover:-translate-y-px no-underline"
        >
          ${translateText("win_modal.join_server")}
        </a>
      </div>
    `;
  }

  async show() {
    crazyGamesSDK.gameplayStop();
    this.isRankedGame =
      this.game.config().gameConfig().rankedType !== undefined;
    this.isVisible = true;
    this.requestUpdate();
    try {
      await this.loadPatternContent();
    } catch (error) {
      console.warn("Failed to load win modal cosmetics", error);
      return;
    }
    this.requestUpdate();
  }

  hide() {
    this.isVisible = false;
    this.requestUpdate();
  }

  disconnectedCallback(): void {
    this.xpAbort?.abort();
    super.disconnectedCallback();
  }

  /**
   * Fills the XP section. `gameOver` is false when the player died while the
   * game carries on: the server only awards XP once the game is archived, so
   * that just says so, and the poll starts when the game really ends.
   */
  private async updateXp(gameOver: boolean): Promise<void> {
    if (this.xpPolling) return;
    try {
      const game = this.game;
      // Spectators and replay viewers have no XP of their own.
      if (game.config().isReplay() || !game.myPlayer()) return;
      const me = await getUserMe();
      if (!(await this.isSignedIn(me))) {
        // Only pitch XP when progression is actually on. There is no
        // /users/@me progress to go by here, so ask the public config (404
        // when progression is off; any failure also says nothing).
        const config = await fetchProgressionConfig();
        if (config === false || this.xpPolling) return;
        this.xpView = { kind: "signed_out" };
        return;
      }
      // /users/@me carries progress whenever progression is on (level 1
      // before a first scored game); absent means off: no section at all.
      if (!me || me.player.progress === undefined) return;
      // The game may have ended while this was resolving; the end-of-game
      // call owns the section from then on.
      if (this.xpPolling) return;
      if (!gameOver) {
        this.xpView = { kind: "awaiting_end" };
        return;
      }
      this.xpPolling = true;
      this.xpView = { kind: "calculating" };
      this.xpAbort = new AbortController();
      const result = await pollGameXp(game.gameID(), {
        signal: this.xpAbort.signal,
      });
      // Timed out, signed out or unreadable: hide rather than show an error
      // (or, worse, a zero).
      this.xpView =
        result === null ? { kind: "hidden" } : { kind: "result", data: result };
    } catch (err) {
      console.warn("WinModal: XP section failed", err);
      this.xpView = { kind: "hidden" };
    }
  }

  // Same rule as the account modal: a linked identity, or a CrazyGames
  // profile whose token exchange produced a session.
  private async isSignedIn(
    me: Awaited<ReturnType<typeof getUserMe>> | null,
  ): Promise<boolean> {
    if (!me) return false;
    if (hasLinkedIdentity(me.user)) return true;
    if (!crazyGamesSDK.isOnCrazyGames?.()) return false;
    return (await crazyGamesSDK.getUserProfile()) !== null;
  }

  private _handleExit() {
    this.hide();
    window.location.href = homeHref();
  }

  private _handleRequeue() {
    this.hide();
    // Requeue for the same mode; Main owns the mechanism (currently a
    // reload with the requeue param, which reopens the queue after the
    // page teardown).
    document.dispatchEvent(
      new CustomEvent("matchmaking-requeue", {
        detail: {
          mode:
            this.game.config().gameConfig().rankedType === RankedType.TwoVTwo
              ? ("2v2" as const)
              : ("1v1" as const),
        },
      }),
    );
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
      this.eventBus.emit(new PlaySoundEffectEvent("defeat"));
      void this.updateXp(false);
      this.show();
    }
    const updates = this.game.updatesSinceLastTick();
    const winUpdates = updates?.[GameUpdateType.Win] ?? [];
    if (winUpdates.length > 0) void this.updateXp(true);
    winUpdates.forEach((wu) => {
      if (wu.winner === undefined) {
        // Match cancelled (e.g. a ranked 2v2 that didn't fill or fully
        // spawn): the game ends with no winner. Still vote the result to the
        // server so the record is archived winnerless (never ranked).
        this.eventBus.emit(new SendWinnerEvent(undefined, wu.allPlayersStats));
        this._title = translateText("win_modal.match_cancelled");
        this.isWin = false;
        history.replaceState(null, "", `${window.location.pathname}?replay`);
        this.show();
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
        this.playEndOfGameSound();
        history.replaceState(null, "", `${window.location.pathname}?replay`);
        this.show();
      } else if (wu.winner[0] === "nation") {
        this.eventBus.emit(new SendWinnerEvent(wu.winner, wu.allPlayersStats));
        this._title = translateText("win_modal.nation_won", {
          nation: wu.winner[1],
        });
        this.isWin = false;
        this.playEndOfGameSound();
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
            player: winner.displayName(),
          });
          this.isWin = false;
        }
        this.playEndOfGameSound();
        history.replaceState(null, "", `${window.location.pathname}?replay`);
        this.show();
      }
    });
  }

  private playEndOfGameSound(): void {
    if (this.isWin) {
      this.eventBus.emit(new PlaySoundEffectEvent("victory"));
    } else if (!this.hasShownDeathModal && this.game.myPlayer()?.hasSpawned()) {
      // Spawned check: spectators and replay viewers shouldn't get a
      // personal defeat sting. The cue also already played if the player
      // died earlier (hasShownDeathModal).
      this.eventBus.emit(new PlaySoundEffectEvent("defeat"));
    }
  }
}
