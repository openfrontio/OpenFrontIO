import { html, LitElement, nothing, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { UserMeResponse } from "../core/ApiSchemas";
import { GameMapType } from "../core/game/Game";
import {
  PublicGameInfo,
  PublicGames,
  SCHEDULED_PUBLIC_GAME_TYPES,
} from "../core/Schemas";
import "./components/IOSAddToHomeScreenBanner";
import {
  canJoinTrustedLobby,
  lobbyCard,
  mapAspectRatios,
  trustRequiredDialog,
  viewerIsSignedIn,
  viewerIsTrusted,
} from "./components/LobbyCard";
import { crazyGamesSDK } from "./CrazyGamesSDK";
import { multiplayerAllowed, type DesktopUpdateState } from "./DesktopShell";
import { HostLobbyModal } from "./HostLobbyModal";
import { JoinLobbyModal } from "./JoinLobbyModal";
import { PublicLobbySocket } from "./LobbySocket";
import { JoinLobbyEvent } from "./Main";
import { SinglePlayerModal } from "./SinglePlayerModal";
import { UsernameInput } from "./UsernameInput";
import {
  calculateServerTimeOffset,
  getGameModeLabel,
  getSecondsUntilServerTimestamp,
  renderDuration,
  translateText,
} from "./Utils";

/**
 * The homepage's play surface: the lobby counting down as the hero with
 * solo/ranked/create/join under it, and the rest of the queue as a column of
 * cards down the right. News, identity and streams sit above it, in PlayPage.
 */

/** Shared geometry so the primary and the secondaries read as one family. */
const ACTION_SHAPE =
  "flex items-center justify-center gap-2 w-full min-h-[52px] py-3 rounded-xl " +
  "border text-center text-sm font-bold uppercase transition-colors";

const PRIMARY_ACTION =
  `${ACTION_SHAPE} px-4 tracking-wider ` +
  "bg-malibu-blue hover:bg-aquarius border-transparent text-white";

/** Three to a row, so a shade tighter: "create lobby" truncates otherwise. */
const GHOST_ACTION =
  `${ACTION_SHAPE} px-3 tracking-wide ` +
  "bg-[#101b28] border-white/10 text-white hover:bg-[#182636] hover:border-white/20";

/**
 * Whether a multiplayer entry point should refuse to act. Exported for tests
 * and kept free of component state so the rule is checkable in isolation.
 * A null state means no desktop shell (the web build), so nothing is gated.
 */
export function shouldBlockMultiplayerAction(
  state: DesktopUpdateState | null,
): boolean {
  if (state === null) return false;
  return !multiplayerAllowed(state);
}

@customElement("game-mode-selector")
export class GameModeSelector extends LitElement {
  @state() private lobbies: PublicGames | null = null;
  @state() private inputValid = true;
  @state() private desktopUpdateState: DesktopUpdateState | null = null;
  @state() private viewerTrusted = false;
  @state() private viewerSignedIn = false;
  @state() private showTrustRequired = false;
  /** Tapped open, for the touch devices that never hover or focus. */
  @state() private helpOpen = false;
  private serverTimeOffset = 0;

  private lobbySocket = new PublicLobbySocket((lobbies) =>
    this.handleLobbiesUpdate(lobbies),
  );

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.lobbySocket.start();
    window.addEventListener(
      "username-validity-change",
      this.handleValidityChange,
    );
    document.addEventListener(
      "desktop-update-state",
      this.onDesktopUpdateState,
    );
    document.addEventListener("userMeResponse", this.onUserMe);
    // Pick up the current value in case username-input validated before us.
    const usernameInput = document.querySelector(
      "username-input",
    ) as UsernameInput | null;
    if (usernameInput) {
      this.inputValid = usernameInput.canPlay();
    }
  }

  disconnectedCallback() {
    this.stop();
    window.removeEventListener(
      "username-validity-change",
      this.handleValidityChange,
    );
    document.removeEventListener(
      "desktop-update-state",
      this.onDesktopUpdateState,
    );
    document.removeEventListener("userMeResponse", this.onUserMe);
    super.disconnectedCallback();
  }

  public stop() {
    this.lobbySocket.stop();
  }

  private handleValidityChange = (e: Event) => {
    this.inputValid = (e as CustomEvent).detail?.isValid ?? true;
  };

  private onDesktopUpdateState = (e: Event) => {
    this.desktopUpdateState = (e as CustomEvent<DesktopUpdateState>).detail;
  };

  private onUserMe = (e: Event) => {
    const me = (e as CustomEvent<UserMeResponse | false>).detail;
    this.viewerSignedIn = viewerIsSignedIn(me);
    this.viewerTrusted = viewerIsTrusted(me);
    // A CrazyGames sign-in surfaces as a userMeResponse without a linked
    // identity, so re-read the SDK profile alongside it.
    if (crazyGamesSDK.isOnCrazyGames()) {
      void crazyGamesSDK.getUserProfile().then((user) => {
        if (user !== null) this.viewerSignedIn = true;
      });
    }
  };

  /** True while a pending desktop update bars multiplayer. */
  private get blocked(): boolean {
    return shouldBlockMultiplayerAction(this.desktopUpdateState);
  }

  private handleLobbiesUpdate(lobbies: PublicGames) {
    this.lobbies = lobbies;
    this.serverTimeOffset = calculateServerTimeOffset(lobbies.serverTime);
    for (const lobby of this.allLobbies(lobbies)) {
      mapAspectRatios.ensure(lobby.gameConfig?.gameMap as GameMapType, () =>
        this.requestUpdate(),
      );
    }
    this.requestUpdate();
  }

  /**
   * The queue in the order the master will promote it — ffa, team, special and
   * round again — which only the master knows. Position 0 counts down; a lobby
   * reported between two broadcasts has no position yet and sorts last.
   */
  private allLobbies(lobbies: PublicGames | null): PublicGameInfo[] {
    const position = (lobby: PublicGameInfo) =>
      lobby.queuePosition ?? Number.MAX_SAFE_INTEGER;
    return SCHEDULED_PUBLIC_GAME_TYPES.flatMap(
      (type) => lobbies?.games?.[type] ?? [],
    ).sort(
      (a, b) =>
        position(a) - position(b) ||
        // Unstamped, so unordered: the one counting down still leads, and the
        // hero never points at a lobby that isn't next.
        Number(a.startsAt === undefined) - Number(b.startsAt === undefined) ||
        (a.startsAt ?? 0) - (b.startsAt ?? 0) ||
        (a.gameID > b.gameID ? 1 : -1),
    );
  }

  private secondsUntil(lobby: PublicGameInfo): number | undefined {
    return lobby.startsAt
      ? getSecondsUntilServerTimestamp(lobby.startsAt, this.serverTimeOffset)
      : undefined;
  }

  /** Only the live lobby counts down; a queued one shows no pill at all. */
  private countdown(lobby: PublicGameInfo): string {
    const seconds = this.secondsUntil(lobby);
    if (seconds === undefined) return "";
    // "starting…" overflows the pill and the hero, so this gets its own label.
    if (seconds <= 0) return translateText("public_lobby.starting_now");
    return renderDuration(seconds);
  }

  render() {
    const queue = this.allLobbies(this.lobbies);
    const [featured, ...rest] = queue;
    return html`
      <div
        class="flex flex-col gap-4 w-full min-h-0 px-4 pb-8 lg:px-0 lg:pt-2 lg:flex-1 lg:pb-4"
      >
        <div
          class="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:flex-1 lg:min-h-0 lg:max-h-[32rem]"
        >
          ${this.renderHero(featured)}
          ${this.renderQueueColumn(rest, queue.length + this.hostedCount())}
        </div>
        ${this.renderActions()}
        <!-- Empty off iOS, and an empty element would still take the gap. -->
        <ios-add-to-home-screen-banner
          class="no-crazygames [&:empty]:hidden"
        ></ios-add-to-home-screen-banner>
      </div>
    `;
  }

  // ---- Rows ----

  /**
   * Grows to whatever height the queue column beside it takes. Waiting on the
   * first snapshot is a spinner; a snapshot with nothing scheduled in it says
   * so, rather than spinning at a page that has finished loading.
   */
  private renderHero(featured: PublicGameInfo | undefined) {
    return html`
      <div class="lg:col-span-2 min-w-0">
        ${featured !== undefined
          ? this.card(featured, "h-56 lg:h-full lg:min-h-48")
          : html`<div
              class="h-64 lg:h-full lg:min-h-48 rounded-2xl bg-surface/60 border border-white/10 flex items-center justify-center"
            >
              ${this.lobbies === null
                ? html`<span
                    class="size-16 border-4 border-malibu-blue/30 border-t-malibu-blue rounded-full animate-spin"
                  ></span>`
                : html`<span
                    class="px-6 text-center text-sm font-bold uppercase tracking-wider text-white/50"
                    >${translateText("public_lobby.none_scheduled")}</span
                  >`}
            </div>`}
      </div>
    `;
  }

  private renderActions() {
    return html`
      <!-- Above the lobby cards in one column, below them once the hero and
           queue sit side by side, which is where main puts them too. -->
      <div class="flex flex-col gap-3 min-w-0 order-first lg:order-none">
        <button
          @click=${this.openSolo}
          ?disabled=${!this.inputValid}
          class="${PRIMARY_ACTION} ${this.inputValid
            ? ""
            : "opacity-50 pointer-events-none"}"
        >
          <span class="min-w-0 truncate">${translateText("main.solo")}</span>
        </button>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          ${this.renderGhost(translateText("main.create"), this.openHost)}
          ${this.renderGhost(
            translateText("mode_selector.ranked_title"),
            this.openRanked,
          )}
          ${this.renderGhost(
            translateText("main.join"),
            this.openJoin,
            this.hostedCount(),
          )}
        </div>
        ${this.showTrustRequired
          ? trustRequiredDialog(
              this.viewerSignedIn,
              () => (this.showTrustRequired = false),
            )
          : nothing}
      </div>
    `;
  }

  /**
   * Every lobby here is the same card; only its height differs. Both fill the
   * row the page has room for, so a short window shrinks them rather than
   * pushing the buttons under the fold.
   */
  private card(lobby: PublicGameInfo, heightClass: string) {
    return lobbyCard({
      lobby,
      subtitle: getGameModeLabel(lobby.gameConfig!),
      timeDisplay: this.countdown(lobby),
      // A word, not a duration: "now" reads wrong in a countdown's lower case.
      timeDisplayUppercase: (this.secondsUntil(lobby) ?? 1) <= 0,
      disabled: !this.inputValid,
      blocked: this.blocked,
      viewerTrusted: this.viewerTrusted,
      heightClass,
      onClick: () => this.validateAndJoin(lobby),
    });
  }

  /**
   * The queue as a column beside the hero: top down, one lobby a row. Empty
   * until the first snapshot, but from then on the heading stays even with
   * nothing queued — it is the only way to the browser.
   */
  private renderQueueColumn(lobbies: PublicGameInfo[], advertised: number) {
    if (this.lobbies === null) return nothing;

    return html`
      <section class="flex flex-col gap-3 min-w-0 min-h-0">
        <div class="flex items-center gap-2">
          <!-- Heading and link are one control: two adjacent bits of small
               uppercase text read as one label, and neither looked clickable.
               A heading may hold a button, so the semantics survive. -->
          <h2 class="min-w-0 flex-1">
            <button
              @click=${this.openDetailed}
              class="group/see-all flex w-full items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 transition-colors hover:border-malibu-blue/50 hover:bg-malibu-blue/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malibu-blue"
            >
              <span
                class="truncate text-sm font-bold uppercase tracking-widest text-white/70 group-hover/see-all:text-white"
                >${translateText("public_lobby.upcoming")}</span
              >
              <span
                class="flex shrink-0 items-center gap-0.5 text-[11px] font-bold uppercase tracking-wider text-malibu-blue group-hover/see-all:text-white"
              >
                ${translateText("public_lobby.see_all", { count: advertised })}
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  class="size-4"
                  aria-hidden="true"
                >
                  <path
                    fill-rule="evenodd"
                    d="M8.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 0 1 0-1.06Z"
                    clip-rule="evenodd"
                  />
                </svg>
              </span>
            </button>
          </h2>
          ${this.renderQueueHelp()}
        </div>
        <div class="flex flex-col gap-3 lg:flex-1 lg:min-h-0">
          ${lobbies
            .slice(0, 2)
            .map((lobby) => this.card(lobby, "h-32 lg:h-full lg:min-h-20"))}
        </div>
      </section>
    `;
  }

  /**
   * Hover, keyboard focus, or a tap: iOS Safari doesn't reliably focus a button
   * on tap, and a phone is where "you can join before it goes live" most needs
   * saying.
   */
  private renderQueueHelp() {
    return html`
      <div class="group/queue-help relative shrink-0">
        <button
          type="button"
          @click=${() => (this.helpOpen = !this.helpOpen)}
          aria-label=${translateText("public_lobby.upcoming_help")}
          aria-expanded=${this.helpOpen}
          aria-describedby="upcoming-help"
          class="flex size-4 cursor-help items-center justify-center rounded-full bg-white/10 text-[10px] font-black text-white/60 transition-colors hover:bg-white/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malibu-blue"
        >
          ?
        </button>
        <div
          role="tooltip"
          id="upcoming-help"
          class="pointer-events-none absolute right-0 top-6 z-20 ${this.helpOpen
            ? "flex"
            : "hidden"} w-60 flex-col gap-1.5 rounded-lg border border-white/10 bg-zinc-900 px-3 py-2 text-xs normal-case tracking-normal text-white/80 shadow-xl group-hover/queue-help:flex group-focus-within/queue-help:flex"
        >
          <span>${translateText("public_lobby.upcoming_help_join")}</span>
          <span>${translateText("public_lobby.upcoming_help_full")}</span>
        </div>
      </div>
    `;
  }

  // ---- Bits ----

  /** Hosted lobbies: the Join badge's count, and part of the browser's. */
  private hostedCount(): number {
    return this.lobbies?.games?.hosted?.length ?? 0;
  }

  private renderGhost(
    label: string,
    onClick: () => void,
    badge = 0,
  ): TemplateResult {
    return html`
      <button
        @click=${onClick}
        ?disabled=${!this.inputValid}
        aria-disabled=${this.blocked}
        class="${GHOST_ACTION} ${!this.inputValid
          ? "opacity-50 pointer-events-none"
          : this.blocked
            ? "opacity-50 cursor-not-allowed"
            : ""}"
      >
        <span class="min-w-0 truncate">${label}</span>
        ${badge > 0
          ? html`<span
              class="px-2 py-0.5 rounded-full bg-malibu-blue text-[11px] font-bold text-white tracking-normal"
              >${badge}</span
            >`
          : nothing}
      </button>
    `;
  }

  // ---- Actions ----

  /**
   * Refuses the action and draws attention to the update bar. Returns true when
   * the caller should stop.
   *
   * Deliberately NOT `disabled`: a disabled control swallows the click, leaving
   * nothing to trigger the wiggle. The button stays clickable and merely stops
   * being actionable.
   */
  private blockedByUpdate(): boolean {
    if (!shouldBlockMultiplayerAction(this.desktopUpdateState)) return false;
    // Optional-call rather than an event: the bar is a sibling custom element
    // that may not have upgraded yet, and `?.wiggle?.()` degrades to a silent
    // no-op instead of firing an event with no listener.
    (
      document.querySelector("desktop-update-bar") as
        | (HTMLElement & { wiggle?: () => void })
        | null
    )?.wiggle?.();
    return true;
  }

  // Silent backstop; the buttons are already disabled while input is invalid.
  private validateUsername(): boolean {
    const usernameInput = document.querySelector(
      "username-input",
    ) as UsernameInput | null;
    return usernameInput ? usernameInput.canPlay() : true;
  }

  private validateAndJoin(lobby: PublicGameInfo) {
    if (this.blockedByUpdate()) return;
    if (!this.validateUsername()) return;
    // The server would refuse them anyway; this says why, and how to fix it.
    if (!canJoinTrustedLobby(lobby, this.viewerTrusted)) {
      this.showTrustRequired = true;
      return;
    }
    this.dispatchEvent(
      new CustomEvent("join-lobby", {
        detail: {
          gameID: lobby.gameID,
          source: "public",
          publicLobbyInfo: lobby,
        } as JoinLobbyEvent,
        bubbles: true,
        composed: true,
      }),
    );
  }

  private openSolo = () => {
    if (!this.validateUsername()) return;
    (
      document.querySelector("single-player-modal") as SinglePlayerModal
    )?.open();
  };

  private openHost = () => {
    if (this.blockedByUpdate()) return;
    if (!this.validateUsername()) return;
    (document.querySelector("host-lobby-modal") as HostLobbyModal)?.open();
  };

  private openJoin = () => {
    if (this.blockedByUpdate()) return;
    if (!this.validateUsername()) return;
    (document.querySelector("join-lobby-modal") as JoinLobbyModal)?.open();
  };

  private openRanked = () => {
    if (this.blockedByUpdate()) return;
    if (!this.validateUsername()) return;
    window.showPage?.("page-ranked");
  };

  // No username gate: browsing the list is read-only, and the browser checks
  // for itself before it joins anything.
  private openDetailed = () => {
    window.showPage?.("page-detailed-view");
  };
}
