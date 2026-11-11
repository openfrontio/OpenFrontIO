import { GameType } from "@openfront/engine-api/game/GameTypes";
import { GameUpdateType } from "@openfront/engine-api/game/GameUpdates";
import type { AllPlayersStats, Winner } from "@openfront/engine-api/Schemas";
import type { GameXpEligible, Progress } from "@openfront/shared/ApiSchemas";
import { assetUrl } from "@openfront/shared/AssetUrls";
import { Pattern } from "@openfront/shared/CosmeticSchemas";
import { EventBus } from "@openfront/shared/EventBus";
import { html, LitElement, nothing, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  DESKTOP_TUTORIAL_VIDEO_URL,
  formatPercentage,
  getGamesPlayed,
  getTranslatedPlayerTeamLabel,
  homeHref,
  isInIframe,
  renderDuration,
  translateText,
  TUTORIAL_VIDEO_URL,
} from "../../../client/Utils";
import { fetchUserMeUncached, getUserMe, invalidateUserMe } from "../../Api";
import "../../components/CosmeticCard";
import { cosmeticSelectionLabel } from "../../components/CosmeticPresentation";
import "../../components/OfIcon";
import {
  ffaRatingGameOf,
  type FfaRatingGame,
  viewerHasFfaRating,
} from "../../components/ffaRating/FfaRatingEligibility";
import type { GameXpPanelState } from "../../components/GameXpPanel";
import type { LegendCeremony } from "../../components/LegendCeremony";
import type { OfIconName } from "../../components/OfIcon";
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
import { lobbyPublicGameType } from "../../LobbyPublicGameType";
import type { MatchmakingMode } from "../../Matchmaking";
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
import { requeueModeForRankedType } from "../../RequeueUrl";
import { PlaySoundEffectEvent } from "../../sound/Sounds";
import { steamSDK } from "../../SteamSDK";
import { SendWinnerEvent } from "../../Transport";
import { shareGame } from "../../utilities/ShareGame";
import { GameView } from "../../view";
import { endScreenStats, type EndScreenStats } from "../EndScreenStats";
import { HUD_BUTTON_MAIN, HUD_BUTTON_QUIET } from "../HudModal";

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

// The rating panel is only worth its bytes after a rated FFA game: fetched
// when the win screen finds the viewer has a rating to show.
function loadFfaRatingPanel(): Promise<unknown> {
  return import("../../components/ffaRating/FfaRatingPanel");
}

// The glyphs proprietary/fonts/OpenFront.ttf has. A title with any other
// character falls back to the UI font as a whole, never letter by letter.
const DISPLAY_FONT_GLYPHS = /^[ !"$%&'()+,\-.0-9=?@A-Z[\]a-z]*$/;

// The font has no accented letters, so "gagné" is drawn as "gagne"; the
// no-break spaces French puts before "!" and "?" become plain ones.
function foldForDisplayFont(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[\u00A0\u202F]/g, " ");
}

// In OpenFront.ttf "!" and "?" are as tall as the capitals but sit lower, by
// 80 and 33 units of 1000, so each is raised by that much to line up. A
// translate, not `top`: layout rounds `top` to whole pixels, the text is not.
const RAISED_GLYPHS: Record<string, string> = {
  "!": "inline-block -translate-y-[0.08em]",
  "?": "inline-block -translate-y-[0.033em]",
};

function raisePunctuation(text: string): (string | TemplateResult)[] {
  return text
    .split(/([!?])/)
    .map((part) =>
      part in RAISED_GLYPHS
        ? html`<span class=${RAISED_GLYPHS[part]}>${part}</span>`
        : part,
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

  // The queue to rejoin from "Play Again"; null when the game has none (an
  // unranked game, or a ranked FFA game, which has no queue any more).
  @state()
  private requeueMode: MatchmakingMode | null = null;

  @state()
  private patternContent: TemplateResult | null = null;

  // The XP this game earned. Stays hidden unless there is something to say:
  // no progression, a spectator or a replay never see the section at all.
  @state()
  private xpView: GameXpPanelState = { kind: "hidden" };
  // The FFA rating this game may have changed; null shows no panel.
  @state()
  private ffaRating: FfaRatingGame | null = null;
  // Decided once per game.
  private ffaRatingChecked = false;
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
  // A fixed headline ("You Won!"), as opposed to a title with a name in it:
  // only a headline may be drawn in the pixel font.
  private titleIsHeadline = false;

  // Time, land and rank, worked out when the screen opens. A player who died
  // keeps the figures from their death when the game ends later.
  @state()
  private stats: EndScreenStats | null = null;
  private statsAtDeath: EndScreenStats | null = null;

  private rand = Math.random();

  // Override to prevent shadow DOM creation
  createRenderRoot() {
    return this;
  }

  constructor() {
    super();
  }

  render() {
    // No scrim: the map stays visible and clickable around the dialog.
    return html`
      <div
        class="${
          this.isVisible
            ? "pointer-events-none fixed inset-0 z-[10010] grid place-items-center p-3"
            : "hidden"
        }"
      >
        <div
          role="dialog"
          aria-labelledby="win-modal-title"
          class="hud-modal pointer-events-auto flex max-h-[calc(100dvh-24px)] w-[min(640px,100%)] flex-col overflow-hidden text-white animate-hud-rise motion-reduce:animate-none"
        >
          <div class="px-3 pt-6 pb-4 text-center">
            <div class="flex items-center gap-4">
              <span
                aria-hidden="true"
                class="h-px min-w-0 flex-1 bg-linear-to-r from-transparent to-white/20"
              ></span>
              ${this.renderTitle()}
              <span
                aria-hidden="true"
                class="h-px min-w-0 flex-1 bg-linear-to-l from-transparent to-white/20"
              ></span>
            </div>
            ${this.renderStats()}
          </div>
          <div class="min-h-0 flex-1 overflow-y-auto px-3">
            <game-xp-panel
              .view=${this.xpView}
              .onScreen=${this.isVisible}
              @xp-reveal-settled=${(e: CustomEvent<GameXpPanelState>) =>
                (this.xpSettled = e.detail)}
              .gameType=${this.game?.config().gameConfig().gameType ?? null}
              @xp-legend=${this.onXpLegend}
            ></game-xp-panel>
            ${
              this.ffaRating === null
                ? nothing
                : html`<ffa-rating-panel
                    class="mt-3 block"
                    .gameId=${this.ffaRating.gameId}
                    .lobbyHumans=${this.ffaRating.lobbyHumans}
                  ></ffa-rating-panel>`
            }
            ${this.innerHtml()}
          </div>
          <!-- Leaving is the quieter action, on the left; staying in the game
               is the main one, on the right. Sharing a milestone sits between
               them, or on its own row above where three don't fit. -->
          <div class="@container flex flex-wrap gap-2 p-3">
            ${this.actionButton(
              "quiet",
              translateText("win_modal.exit"),
              () => this._handleExit(),
              "exit",
            )}
            ${this.renderShare()}
            ${
              this.requeueMode !== null
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
            ${
              this.game?.resumedFromSave?.()
                ? null
                : html`<button
                    type="button"
                    data-win-action="share"
                    data-win-tone="quiet"
                    class="${HUD_BUTTON_QUIET} w-12 shrink-0 px-0"
                    title=${translateText("win_modal.share")}
                    aria-label=${translateText("win_modal.share")}
                    @click=${this._handleShare}
                  >
                    <of-icon name="share" size="20"></of-icon>
                  </button>`
            }
          </div>
        </div>
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

  private setTitle(title: string, headline: boolean): void {
    this._title = title;
    this.titleIsHeadline = headline;
  }

  // "main" is the blue action (keep playing, play again); "quiet" is leaving.
  // min-w-28 makes long labels (German, Russian) wrap the row rather than
  // crush the buttons. In a narrow dialog (phones) a main action takes a full
  // row under the others, so its label stays on one line.
  private actionButton(
    tone: "main" | "quiet",
    label: string,
    onClick: () => void,
    action: string,
  ): TemplateResult {
    return html`<button
      type="button"
      data-win-action=${action}
      data-win-tone=${tone}
      class="${
        tone === "main"
          ? `${HUD_BUTTON_MAIN} @max-md:order-last @max-md:basis-full`
          : HUD_BUTTON_QUIET
      } min-w-28 flex-1"
      @click=${onClick}
    >
      ${label}
    </button>`;
  }

  // A fixed headline is drawn in the game's pixel font when the font has
  // every letter of it. A title with a name in it never is: a name can be in
  // any script, and uppercase would rewrite it.
  private renderTitle(): TemplateResult {
    const title = this._title ?? "";
    const folded = this.titleIsHeadline ? foldForDisplayFont(title) : null;
    // The text to draw in the pixel font, or null for the UI font.
    const displayText =
      folded !== null && DISPLAY_FONT_GLYPHS.test(folded) ? folded : null;
    const display = displayText !== null;
    return html`<h2
      id="win-modal-title"
      data-title-font=${display ? "display" : "ui"}
      class="m-0 min-w-0 text-balance break-words ${
        display
          ? "hud-caps font-display uppercase leading-none tracking-wide text-[clamp(1.875rem,9vw,3.5rem)]"
          : "text-2xl font-extrabold leading-tight"
      } ${this.isWin ? "text-cyber-yellow" : "text-white/90"}"
    >
      ${
        displayText === null
          ? title
          : displayText !== title
            ? html`<span aria-hidden="true"
                  >${raisePunctuation(displayText)}</span
                ><span class="sr-only">${title}</span>`
            : raisePunctuation(title)
      }
    </h2>`;
  }

  private renderStats(): TemplateResult | typeof nothing {
    const stats = this.stats;
    if (stats === null) return nothing;
    return html`<ul
      data-win-stats
      class="m-0 mt-4 flex list-none flex-wrap justify-center gap-2 p-0 text-sm font-bold tabular-nums text-white/70"
    >
      ${this.statChip(
        "time",
        "hourglass",
        translateText("win_modal.stat_time"),
        renderDuration(stats.seconds),
      )}
      ${
        stats.landShare === null
          ? nothing
          : this.statChip(
              "land",
              "land",
              translateText(
                stats.team ? "win_modal.stat_team_land" : "win_modal.stat_land",
              ),
              formatPercentage(stats.landShare),
            )
      }
      ${
        stats.rank === null
          ? nothing
          : this.statChip(
              "rank",
              // The team icon says the rank is among teammates.
              stats.team ? "team" : "leaderboard",
              translateText(
                stats.team ? "win_modal.stat_team_rank" : "win_modal.stat_rank",
              ),
              translateText("win_modal.stat_rank_value", {
                rank: stats.rank,
                players: stats.players,
              }),
            )
      }
    </ul>`;
  }

  private statChip(
    stat: string,
    icon: OfIconName,
    label: string,
    value: string,
  ): TemplateResult {
    return html`<li
      data-win-stat=${stat}
      title=${label}
      class="inline-flex items-center gap-2 rounded-sm bg-white/6 px-3 py-1"
    >
      <of-icon
        name=${icon}
        size="16"
        class=${this.isWin ? "text-cyber-yellow/75" : "text-white/55"}
      ></of-icon>
      <span class="sr-only">${label}</span>
      <span>${value}</span>
    </li>`;
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
    const placement =
      this.requeueMode !== null
        ? "order-first basis-full"
        : "order-first basis-full md:order-none md:basis-0 md:flex-1";
    return html`<profile-share
      data-win-share
      class="flex ${placement}"
      layout="menu"
      .label=${momentShareLabel(moment)}
      .url=${url}
      .text=${momentShareText(moment)}
      triggerClass="${HUD_BUTTON_QUIET} w-full"
    ></profile-share>`;
  }

  innerHtml() {
    // Poki doesn't allow promoting other platforms (see SteamWishlist), and
    // an outbound Discord link is the same kind of thing.
    if (gamePortal.name() === "poki") return nothing;

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
      <div data-win-promo="youtube" class="rounded-lg bg-white/6 p-3">
        <h3 class="mb-2 text-base font-bold text-white">
          ${translateText("win_modal.youtube_tutorial")}
        </h3>
        <div class="relative aspect-video overflow-hidden rounded-sm bg-black">
          ${
            Platform.isElectron
              ? html`<video
                  class="absolute inset-0 size-full"
                  src="${this.isVisible ? DESKTOP_TUTORIAL_VIDEO_URL : ""}"
                  controls
                  preload="metadata"
                ></video>`
              : html`<iframe
                  class="absolute inset-0 size-full"
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
      <div data-win-promo="patterns" class="rounded-lg bg-white/6 p-3">
        <h3 class="mb-2 text-base font-bold text-white">
          ${translateText("win_modal.support_openfront")}
        </h3>
        ${
          isDesktopShell()
            ? null
            : html`<p class="mb-3 text-sm text-white/70">
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
      <div data-win-promo="steam" class="rounded-lg bg-white/6 p-3">
        <h3 class="mb-2 text-base font-bold text-white">
          ${translateText("steam_wishlist.buy_on_steam")}
        </h3>
        <div class="overflow-hidden rounded-sm">
          <steam-wishlist
            campaign="win_modal"
            .active=${this.isVisible}
          ></steam-wishlist>
        </div>
      </div>
    `;
  }

  discordDisplay(): TemplateResult {
    return html`
      <div
        data-win-promo="discord"
        class="flex flex-wrap items-center gap-3 rounded-lg bg-white/6 p-3"
      >
        <span
          class="grid size-10 shrink-0 place-items-center rounded-xl bg-[#5865F2]"
        >
          <img
            src=${assetUrl("images/DiscordLogo.svg")}
            alt=""
            width="22"
            height="22"
          />
        </span>
        <div class="flex min-w-0 flex-[1_1_14rem] flex-col">
          <h3 class="m-0 text-sm font-bold text-white">
            ${translateText("win_modal.join_discord")}
          </h3>
          <p class="m-0 text-xs text-white/70">
            ${translateText("win_modal.discord_description")}
          </p>
        </div>
        <a
          href="https://discord.com/invite/openfront"
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex min-h-10 shrink-0 items-center justify-center rounded-lg bg-[#5865F2] px-4 text-sm font-bold uppercase tracking-widest text-white no-underline transition-colors hover:bg-[#4752C4] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-aquarius max-sm:basis-full"
        >
          ${translateText("win_modal.join_server")}
        </a>
      </div>
    `;
  }

  async show() {
    void gamePortal.gameplayStop();
    // The onboarding tutorial ends on its own card (OnboardingOverlay).
    if (this.game.config().gameConfig().tutorial === true) return;
    this.requeueMode = requeueModeForRankedType(
      this.game.config().gameConfig().rankedType,
    );
    this.stats = this.statsAtDeath ?? endScreenStats(this.game);
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
    if (this.requeueMode === null) return;
    this.hide();
    // Requeue for the same mode; Main owns the mechanism (currently a
    // reload with the requeue param, which reopens the queue after the
    // page teardown).
    document.dispatchEvent(
      new CustomEvent("matchmaking-requeue", {
        detail: { mode: this.requeueMode },
      }),
    );
  }

  private async _handleShare() {
    await shareGame(this.game?.gameID());
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
      this.setTitle(translateText("win_modal.died"), true);
      // A player who won and kept playing dies to a plain screen, not a gold one.
      this.isWin = false;
      this.statsAtDeath = endScreenStats(this.game);
      this.eventBus.emit(new PlaySoundEffectEvent("defeat"));
      void this.updateXp(false);
      void this.show();
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
        this.setTitle(translateText("win_modal.match_cancelled"), false);
        this.isWin = false;
        history.replaceState(null, "", `${window.location.pathname}?replay`);
        void this.show();
      } else if (wu.winner[0] === "team") {
        vote(wu.winner, wu.allPlayersStats);
        if (wu.winner[1] === this.game.myPlayer()?.team()) {
          this.setTitle(translateText("win_modal.your_team"), true);
          this.isWin = true;
          void gamePortal.happytime();
        } else {
          this.setTitle(
            translateText("win_modal.other_team", {
              team: getTranslatedPlayerTeamLabel(wu.winner[1]),
            }),
            false,
          );
          this.isWin = false;
        }
        this.playEndOfGameSound();
        history.replaceState(null, "", `${window.location.pathname}?replay`);
        void this.show();
      } else if (wu.winner[0] === "nation") {
        vote(wu.winner, wu.allPlayersStats);
        this.setTitle(
          translateText("win_modal.nation_won", { nation: wu.winner[1] }),
          false,
        );
        this.isWin = false;
        this.playEndOfGameSound();
        void this.show();
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
          this.setTitle(translateText("win_modal.you_won"), true);
          this.isWin = true;
          void gamePortal.happytime();
        } else {
          this.setTitle(
            translateText("win_modal.other_won", {
              player: winner.displayName(),
            }),
            false,
          );
          this.isWin = false;
        }
        this.playEndOfGameSound();
        history.replaceState(null, "", `${window.location.pathname}?replay`);
        void this.show();
      }
    });
    // After the vote, so a figure from the end has what was voted.
    if (winUpdates.length > 0) {
      void this.updateXp(true);
      void this.updateFfaRating();
    }
  }

  /**
   * Shows the FFA rating panel when this game can have changed the viewer's
   * rating: a public unranked FFA game they played, and a signed-in account
   * (a linked login or a portal profile) that already carries live rating
   * fields (see viewerHasFfaRating). Trust only gates board listing, so it
   * isn't checked here.
   * Decided once per game; any failure shows nothing.
   */
  private async updateFfaRating(): Promise<void> {
    if (this.ffaRatingChecked) return;
    try {
      const ffaGame = ffaRatingGameOf(
        this.game,
        lobbyPublicGameType(this.game.gameID()),
      );
      if (ffaGame === null) return;
      // Only a human winner ends a rated game: a nation or tribe win, a team
      // win or a cancelled match is never rated.
      if (this.gameEnd?.winner?.[0] !== "player") return;
      this.ffaRatingChecked = true;
      const account = await resolveXpAccount();
      if (account.kind !== "signed_in" || !viewerHasFfaRating(account.me)) {
        return;
      }
      await loadFfaRatingPanel();
      this.ffaRating = ffaGame;
    } catch (err) {
      console.warn("WinModal: no FFA rating panel", err);
    }
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
