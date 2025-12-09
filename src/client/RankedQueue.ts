import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { generateID } from "../core/Util";
import { getApiBase, getUserMe } from "./Api";
import { userAuth } from "./Auth";
import { JoinLobbyEvent } from "./Main";
import { translateText } from "./Utils";

type QueueType = "ranked" | "unranked";
type GameMode = "ffa" | "team" | "duel";

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
   */
  private get currentPlayerElo(): number | null {
    return this.gameMode === "duel"
      ? this.playerEloByMode.duel
      : this.playerEloByMode.ffa;
  }

  async connectedCallback() {
    super.connectedCallback();
    // Fetch player ELO and leaderboard immediately when component loads
    await Promise.all([this.fetchPlayerElo(), this.fetchLeaderboard()]);
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
      // Don't show error to user, just silently fail
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
      // In development, use local matchmaking server; in production, use API
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
          // Update the ELO for the current game mode from the server response
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
  }

  private async joinQueue() {
    if (this.inQueue) {
      return;
    }

    // Connect WebSocket if not connected
    await this.connectWebSocket();

    // Function to send join queue message
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

    // Send join queue message immediately if connected, or wait for connection
    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN) {
        sendJoinMessage();
      } else if (this.ws.readyState === WebSocket.CONNECTING) {
        // Wait for connection to open before sending join message
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

    // Send leave queue message
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
    if (this.inQueue) {
      return; // Can't change while in queue
    }
    this.queueType = type;
  }

  private setGameMode(mode: GameMode) {
    if (this.inQueue) {
      return; // Can't change while in queue
    }
    if (this.gameMode !== mode) {
      this.gameMode = mode;
      // Refresh leaderboard for the new mode
      this.fetchLeaderboard();
    }
  }

  render() {
    return html`
      <div class="bg-gray-900 border border-blue-500/50 rounded-2xl p-4">
        <!-- Header -->
        <div class="text-center mb-3">
          <h3 class="text-white font-bold text-lg">
            ${translateText("ranked_queue.ranked_matchmaking")}
          </h3>
        </div>

        <div class="flex flex-col gap-3">
          <!-- Game Mode Toggle -->
          <div class="flex gap-2">
            <button
              @click=${() => this.setGameMode("ffa")}
              ?disabled=${this.inQueue}
              class="flex-1 py-2 rounded-lg font-medium text-sm transition-colors ${this
                .gameMode === "ffa"
                ? "bg-blue-600 text-white"
                : "bg-gray-700 text-gray-300 hover:bg-gray-600"} ${this.inQueue
                ? "opacity-50 cursor-not-allowed"
                : ""}"
            >
              ${translateText("ranked_queue.ffa")}
            </button>
            <button
              @click=${() => this.setGameMode("duel")}
              ?disabled=${this.inQueue}
              class="flex-1 py-2 rounded-lg font-medium text-sm transition-colors ${this
                .gameMode === "duel"
                ? "bg-blue-600 text-white"
                : "bg-gray-700 text-gray-300 hover:bg-gray-600"} ${this.inQueue
                ? "opacity-50 cursor-not-allowed"
                : ""}"
            >
              ${translateText("ranked_queue.duel")}
            </button>
          </div>

          <!-- Join Queue Button -->
          <button
            @click=${this.inQueue
              ? () => this.leaveQueue()
              : () => this.joinQueue()}
            ?disabled=${this.isConnecting}
            class="w-full h-16 rounded-xl font-medium text-lg transition-opacity duration-200 ${this
              .inQueue
              ? "bg-gradient-to-r from-red-600 to-red-500 hover:opacity-90"
              : "bg-blue-600 hover:bg-blue-500"} text-white ${this.isConnecting
              ? "opacity-50 cursor-not-allowed"
              : ""}"
          >
            <div class="flex flex-col items-center justify-center">
              <div>
                ${this.isConnecting
                  ? translateText("ranked_queue.connecting")
                  : this.inQueue
                    ? translateText("ranked_queue.leave_queue")
                    : translateText("ranked_queue.join_ranked_queue")}
              </div>
              ${!this.inQueue && this.currentPlayerElo !== null
                ? html`<div class="text-sm mt-1 opacity-90">
                    ${translateText("ranked_queue.your_elo")}
                    ${this.currentPlayerElo}
                  </div>`
                : !this.inQueue && this.isLoadingElo
                  ? html`<div class="text-sm mt-1 opacity-90">
                      ${translateText("ranked_queue.loading_elo")}
                    </div>`
                  : ""}
              ${this.error
                ? html`<div class="text-sm mt-1 text-red-200">
                    ${this.error}
                  </div>`
                : ""}
            </div>
          </button>

          <!-- Leaderboard Toggle Button -->
          <button
            @click=${() => (this.showLeaderboard = !this.showLeaderboard)}
            class="w-full py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium transition-colors"
          >
            ${this.showLeaderboard
              ? translateText("ranked_queue.hide_leaderboard")
              : translateText("ranked_queue.view_leaderboard")}
          </button>

          <!-- Leaderboard Display -->
          ${this.showLeaderboard
            ? html`
                <div
                  class="bg-gray-800 rounded-xl p-4 text-white max-h-96 overflow-y-auto"
                >
                  ${this.isLoadingLeaderboard
                    ? html`<div class="text-center py-4">
                        ${translateText("ranked_queue.loading_leaderboard")}
                      </div>`
                    : this.leaderboard.length === 0
                      ? html`<div class="text-center py-4 text-gray-400">
                          ${translateText("ranked_queue.no_ranked_players")}
                        </div>`
                      : html`
                          <div class="space-y-2">
                            ${this.leaderboard.slice(0, 10).map(
                              (entry) => html`
                                <div
                                  class="flex items-center justify-between p-2 bg-gray-700 rounded-lg hover:bg-gray-600 transition-colors"
                                >
                                  <div class="flex items-center gap-3">
                                    <div
                                      class="font-bold text-lg ${entry.rank <= 3
                                        ? "text-yellow-400"
                                        : "text-gray-400"}"
                                    >
                                      #${entry.rank}
                                    </div>
                                    <div>
                                      <div class="font-medium">
                                        ${entry.username}
                                      </div>
                                      <div class="text-xs text-gray-400">
                                        ${entry.gamesPlayed}
                                        ${translateText("ranked_queue.games")} •
                                        ${entry.wins}${translateText(
                                          "ranked_queue.wins_short",
                                        )}
                                        ${entry.losses}${translateText(
                                          "ranked_queue.losses_short",
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                  <div class="text-right">
                                    <div class="font-bold text-blue-400">
                                      ${entry.currentElo}
                                    </div>
                                    <div class="text-xs text-gray-400">
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
      </div>
    `;
  }
}
