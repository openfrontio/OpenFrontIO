import { GameType, RankedType } from "@openfront/engine-api/game/GameTypes";
import { GameUpdateType } from "@openfront/engine-api/game/GameUpdates";
import type { AllPlayersStats, Winner } from "@openfront/engine-api/Schemas";
import type { GameXpEligible, Progress } from "@openfront/shared/ApiSchemas";
import { Pattern } from "@openfront/shared/CosmeticSchemas";
import { EventBus } from "@openfront/shared/EventBus";
import { html, LitElement, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  DESKTOP_TUTORIAL_VIDEO_URL,
  getGamesPlayed,
  getTranslatedPlayerTeamLabel,
  homeHref,
  isInIframe,
  translateText,
  TUTORIAL_VIDEO_URL,
} from "../../../client/Utils";
import { fetchUserMeUncached, getUserMe, invalidateUserMe } from "../../Api";
import "../../components/CosmeticCard";
import { cosmeticSelectionLabel } from "../../components/CosmeticPresentation";
import type { GameXpPanelState } from "../../components/GameXpPanel";
import type { LegendCeremony } from "../../components/LegendCeremony";
import "../../components/ProfileShare";
import "../../components/PurchaseButton";
import "../../components/SteamWishlist";
import { Controller } from "../../Controller";
import {
  fetchCosmetics,
  purchaseCosmetic,
  resolveCosmetics,
} from "../../Cosmetics";
import { isDesktopShell } from "../../DesktopShell";
import { gamePortal } from "../../GamePortal";
import {
  gameShareMoment,
  momentShareLabel,
  momentShareText,
  momentShareUrl,
} from "../../MomentShare";
import { Platform } from "../../Platform";
import { MAX_PRESTIGE, reachedLegendThisGame } from "../../Progression";
import { resolveXpAccount } from "../../ProgressionAccount";
import { fetchProgressionConfig, pollGameXp } from "../../ProgressionApi";
import {
  applyGameXp,
  firstGameXp,
  type PendingGameKind,
  recordPendingXp,
  withPendingXp,
} from "../../ProvisionalProgress";
import {
  loadProvisionalXp,
  type ProvisionalXp,
  provisionalXpRules,
  reconcileXp,
} from "../../ProvisionalXpAtDeath";
import { PlaySoundEffectEvent } from "../../sound/Sounds";
import { steamSDK } from "../../SteamSDK";
import { SendWinnerEvent } from "../../Transport";
import { GameView } from "../../view";

type LegendCeremonyModule = typeof import("../../components/LegendCeremony");

// What the end-of-game provisional figure is worked out from: the result and
// the stats this client votes to the server, which the archived record holds.
interface GameEndUpdate {
  winner: Winner;
  allPlayersStats: AllPlayersStats;
  // The tick the Win update came on: the figure counts time played up to it,
  // not up to the later moment the worker's snapshot is taken.
  tick: number;
}

// How long the end of the game waits on its provisional figure before the
// section says the XP is being calculated meanwhile. Normally it takes a
// moment (one ask of the worker), and a flash of "calculating" before the
// reveal would only be noise.
const END_PROVISIONAL_GRACE_MS = 500;

// The XP section stays out of the startup bundle: it's fetched when a game
// starts (see init), long before the game ends, so the reveal never waits on
// it. Should it still be on its way, the section shows the moment it lands.
let xpPanelModule: Promise<unknown> | null = null;
function loadGameXpPanel(): void {
  xpPanelModule ??= import("../../components/GameXpPanel").catch(
    (err: unknown) => {
      // Tried again at the end of the game, or the next one.
      xpPanelModule = null;
      console.warn("WinModal: XP section failed to load", err);
    },
  );
}

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
  // The XP result the panel has finished revealing (or skipped to the end
  // of): the share button waits for it.
  @state()
  private xpSettled: GameXpPanelState | null = null;
  // The signed-in player's public ID, for the share link. Empty when signed
  // out (or unknown): no share button.
  @state()
  private sharePublicId = "";
  // The provisional figure shown at death (or, for a player still in the
  // game, at its end), if any: the server's figure is compared with it.
  private provisionalXp: ProvisionalXp | null = null;
  // The game's result, from its Win update: a player still in the game at
  // the end gets a provisional figure worked out from it.
  private gameEnd: GameEndUpdate | null = null;
  // A Win update has come: anything read of the account from now on may
  // already count this game.
  private gameOverSeen = false;
  // The account's progress as read while the game was on (init): what a
  // figure from the end starts from, and is kept as not including.
  private startAccount: { publicId: string; progress: Progress } | null = null;
  // A detach cut the end-of-game poll short; re-attaching restarts it (the
  // Win update that started it is delivered only once).
  private xpPollAborted = false;
  // Whose XP the section shows: the Legend ceremony plays once per account.
  private xpPublicId: string | null = null;
  // The Legend ceremony, fetched only for a player who could become a Legend
  // (see preloadLegendCeremony); null until it has arrived.
  private legendCeremony: LegendCeremonyModule | null = null;
  private legendCeremonyLoad: Promise<void> | null = null;
  // Replaceable for tests.
  loadLegendCeremony: () => Promise<LegendCeremonyModule> = () =>
    import("../../components/LegendCeremony");

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
        class="${
          this.isVisible
            ? "fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gray-800/70 p-4 md:p-6 shrink-0 rounded-lg z-[10010] shadow-2xl backdrop-blur-xs text-white w-[min(90vw,700px)] max-w-[90%] max-h-[90dvh] overflow-hidden flex flex-col"
            : "hidden"
        }"
      >
        <h2 class="m-0 mb-4 text-[26px] text-center text-white shrink-0">
          ${this._title || ""}
        </h2>
        <div class="min-h-0 flex-1 overflow-y-auto pr-0.5">
          <game-xp-panel
            .view=${this.xpView}
            .onScreen=${this.isVisible}
            @xp-reveal-settled=${(e: CustomEvent<GameXpPanelState>) =>
              (this.xpSettled = e.detail)}
            .gameType=${this.game?.config().gameConfig().gameType ?? null}
            @xp-legend=${this.onXpLegend}
          ></game-xp-panel>
          ${this.innerHtml()}
        </div>
        <!-- Leaving is the quieter action, on the left; staying in the game
             is the main one, on the right. Sharing a milestone sits between
             them, or on its own row above where three don't fit. -->
        <div class="mt-4 flex flex-wrap justify-between gap-2.5 shrink-0">
          ${this.actionButton(
            "quiet",
            translateText("win_modal.exit"),
            () => this._handleExit(),
            "exit",
          )}
          ${this.renderShare()}
          ${
            this.isRankedGame
              ? this.actionButton(
                  "main",
                  translateText("win_modal.requeue"),
                  () => this._handleRequeue(),
                  "requeue",
                )
              : null
          }
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
      <legend-ceremony
        @legend-ceremony-closed=${this.onLegendCeremonyClosed}
      ></legend-ceremony>
    `;
  }

  // The server's result for this game made the player a Legend: the moment
  // gets the whole screen, the first time on this account. The XP section
  // rests on its final state behind it, so Continue comes back to the
  // settled popup. Should the ceremony not have arrived (a slow or failed
  // fetch), the XP section plays its own Legend moment instead.
  private onXpLegend = (e: CustomEvent<GameXpEligible>): void => {
    const publicId = this.xpPublicId;
    const legend = this.legendCeremony;
    if (publicId === null || legend === null) return;
    if (legend.legendCeremonySeen(publicId)) return;
    const ceremony = this.querySelector<LegendCeremony>("legend-ceremony");
    if (ceremony === null) return;
    e.preventDefault();
    legend.markLegendCeremonySeen(publicId);
    ceremony.show({
      lifetimeXp: e.detail.after.lifetimeXp,
      at: new Date(),
      publicId,
    });
  };

  // Fetches the Legend ceremony ahead of its moment: once the account is
  // known to be on its last prestige run, and again (should that have missed
  // it) as soon as the server's result says this game made a Legend, while
  // the reveal is still climbing to level 100.
  private preloadLegendCeremony(): void {
    if (this.legendCeremonyLoad !== null) return;
    this.legendCeremonyLoad = this.loadLegendCeremony().then(
      (module) => {
        this.legendCeremony = module;
      },
      (err: unknown) => {
        this.legendCeremonyLoad = null;
        console.warn("WinModal: Legend ceremony failed to load", err);
      },
    );
  }

  // The first of those: where the last run is comes from the config, as the
  // server may move it, and from the client's own constant only without one.
  private async preloadIfLastRun(prestige: number): Promise<void> {
    const config = await fetchProgressionConfig();
    const last =
      config !== false && config.maxPrestige > 0
        ? config.maxPrestige
        : MAX_PRESTIGE;
    if (prestige >= last) this.preloadLegendCeremony();
  }

  private onLegendCeremonyClosed = (): void => {
    this.querySelector<HTMLElement>('[data-win-action="keep"]')?.focus();
  };

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

  // Sharing a milestone or becoming a Legend, once the reveal has shown it.
  // Only for the server's result (gameShareMoment), and only for a signed-in
  // player with a profile to link to.
  private renderShare(): TemplateResult | null {
    if (this.sharePublicId === "" || this.xpSettled !== this.xpView) {
      return null;
    }
    const moment = gameShareMoment(this.xpView);
    if (moment === null || moment.kind === "prestige") return null;
    const url = momentShareUrl(this.sharePublicId, moment);
    if (url === null) return null;
    // Three labelled buttons fit side by side from md up; below that (and
    // beside a ranked game's requeue button) it takes a row of its own.
    const placement = this.isRankedGame
      ? "order-first basis-full"
      : "order-first basis-full md:order-none md:basis-0 md:flex-1";
    return html`<profile-share
      data-win-share
      class="flex ${placement}"
      layout="menu"
      .label=${momentShareLabel(moment)}
      .url=${url}
      .text=${momentShareText(moment)}
      triggerClass="win-action win-action-quiet w-full"
    ></profile-share>`;
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
      /* The share menu's flash ring sits in the trigger's wrapper so it isn't
         clipped by .win-action's overflow:hidden. When the button translates up
         on hover/focus, keep the ring centered around it. */
      [data-share-ring] {
        transition:
          top 200ms ease-out,
          bottom 200ms ease-out;
      }
      .win-action:hover ~ [data-share-ring],
      .win-action:focus-visible ~ [data-share-ring] {
        top: -6px;
        bottom: -2px;
      }
      .win-action:active ~ [data-share-ring] {
        top: -4px;
        bottom: -4px;
      }
      @media (prefers-reduced-motion: reduce) {
        .win-action,
        .win-action::after,
        [data-share-ring] {
          transition: none;
        }
        .win-action:hover,
        .win-action:focus-visible,
        .win-action:active {
          transform: none;
        }
        .win-action:hover ~ [data-share-ring],
        .win-action:focus-visible ~ [data-share-ring],
        .win-action:active ~ [data-share-ring] {
          top: -4px;
          bottom: -4px;
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
          ${
            Platform.isElectron
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
                ></iframe>`
          }
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
        ${
          isDesktopShell()
            ? null
            : html`<p class="text-white mb-3">
                ${translateText("win_modal.territory_pattern")}
              </p>`
        }
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
    gamePortal.gameplayStop();
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

  connectedCallback(): void {
    super.connectedCallback();
    if (this.xpPollAborted) {
      this.xpPollAborted = false;
      void this.updateXp(true);
    }
  }

  disconnectedCallback(): void {
    this.xpAbort?.abort();
    super.disconnectedCallback();
  }

  /**
   * Fills the XP section. `gameOver` is false when the player died while the
   * game carries on: the server only awards XP once the game is archived, so
   * that shows a provisional figure worked out here (or, when there can't be
   * one, says XP comes at the end), and the poll starts when the game really
   * ends. A player without a figure by then (still in the game, mostly) gets
   * one from the finished game while the poll runs.
   */
  private async updateXp(gameOver: boolean): Promise<void> {
    if (this.xpPolling) return;
    // Normally here since the game started; tried again should that fetch
    // have failed.
    loadGameXpPanel();
    try {
      const game = this.game;
      // Spectators and replay viewers have no XP of their own, and a game
      // resumed from a save earns none.
      if (
        game.config().isReplay() ||
        !game.myPlayer() ||
        game.resumedFromSave()
      ) {
        return;
      }
      const account = await resolveXpAccount();
      // /users/@me failed while there is a session: a signed-in player must
      // not be told to sign in over a network blip, so say nothing.
      if (account.kind === "unknown") return;
      if (account.kind === "signed_out") {
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
      const progress = account.me.player.progress;
      if (progress === undefined) return;
      this.sharePublicId = account.me.player.publicId;
      this.xpPublicId = account.me.player.publicId ?? null;
      if (!progress.legend) void this.preloadIfLastRun(progress.prestige);
      // The game may have ended while this was resolving; the end-of-game
      // call owns the section from then on.
      if (this.xpPolling) return;
      if (!gameOver) {
        const loaded = await this.loadProvisionalXp(progress, null);
        if (this.xpPolling) return;
        if (loaded === null) {
          this.xpView = { kind: "awaiting_end" };
          return;
        }
        const { provisional } = loaded;
        this.provisionalXp = provisional;
        this.xpView = { kind: "provisional", provisional, confirming: false };
        this.keepPendingXp(provisional, loaded.notIn);
        return;
      }
      this.xpPolling = true;
      const abort = new AbortController();
      this.xpAbort = abort;
      // Asked at once; scoring can take a while (the server may replay the
      // game to settle its winner).
      const poll = pollGameXp(game.gameID(), { signal: abort.signal });
      let provisional = this.provisionalXp;
      const end = this.gameEnd;
      if (provisional === null && end !== null) {
        // No figure from a death (the player is still in the game, or had
        // none): one from the finished game, the win included, unless the
        // server answers first. Should it be slow to work out, the section
        // says the XP is being calculated meanwhile.
        const slow = setTimeout(() => {
          this.xpView = { kind: "calculating" };
        }, END_PROVISIONAL_GRACE_MS);
        // Its own signal, so a server that answers first stops the leftover
        // worker calls; a detach stops them too.
        const loadAbort = new AbortController();
        const stopLoad = () => loadAbort.abort();
        abort.signal.addEventListener("abort", stopLoad, { once: true });
        const loaded = await Promise.race([
          this.loadProvisionalXp(progress, end, loadAbort.signal).catch(
            (err: unknown) => {
              console.warn("WinModal: no provisional XP at the end", err);
              return null;
            },
          ),
          // Only the server's figure beats this one. A poll that gives up
          // (timed out, unavailable) leaves it to come: it then stays up,
          // provisional, and kept for the account menu.
          poll.then((result) =>
            result === null ? new Promise<never>(() => {}) : null,
          ),
        ]);
        clearTimeout(slow);
        loadAbort.abort();
        abort.signal.removeEventListener("abort", stopLoad);
        if (loaded !== null && !abort.signal.aborted) {
          provisional = loaded.provisional;
          this.provisionalXp = provisional;
          this.keepPendingXp(provisional, loaded.notIn);
        }
      }
      // A provisional figure stays up while the server's is fetched.
      this.xpView =
        provisional === null
          ? { kind: "calculating" }
          : { kind: "provisional", provisional, confirming: true };
      const result = await poll;
      // Detached mid-poll: leave the section be (a provisional figure stays
      // up, still confirming) and poll again on re-attach (right away if that
      // happened while this poll was winding down).
      if (abort.signal.aborted) {
        this.xpPolling = false;
        if (this.isConnected) void this.updateXp(true);
        else this.xpPollAborted = true;
        return;
      }
      // Scored: the figure kept for the account menu and profile is done.
      if (result !== null && this.xpPublicId !== null) {
        applyGameXp(
          this.xpPublicId,
          result,
          this.pendingAbout(progress.daily?.day),
        );
      }
      if (result?.eligible && reachedLegendThisGame(result)) {
        this.preloadLegendCeremony();
      }
      if (result === null) {
        // Timed out, signed out or unreadable: hide rather than show an error
        // (or, worse, a zero). A provisional figure stays, still provisional.
        this.xpView =
          provisional === null
            ? { kind: "hidden" }
            : { kind: "provisional", provisional, confirming: false };
        return;
      }
      // A game that unlocked cosmetics changed what the player owns: the
      // Locker (and everything else reading /users/@me) refetches.
      if (result.eligible && (result.flares ?? []).length > 0) {
        invalidateUserMe();
      }
      if (provisional === null) {
        this.xpView = { kind: "result", data: result };
        return;
      }
      const outcome = reconcileXp(provisional.result, result, {
        disconnectedOpponents: provisional.inputs.disconnectedOpponents,
        atGameEnd: provisional.inputs.atGameEnd,
        shown: provisional.response,
      });
      if (outcome.drift) {
        // Not explained by what only the end of the game adds: the client's
        // copy of the formula may have drifted from the server's.
        console.warn("Provisional XP differed from the server's", {
          gameId: result.gameId,
          provisional: outcome.provisionalTotal,
          server: result.eligible ? result.breakdown.total : null,
          provisionalResult: provisional.result,
          serverResult: result.eligible
            ? result.breakdown
            : { reason: result.reason },
          inputs: provisional.inputs,
        });
      }
      this.xpView = {
        kind: "result",
        data: result,
        reconciled: { provisional, outcome },
      };
    } catch (err) {
      console.warn("WinModal: XP section failed", err);
      this.xpView = { kind: "hidden" };
    }
  }

  // Keeps an eligible provisional figure for the account, so the account
  // menu, the Account modal and the profile show it (provisionally) until the
  // API scores the game (ProvisionalProgress.ts). `notIn` is the lifetime XP
  // of the account it was worked out from, read before the game ended, so
  // the game can't be in it.
  // Nothing is asked of the API here: at death the game is still running,
  // and at the end the poll already is; the account menu's poll picks it up
  // should neither get an answer.
  private keepPendingXp(provisional: ProvisionalXp, notIn: number): void {
    const response = provisional.response;
    if (this.xpPublicId === null || !response.eligible) return;
    recordPendingXp(this.xpPublicId, {
      ...this.pendingAbout(provisional.inputs.dailyDay ?? undefined),
      gameId: response.gameId,
      xp: response.breakdown.total,
      firstGame: firstGameXp(response.breakdown),
      notIn,
    });
  }

  // This game's kind and the API's day stamp, for the day's allowances.
  private pendingAbout(day: string | undefined): {
    day?: string;
    kind?: PendingGameKind;
  } {
    const kinds: Partial<Record<GameType, PendingGameKind>> = {
      [GameType.Public]: "public",
      [GameType.Private]: "private",
      [GameType.Singleplayer]: "singleplayer",
    };
    return { day, kind: kinds[this.game.config().gameConfig().gameType] };
  }

  // The provisional XP figure for a player who has just died, or with `end`
  // for one at the end of the game, and the lifetime XP of the account it
  // was worked out from; null when there can't be one (see
  // loadProvisionalXp).
  private async loadProvisionalXp(
    progress: Progress,
    end: GameEndUpdate | null,
    signal?: AbortSignal,
  ): Promise<{ provisional: ProvisionalXp; notIn: number } | null> {
    const progression = await fetchProgressionConfig();
    if (progression === false || provisionalXpRules(progression) === null) {
      return null;
    }
    if (signal?.aborted) return null;
    const game = this.game;
    const myClientID = game.myClientID();
    if (myClientID === undefined) return null;
    // A provisional figure starts from where the player is now, and counts
    // today's allowances as they are now: at death, ask /users/@me afresh
    // (the page's copy is from when the game started, and a game left
    // earlier may have been scored since). Past the page's cache, so a failed
    // ask can't cost the game-end figure its copy; the page's progress stands
    // in for it. At the end, the account as read while the game was on
    // (captureStartProgress): any read since could already have this game
    // in it, should the server score it that quickly, and the page's copy
    // may have been refetched since (an earlier game scored, a new session).
    // Only without that, the page's copy. Games left earlier are counted
    // below.
    let confirmed = progress;
    if (end === null) {
      const fresh = await fetchUserMeUncached();
      if (fresh !== false && fresh.player.progress !== undefined) {
        confirmed = fresh.player.progress;
      }
    } else if (
      this.startAccount !== null &&
      this.startAccount.publicId === this.xpPublicId
    ) {
      confirmed = this.startAccount.progress;
    }
    // Games left earlier and not scored yet stack underneath this one: it
    // starts from where their provisional XP took the player, and from the
    // day's allowances they used (ProvisionalProgress.ts). Nothing is asked:
    // the stored answers decide.
    const start =
      this.xpPublicId === null
        ? confirmed
        : withPendingXp(this.xpPublicId, confirmed, progression, game.gameID());
    const provisional = await loadProvisionalXp({
      gameId: game.gameID(),
      myClientID,
      config: game.config().gameConfig(),
      progress: start,
      progression,
      end: end === null ? undefined : { winner: end.winner },
      // At the end, the stats this client voted (the Win update's): the
      // record the server scores, on the tick the game ended. Only who is
      // disconnected is asked of the worker, without copying every player's
      // stats again.
      humanStats:
        end === null
          ? () => game.worker.humanStats()
          : async () => ({
              disconnectedAt: (await game.worker.humanDisconnects())
                .disconnectedAt,
              stats: end.allPlayersStats,
              tick: end.tick,
            }),
      signal,
    });
    return provisional === null
      ? null
      : { provisional, notIn: confirmed.lifetimeXp };
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
    const rankedType = this.game.config().gameConfig().rankedType;
    document.dispatchEvent(
      new CustomEvent("matchmaking-requeue", {
        detail: {
          mode:
            rankedType === RankedType.TwoVTwo
              ? ("2v2" as const)
              : rankedType === RankedType.FreeForAll
                ? ("ffa" as const)
                : rankedType === RankedType.ClanWars
                  ? ("clanwars" as const)
                  : ("1v1" as const),
        },
      }),
    );
  }

  init() {
    if (this.game.config().isReplay()) return;
    loadGameXpPanel();
    void this.captureStartProgress();
  }

  // Reads the account's progress, and today's allowances, while the game is
  // on: it can't include this game yet. Nothing is kept should the answer
  // only come once the game is over.
  private async captureStartProgress(): Promise<void> {
    try {
      const account = await resolveXpAccount();
      if (account.kind !== "signed_in" || this.gameOverSeen) return;
      const { publicId, progress } = account.me.player;
      if (!publicId || progress === undefined) return;
      this.startAccount = { publicId, progress };
    } catch (err) {
      console.warn("WinModal: no account read at the start", err);
    }
  }

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
    if (winUpdates.length > 0) this.gameOverSeen = true;
    // Votes the result to the server. The result voted is what a figure from
    // the end is worked out from: a Win update this client doesn't vote
    // gives none.
    const vote = (winner: Winner, allPlayersStats: AllPlayersStats) => {
      this.eventBus.emit(new SendWinnerEvent(winner, allPlayersStats));
      this.gameEnd ??= { winner, allPlayersStats, tick: this.game.ticks() };
    };
    winUpdates.forEach((wu) => {
      if (wu.winner === undefined) {
        // Match cancelled (e.g. a ranked 2v2 that didn't fill or fully
        // spawn): the game ends with no winner. Still vote the result to the
        // server so the record is archived winnerless (never ranked).
        vote(undefined, wu.allPlayersStats);
        this._title = translateText("win_modal.match_cancelled");
        this.isWin = false;
        history.replaceState(null, "", `${window.location.pathname}?replay`);
        this.show();
      } else if (wu.winner[0] === "team") {
        vote(wu.winner, wu.allPlayersStats);
        if (wu.winner[1] === this.game.myPlayer()?.team()) {
          this._title = translateText("win_modal.your_team");
          this.isWin = true;
          gamePortal.happytime();
        } else {
          this._title = translateText("win_modal.other_team", {
            team: getTranslatedPlayerTeamLabel(wu.winner[1]),
          });
          this.isWin = false;
        }
        this.playEndOfGameSound();
        history.replaceState(null, "", `${window.location.pathname}?replay`);
        this.show();
      } else if (wu.winner[0] === "nation") {
        vote(wu.winner, wu.allPlayersStats);
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
          vote(["player", winnerClient], wu.allPlayersStats);
        }
        if (
          winnerClient !== null &&
          winnerClient === this.game.myPlayer()?.clientID()
        ) {
          this._title = translateText("win_modal.you_won");
          this.isWin = true;
          gamePortal.happytime();
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
    // After the vote, so a figure from the end has what was voted.
    if (winUpdates.length > 0) void this.updateXp(true);
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
