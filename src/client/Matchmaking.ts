import { html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { ClientEnv } from "src/client/ClientEnv";
import { UserMeResponse } from "../core/ApiSchemas";
import { getUserMe, hasLinkedAccount, invalidateUserMe } from "./Api";
import { getPlayToken } from "./Auth";
import { BaseModal } from "./components/BaseModal";
import "./components/Difficulties";
import { modalHeader } from "./components/ui/ModalHeader";
import { crazyGamesSDK } from "./CrazyGamesSDK";
import type { JoinLobbyEvent } from "./Main";
import { getRankedTeammate } from "./RankedTeammate";
import type { UsernameInput } from "./UsernameInput";
import { translateText } from "./Utils";

type MatchmakingJoin = {
  type: "join";
  jwt: string;
  clanTag?: string;
  teammatePublicId?: string;
};

@customElement("matchmaking-modal")
export class MatchmakingModal extends BaseModal {
  private gameCheckInterval: ReturnType<typeof setInterval> | null = null;
  private connectTimeout: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private watchdogTimeout: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private intentionalClose = false;
  // Which queue to join; set by Main from the open-matchmaking event
  // before the modal opens.
  public mode: "1v1" | "2v2" = "1v1";
  // Optional 2v2 teammate (public id), read from storage at queue time so the
  // ranked screen, the requeue URL and an in-place requeue all agree. The server
  // holds this player out of matching until that teammate names them back.
  // Chosen before queueing, so you can never be matched solo mid-setup.
  private teammatePublicId: string | null = null;
  @state() private connected = false;
  // Server-reported pairing state: waiting = held for the teammate,
  // ready = both named each other and the duo is searching.
  @state() private partyStatus: "waiting" | "ready" | null = null;
  // Own id, so a stale self-reference is never sent as a teammate.
  private myPublicId: string | null = null;
  @state() private socket: WebSocket | null = null;
  @state() private gameID: string | null = null;
  @state() private limitReached = false;
  @state() private queueSize: number | null = null;
  private selectedClanTag: string | null = null;
  private elo: number | string = "...";

  constructor() {
    super();
    this.id = "page-matchmaking";
  }

  createRenderRoot() {
    return this;
  }

  protected renderHeaderSlot() {
    return modalHeader({
      title: translateText(
        this.mode === "2v2"
          ? "matchmaking_modal.title_2v2"
          : "matchmaking_modal.title",
      ),
      onBack: () => this.close(),
      ariaLabel: translateText("common.back"),
    });
  }

  protected renderBody() {
    const eloDisplay = html`
      <p class="text-center mt-2 mb-4 text-white/60">
        ${translateText("matchmaking_modal.elo", { elo: this.elo })}
      </p>
    `;
    return html`
      <div class="flex flex-col items-center justify-center gap-6 p-6">
        ${eloDisplay} ${this.renderInner()}
      </div>
    `;
  }

  private renderInner() {
    if (this.limitReached) {
      return html`
        <div class="flex flex-col items-center gap-4 text-center">
          <p class="text-white font-bold">
            ${translateText("matchmaking_modal.limit_reached")}
          </p>
          <p class="text-sm text-white/60">
            ${translateText("matchmaking_modal.limit_reached_info")}
          </p>
          <button
            @click=${this.openSubscriptions}
            class="px-6 py-3 bg-purple-600 hover:bg-purple-500 text-white font-bold uppercase tracking-wider rounded-xl transition-colors"
          >
            ${translateText("matchmaking_modal.limit_upsell")}
          </button>
        </div>
      `;
    }
    if (!this.connected) {
      return this.renderLoadingSpinner(
        translateText("matchmaking_modal.connecting"),
        "blue",
      );
    }
    if (this.gameID === null) {
      // Held for a teammate: don't claim to be searching, since this player is
      // excluded from the pool until the other side queues too.
      if (this.partyStatus === "waiting") {
        return html`
          ${this.renderLoadingSpinner(
            translateText("matchmaking_modal.party_waiting"),
            "yellow",
          )}
          <p class="text-center text-xs text-white/40">
            ${translateText("matchmaking_modal.party_waiting_hint", {
              id: this.teammatePublicId ?? "",
            })}
          </p>
        `;
      }
      return html`
        ${this.queueSize !== null
          ? html`
              <p class="text-center text-white/60">
                ${translateText("matchmaking_modal.queue_size", {
                  count: this.queueSize,
                })}
              </p>
            `
          : ""}
        ${this.renderLoadingSpinner(
          translateText(
            this.partyStatus === "ready"
              ? "matchmaking_modal.party_searching_duo"
              : "matchmaking_modal.searching",
          ),
          "green",
        )}
      `;
    } else {
      return this.renderLoadingSpinner(
        translateText("matchmaking_modal.waiting_for_game"),
        "yellow",
      );
    }
  }

  // Re-enter the queue after a pre-start match cancellation (a matched
  // player never connected to the game server). The modal is normally still
  // open on "waiting for game" at that point — reset back to searching and
  // reconnect. Returns false when the modal was closed in the meantime, so
  // the caller knows nothing was rejoined.
  public requeue(): boolean {
    if (!this.isModalOpen) {
      return false;
    }
    if (this.gameCheckInterval) {
      clearInterval(this.gameCheckInterval);
      this.gameCheckInterval = null;
    }
    this.connected = false;
    this.gameID = null;
    this.intentionalClose = false;
    this.limitReached = false;
    this.queueSize = null;
    this.reconnectAttempts = 0;
    this.loadTeammate();
    this.connect();
    return true;
  }

  // Re-read on every queue entry so all paths agree. The status itself is never
  // assumed, only taken from the server: guessing "held" would strand a client
  // deployed ahead of the server on "waiting" while it queues normally.
  private loadTeammate() {
    this.teammatePublicId =
      this.mode === "2v2" ? getRankedTeammate(this.myPublicId) : null;
  }

  private openSubscriptions = () => {
    // The matchmaking modal isn't registered with the modal router, so it
    // won't be closed by the store opening from the hash change.
    this.close();
    window.location.hash = "modal=store&tab=subscriptions";
  };

  // The lobby writes to every queued socket every ~3s (queue-size), so
  // prolonged silence means the connection died without a close frame
  // (locked phone, dropped wifi). Left alone, that leaves a ghost in the
  // queue and games start short-handed — only the client can detect this,
  // so reconnect. Rejoining is safe: one account holds one queue slot.
  private resetWatchdog() {
    this.clearWatchdog();
    this.watchdogTimeout = setTimeout(() => {
      console.warn("[Matchmaking] no server message for 15s, reconnecting");
      if (this.socket) {
        // A dead socket can take a long time to emit its close event;
        // detach handlers so it can't trigger a second reconnect later.
        this.socket.onclose = null;
        this.socket.onmessage = null;
        this.socket.onerror = null;
        this.socket.close();
      }
      this.connected = false;
      this.queueSize = null;
      this.connect();
    }, 15000);
  }

  private clearWatchdog() {
    if (this.watchdogTimeout) {
      clearTimeout(this.watchdogTimeout);
      this.watchdogTimeout = null;
    }
  }

  private selectedClanFrom(userMe: UserMeResponse): string | null {
    if (this.mode !== "2v2") {
      return null;
    }
    const selectedTag = document
      .querySelector<UsernameInput>("username-input")
      ?.getClanTag();
    if (selectedTag === null || selectedTag === undefined) {
      return null;
    }
    return (
      userMe.player.clans?.find(
        (clan) => clan.tag.toUpperCase() === selectedTag.toUpperCase(),
      )?.tag ?? null
    );
  }

  private showMatchmakingError(messageKey: string) {
    window.dispatchEvent(
      new CustomEvent("show-message", {
        detail: {
          message: translateText(messageKey),
          color: "red",
          duration: 5000,
        },
      }),
    );
  }

  private handleInvalidClan() {
    const rejectedClanTag = this.selectedClanTag;
    this.connected = false;
    this.close();
    this.showMatchmakingError("matchmaking_modal.invalid_clan");

    invalidateUserMe();
    void getUserMe().then((userMe) => {
      if (userMe === false || rejectedClanTag === null) {
        return;
      }
      const stillMember = userMe.player.clans?.some(
        (clan) => clan.tag.toUpperCase() === rejectedClanTag.toUpperCase(),
      );
      if (!stillMember) {
        document
          .querySelector<UsernameInput>("username-input")
          ?.clearClanTag(rejectedClanTag);
      }
    });
  }

  private async connect() {
    // Pairing state belongs to the socket that reported it. Reconnects (watchdog,
    // close retry) call connect() directly, so clearing here stops a stale
    // waiting/ready outliving its connection.
    this.partyStatus = null;
    // Pending timers from a previous socket must not fire on this one.
    this.clearWatchdog();
    if (this.connectTimeout) {
      clearTimeout(this.connectTimeout);
      this.connectTimeout = null;
    }
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    // Nor may the previous socket itself: requeue()/onOpen() reset
    // intentionalClose and gameID before reconnecting, so a delayed close
    // event from the old socket would look unexpected and schedule a
    // duplicate connection — the server would then kick this one as
    // "replaced by newer connection".
    if (this.socket) {
      this.socket.onopen = null;
      this.socket.onmessage = null;
      this.socket.onerror = null;
      this.socket.onclose = null;
      if (this.socket.readyState !== WebSocket.CLOSED) {
        this.socket.close();
      }
    }
    this.socket = new WebSocket(
      `${ClientEnv.jwtIssuer()}/matchmaking/join?instance_id=${encodeURIComponent(ClientEnv.instanceId())}&mode=${this.mode}`,
    );
    this.socket.onopen = async () => {
      console.log("Connected to matchmaking server");
      this.connectTimeout = setTimeout(async () => {
        if (this.socket?.readyState !== WebSocket.OPEN) {
          console.warn("[Matchmaking] socket not ready");
          return;
        }
        // Set a delay so the user can see the "connecting" message,
        // otherwise the "searching" message will be shown immediately.
        // Also wait so people who back out immediately aren't added
        // to the matchmaking queue.
        const message: MatchmakingJoin = {
          type: "join",
          jwt: await getPlayToken(),
          ...(this.selectedClanTag === null
            ? {}
            : { clanTag: this.selectedClanTag }),
          // Server pairs two queued players who name each other.
          ...(this.teammatePublicId === null
            ? {}
            : { teammatePublicId: this.teammatePublicId }),
        };
        this.socket.send(JSON.stringify(message));
        this.connected = true;
        // The server starts broadcasting queue-size once we're queued;
        // from here on, silence means the connection is dead.
        this.resetWatchdog();
        this.requestUpdate();
      }, 2000);
    };
    this.socket.onmessage = (event) => {
      console.log(event.data);
      this.resetWatchdog();
      const data = JSON.parse(event.data);
      if (data.type === "queue-size") {
        this.queueSize = data.count;
        return;
      }
      if (data.type === "party-status") {
        this.partyStatus = data.status === "ready" ? "ready" : "waiting";
        return;
      }
      if (data.type === "match-assignment") {
        this.clearWatchdog();
        this.intentionalClose = true;
        this.socket?.close();
        console.log(`matchmaking: got game ID: ${data.gameId}`);
        this.gameID = data.gameId;
        this.gameCheckInterval = setInterval(() => this.checkGame(), 1000);
      }
    };
    this.socket.onerror = (event: Event) => {
      console.error("WebSocket error occurred:", event);
    };
    this.socket.onclose = (event: CloseEvent) => {
      console.log(
        `Matchmaking server closed connection: code=${event.code} reason=${event.reason}`,
      );
      this.clearWatchdog();
      this.queueSize = null;
      if (this.intentionalClose || this.gameID !== null) {
        return;
      }
      // 1008 is also used for auth failures ("Invalid session"), so match on
      // the reason. Out of free ranked plays — the server will keep refusing
      // until the next UTC day (or a subscription), so don't reconnect.
      if (event.code === 1008 && event.reason === "ranked_limit_reached") {
        this.connected = false;
        this.limitReached = true;
        return;
      }
      if (event.code === 1008 && event.reason === "invalid_clan") {
        this.handleInvalidClan();
        return;
      }
      if (event.code === 1011 && event.reason === "clan_verification_failed") {
        this.connected = false;
        this.close();
        this.showMatchmakingError("matchmaking_modal.clan_verification_failed");
        return;
      }
      if (event.code === 1000) {
        // A newer connection for this account (e.g. a second tab) took the
        // queue slot; this socket was replaced. Do not retry.
        window.dispatchEvent(
          new CustomEvent("show-message", {
            detail: {
              message: translateText("matchmaking_modal.replaced"),
              color: "red",
              duration: 5000,
            },
          }),
        );
        this.close();
        return;
      }
      // 1008: the jwt was rejected — getPlayToken() refreshes expired tokens,
      // so rejoining sends a fresh one. Anything else is a server
      // restart/deploy; the queue is in-memory only, so rejoin. Back off in
      // case the failure repeats.
      this.connected = false;
      const delay = Math.min(1000 * 2 ** this.reconnectAttempts++, 15000);
      this.reconnectTimeout = setTimeout(() => this.connect(), delay);
    };
  }

  protected async onOpen(): Promise<void> {
    const userMe = await getUserMe();
    // Early return if modal was closed during async operation
    if (!this.isModalOpen) {
      return;
    }

    // CrazyGames players authenticate through the SDK rather than a linked
    // Discord/Google/email account, so a signed-in CrazyGames user counts as
    // logged in for ranked.
    const crazyGamesSignedIn =
      crazyGamesSDK.isOnCrazyGames() &&
      (await crazyGamesSDK.getUserProfile()) !== null;
    if (!this.isModalOpen) {
      return;
    }

    if (
      userMe === false ||
      (!hasLinkedAccount(userMe) && !crazyGamesSignedIn)
    ) {
      window.dispatchEvent(
        new CustomEvent("show-message", {
          detail: {
            message: translateText("matchmaking_modal.must_login"),
            color: "red",
            duration: 3000,
          },
        }),
      );
      this.close();
      window.showPage?.("page-account");
      return;
    }

    this.myPublicId = userMe.player.publicId;
    const row =
      this.mode === "2v2"
        ? userMe.player.leaderboard?.twoVtwo
        : userMe.player.leaderboard?.oneVone;
    this.elo = row?.elo ?? translateText("matchmaking_modal.no_elo");
    this.selectedClanTag = this.selectedClanFrom(userMe);

    this.connected = false;
    this.gameID = null;
    this.intentionalClose = false;
    this.limitReached = false;
    this.queueSize = null;
    this.reconnectAttempts = 0;
    this.loadTeammate();
    this.connect();
  }

  protected onClose(): void {
    this.connected = false;
    this.intentionalClose = true;
    this.socket?.close();
    this.clearWatchdog();
    if (this.connectTimeout) {
      clearTimeout(this.connectTimeout);
      this.connectTimeout = null;
    }
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.gameCheckInterval) {
      clearInterval(this.gameCheckInterval);
      this.gameCheckInterval = null;
    }
  }

  private async checkGame() {
    if (this.gameID === null) {
      return;
    }
    const url = `${ClientEnv.serverHttpBase()}/${ClientEnv.workerPath(this.gameID)}/api/game/${this.gameID}/exists`;

    const response = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    const gameInfo = await response.json();

    if (response.status !== 200) {
      console.error(`Error checking game ${this.gameID}: ${response.status}`);
      return;
    }

    if (!gameInfo.exists) {
      console.info(`Game ${this.gameID} does not exist or hasn't started yet`);
      return;
    }

    if (this.gameCheckInterval) {
      clearInterval(this.gameCheckInterval);
      this.gameCheckInterval = null;
    }

    this.dispatchEvent(
      new CustomEvent("join-lobby", {
        detail: {
          gameID: this.gameID,
          source: "matchmaking",
        } as JoinLobbyEvent,
        bubbles: true,
        composed: true,
      }),
    );
  }
}
