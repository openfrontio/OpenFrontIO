import { LitElement, html } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { generateID } from "../core/Util";
import { getApiBase, getUserMe } from "./Api";
import { userAuth } from "./Auth";
import { JoinLobbyEvent } from "./Main";
import { translateText } from "./Utils";

type QueueType = "ranked" | "unranked";
type GameMode = "ffa" | "team" | "duel" | "duos" | "trios" | "quads";

interface QueueStatus {
  queueSize: number;
  estimatedWaitTime?: number;
  position?: number;
}

interface LeaderboardEntry {
  rank: number;
  username: string;
  currentElo: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
}

@customElement("ranked-queue")
export class RankedQueue extends LitElement {
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };

  @state() private inQueue: boolean = false;
  @state() private queueType: QueueType = "ranked";
  @state() private gameMode: GameMode = "ffa";
  @state() private queueStatus: QueueStatus | null = null;
  @state() private playerEloByMode: {
    ffa: number | null;
    duel: number | null;
  } = { ffa: null, duel: null };
  @state() private isConnecting: boolean = false;
  @state() private error: string | null = null;
  @state() private isLoadingElo: boolean = false;
  @state() private leaderboard: LeaderboardEntry[] = [];
  @state() private isLoadingLeaderboard: boolean = false;
  @state() private showLeaderboard: boolean = false;

  private ws: WebSocket | null = null;
  private clientID: string = generateID();
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 3;
  private reconnectTimeout: number | null = null;

  createRenderRoot() {
    return this;
  }

  /**
   * Get the current player's ELO for the selected game mode
   * Returns null for unranked modes (duos, trios, quads, unranked ffa)
   */
  private get currentPlayerElo(): number | null {
    if (this.queueType === "unranked") {
      return null; // No ELO for unranked modes
    }
    return this.gameMode === "duel"
      ? this.playerEloByMode.duel
      : this.playerEloByMode.ffa;
  }

  /**
   * Check if the current mode is a ranked mode (has ELO tracking)
   */
  private get isRankedMode(): boolean {
    return (
      this.queueType === "ranked" &&
      (this.gameMode === "ffa" || this.gameMode === "duel")
    );
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.cleanup();
  }

  /**
   * Fetch player's ELO rating from /users/@me endpoint
   */
  private async fetchPlayerElo() {
    this.isLoadingElo = true;
    try {
      const userMe = await getUserMe();
      if (userMe !== false) {
        // Use eloByMode if available, fall back to elo for backward compatibility
        const eloByMode = (userMe.player as any).eloByMode;
        if (eloByMode) {
          this.playerEloByMode = {
            ffa: eloByMode.ffa ?? null,
            duel: eloByMode.duel ?? null,
          };
        } else if (userMe.player.elo !== undefined) {
          // Backward compatibility: only FFA ELO available
          this.playerEloByMode = { ffa: userMe.player.elo, duel: null };
        }
      }
    } catch (error) {
      console.error("Failed to fetch player ELO:", error);
    } finally {
      this.isLoadingElo = false;
    }
  }

  /**
   * Fetch leaderboard via HTTP API
   */
  private async fetchLeaderboard() {
    this.isLoadingLeaderboard = true;
    try {
      const apiBase = getApiBase();
      const leaderboardMode = this.gameMode === "duel" ? "duel" : "ffa";
      const response = await fetch(
        `${apiBase}/leaderboard/public/${leaderboardMode}`,
      );

      if (response.ok) {
        const data = await response.json();
        // Add rank to each entry
        this.leaderboard = data.map((entry: any, index: number) => ({
          rank: index + 1,
          username: entry.username ?? "Anonymous",
          currentElo: entry.currentElo,
          gamesPlayed: entry.gamesPlayed,
          wins: entry.wins,
          losses: entry.losses,
        }));
        console.log("Fetched leaderboard:", this.leaderboard.length, "players");
      }
    } catch (error) {
      console.error("Failed to fetch leaderboard:", error);
    } finally {
      this.isLoadingLeaderboard = false;
    }
  }

  private cleanup() {
    if (this.reconnectTimeout !== null) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private async connectWebSocket() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return; // Already connected
    }

    this.isConnecting = true;
    this.error = null;

    try {
      // Get authentication information
      const loginResult = await userAuth();
      if (loginResult === false) {
        throw new Error("Please log in to join ranked matchmaking");
      }

      const token = loginResult.jwt;

      // Determine WebSocket URL based on environment
      const matchmakingBase = process?.env?.MATCHMAKING_WS_URL;
      const wsUrl = matchmakingBase
        ? `${matchmakingBase}/matchmaking/join`
        : (() => {
            const apiBase = getApiBase();
            const protocol = apiBase.startsWith("https://") ? "wss:" : "ws:";
            const host = apiBase.replace(/^https?:\/\//, "");
            return `${protocol}//${host}/matchmaking/join`;
          })();

      console.log("Connecting to matchmaking WebSocket:", wsUrl);
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log("Connected to matchmaking service");
        this.isConnecting = false;
        this.reconnectAttempts = 0;

        // Send authentication message
        this.ws?.send(
          JSON.stringify({
            type: "auth",
            playToken: token,
            queueType: this.queueType,
            gameMode: this.gameMode,
          }),
        );
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          this.handleMessage(message);
        } catch (error) {
          console.error("Error parsing WebSocket message:", error);
        }
      };

      this.ws.onerror = (error) => {
        console.error("WebSocket error:", error);
        this.error = "Connection error. Please try again.";
        this.isConnecting = false;
      };

      this.ws.onclose = () => {
        console.log("WebSocket closed");
        this.ws = null;

        // Attempt reconnection if we were in queue
        if (
          this.inQueue &&
          this.reconnectAttempts < this.maxReconnectAttempts
        ) {
          this.reconnectAttempts++;
          console.log(
            `Attempting reconnection ${this.reconnectAttempts}/${this.maxReconnectAttempts}`,
          );
          this.reconnectTimeout = window.setTimeout(
            () => this.connectWebSocket(),
            2000 * this.reconnectAttempts,
          );
        } else if (this.inQueue) {
          this.error = "Connection lost. Please rejoin the queue.";
          this.inQueue = false;
          this.isConnecting = false;
        }
      };
    } catch (error) {
      console.error("Error connecting to matchmaking:", error);
      this.error = error instanceof Error ? error.message : "Failed to connect";
      this.isConnecting = false;
    }
  }

  private handleMessage(message: any) {
    switch (message.type) {
      case "auth_success":
        console.log("Authentication successful");
        if (message.playerElo !== undefined) {
          if (this.gameMode === "duel") {
            this.playerEloByMode = {
              ...this.playerEloByMode,
              duel: message.playerElo,
            };
          } else {
            this.playerEloByMode = {
              ...this.playerEloByMode,
              ffa: message.playerElo,
            };
          }
        }
        break;

      case "queue_joined":
        console.log("Joined queue");
        this.inQueue = true;
        if (message.queueStatus) {
          this.queueStatus = message.queueStatus;
        }
        break;

      case "queue_status":
        console.log("Queue status update:", message.status);
        this.queueStatus = message.status;
        break;

      case "match_found":
        console.log("Match found!", message);
        this.handleMatchFound(message.gameId, message.assignment);
        break;

      case "error":
        console.error("Matchmaking error:", message.error);
        this.error = message.error;
        this.inQueue = false;
        break;

      default:
        console.log("Unknown message type:", message.type);
    }
  }

  private handleMatchFound(gameId: string, assignment: any) {
    console.log(`Match found! Joining game ${gameId}`);

    // Set URL hash to trigger automatic join
    history.pushState(null, "", `#join=${gameId}`);

    // Dispatch event to join the game
    this.dispatchEvent(
      new CustomEvent("join-lobby", {
        detail: {
          gameID: gameId,
          clientID: this.clientID,
        } as JoinLobbyEvent,
        bubbles: true,
        composed: true,
      }),
    );

    // Clean up
    this.inQueue = false;
    this.queueStatus = null;
    this.cleanup();
    this.close();
  }

  private async joinQueue() {
    if (this.inQueue) {
      return;
    }

    await this.connectWebSocket();

    const sendJoinMessage = () => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(
          JSON.stringify({
            type: "join_queue",
            queueType: this.queueType,
            gameMode: this.gameMode,
          }),
        );
      }
    };

    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN) {
        sendJoinMessage();
      } else if (this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.addEventListener("open", () => sendJoinMessage(), {
          once: true,
        });
      }
    }
  }

  private leaveQueue() {
    if (!this.inQueue) {
      return;
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: "leave_queue",
        }),
      );
    }

    this.inQueue = false;
    this.queueStatus = null;
    this.cleanup();
  }

  private setQueueType(type: QueueType) {
    if (this.inQueue || this.isConnecting) {
      return;
    }
    if (this.queueType !== type) {
      this.queueType = type;
      this.gameMode = "ffa";
      if (type === "ranked") {
        this.fetchLeaderboard();
      }
    }
  }

  private setGameMode(mode: GameMode) {
    if (this.inQueue || this.isConnecting) {
      return;
    }
    if (this.gameMode !== mode) {
      this.gameMode = mode;
      if (this.queueType === "ranked") {
        this.fetchLeaderboard();
      }
    }
  }

  public async open() {
    this.modalEl?.open();
    await Promise.all([this.fetchPlayerElo(), this.fetchLeaderboard()]);
  }

  public close() {
    if (this.inQueue) {
      this.leaveQueue();
    }
    this.modalEl?.close();
  }

  render() {
    return html`
      <o-modal
        id="ranked-queue-modal"
        title="${translateText("ranked_queue.quick_match")}"
      >
        <div class="flex flex-col gap-4">
          <!-- Ranked/Unranked Toggle -->
          <div class="flex gap-2">
            <button
              @click=${() => this.setQueueType("ranked")}
              ?disabled=${this.inQueue || this.isConnecting}
              class=${classMap({
                "c-button": true,
                "c-button--block": true,
                "c-button--secondary": this.queueType !== "ranked",
                "c-button--disabled": this.inQueue || this.isConnecting,
              })}
            >
              ${translateText("ranked_queue.ranked")}
            </button>
            <button
              @click=${() => this.setQueueType("unranked")}
              ?disabled=${this.inQueue || this.isConnecting}
              class=${classMap({
                "c-button": true,
                "c-button--block": true,
                "c-button--secondary": this.queueType !== "unranked",
                "c-button--disabled": this.inQueue || this.isConnecting,
              })}
            >
              ${translateText("ranked_queue.unranked")}
            </button>
          </div>

          <!-- Game Mode Toggle -->
          ${this.queueType === "ranked"
            ? html`
                <div class="flex gap-2">
                  <button
                    @click=${() => this.setGameMode("ffa")}
                    ?disabled=${this.inQueue || this.isConnecting}
                    class=${classMap({
                      "c-button": true,
                      "c-button--block": true,
                      "c-button--secondary": this.gameMode !== "ffa",
                      "c-button--disabled": this.inQueue || this.isConnecting,
                    })}
                  >
                    ${translateText("ranked_queue.ffa")}
                  </button>
                  <button
                    @click=${() => this.setGameMode("duel")}
                    ?disabled=${this.inQueue || this.isConnecting}
                    class=${classMap({
                      "c-button": true,
                      "c-button--block": true,
                      "c-button--secondary": this.gameMode !== "duel",
                      "c-button--disabled": this.inQueue || this.isConnecting,
                    })}
                  >
                    ${translateText("ranked_queue.duel")}
                  </button>
                </div>
              `
            : html`
                <div class="flex gap-2 flex-wrap">
                  <button
                    @click=${() => this.setGameMode("ffa")}
                    ?disabled=${this.inQueue || this.isConnecting}
                    class=${classMap({
                      "c-button": true,
                      "flex-1": true,
                      "c-button--secondary": this.gameMode !== "ffa",
                      "c-button--disabled": this.inQueue || this.isConnecting,
                    })}
                  >
                    ${translateText("ranked_queue.ffa")}
                  </button>
                  <button
                    @click=${() => this.setGameMode("duos")}
                    ?disabled=${this.inQueue || this.isConnecting}
                    class=${classMap({
                      "c-button": true,
                      "flex-1": true,
                      "c-button--secondary": this.gameMode !== "duos",
                      "c-button--disabled": this.inQueue || this.isConnecting,
                    })}
                  >
                    ${translateText("ranked_queue.duos")}
                  </button>
                  <button
                    @click=${() => this.setGameMode("trios")}
                    ?disabled=${this.inQueue || this.isConnecting}
                    class=${classMap({
                      "c-button": true,
                      "flex-1": true,
                      "c-button--secondary": this.gameMode !== "trios",
                      "c-button--disabled": this.inQueue || this.isConnecting,
                    })}
                  >
                    ${translateText("ranked_queue.trios")}
                  </button>
                  <button
                    @click=${() => this.setGameMode("quads")}
                    ?disabled=${this.inQueue || this.isConnecting}
                    class=${classMap({
                      "c-button": true,
                      "flex-1": true,
                      "c-button--secondary": this.gameMode !== "quads",
                      "c-button--disabled": this.inQueue || this.isConnecting,
                    })}
                  >
                    ${translateText("ranked_queue.quads")}
                  </button>
                </div>
              `}

          <!-- ELO Display for ranked modes -->
          ${this.isRankedMode
            ? html`
                <div class="text-center text-white">
                  ${this.isLoadingElo
                    ? html`<span class="opacity-70"
                        >${translateText("ranked_queue.loading_elo")}</span
                      >`
                    : this.currentPlayerElo !== null
                      ? html`<span
                          >${translateText("ranked_queue.your_elo")}
                          <strong>${this.currentPlayerElo}</strong></span
                        >`
                      : ""}
                </div>
              `
            : ""}

          <!-- Join Queue Button -->
          <button
            @click=${this.inQueue
              ? () => this.leaveQueue()
              : () => this.joinQueue()}
            ?disabled=${this.isConnecting}
            class=${classMap({
              "c-button": true,
              "c-button--block": true,
              "c-button--disabled": this.isConnecting,
            })}
            style=${this.inQueue ? "background: #dc2626; color: white;" : ""}
          >
            ${this.isConnecting
              ? translateText("ranked_queue.connecting")
              : this.inQueue
                ? translateText("ranked_queue.leave_queue")
                : this.isRankedMode
                  ? translateText("ranked_queue.join_ranked_queue")
                  : translateText("ranked_queue.join_queue")}
          </button>

          <!-- Error Display -->
          ${this.error
            ? html`<div class="text-red-400 text-center text-sm">
                ${this.error}
              </div>`
            : ""}

          <!-- Queue Status -->
          ${this.inQueue && this.queueStatus
            ? html`
                <div class="text-center text-white opacity-70">
                  ${this.queueStatus.queueSize}
                  ${translateText("ranked_queue.players_in_queue")}
                </div>
              `
            : ""}

          <!-- Leaderboard Toggle (only for ranked modes) -->
          ${this.isRankedMode
            ? html`
                <button
                  @click=${() => (this.showLeaderboard = !this.showLeaderboard)}
                  class="c-button c-button--block c-button--secondary"
                >
                  ${this.showLeaderboard
                    ? translateText("ranked_queue.hide_leaderboard")
                    : translateText("ranked_queue.view_leaderboard")}
                </button>
              `
            : ""}

          <!-- Leaderboard Display -->
          ${this.isRankedMode && this.showLeaderboard
            ? html`
                <div
                  class="bg-black/30 rounded-lg p-4 text-white max-h-64 overflow-y-auto"
                >
                  ${this.isLoadingLeaderboard
                    ? html`<div class="text-center py-4 opacity-70">
                        ${translateText("ranked_queue.loading_leaderboard")}
                      </div>`
                    : this.leaderboard.length === 0
                      ? html`<div class="text-center py-4 opacity-50">
                          ${translateText("ranked_queue.no_ranked_players")}
                        </div>`
                      : html`
                          <div class="space-y-2">
                            ${this.leaderboard.slice(0, 10).map(
                              (entry) => html`
                                <div
                                  class="flex items-center justify-between p-2 bg-white/10 rounded-lg"
                                >
                                  <div class="flex items-center gap-3">
                                    <div
                                      class="font-bold ${entry.rank <= 3
                                        ? "text-yellow-400"
                                        : "opacity-60"}"
                                    >
                                      #${entry.rank}
                                    </div>
                                    <div>
                                      <div class="font-medium">
                                        ${entry.username}
                                      </div>
                                      <div class="text-xs opacity-60">
                                        ${entry.gamesPlayed}
                                        ${translateText("ranked_queue.games")}
                                      </div>
                                    </div>
                                  </div>
                                  <div class="text-right">
                                    <div class="font-bold text-blue-400">
                                      ${entry.currentElo}
                                    </div>
                                    <div class="text-xs opacity-60">
                                      ${translateText("ranked_queue.elo")}
                                    </div>
                                  </div>
                                </div>
                              `,
                            )}
                          </div>
                        `}
                </div>
              `
            : ""}
        </div>
      </o-modal>
    `;
  }
}
