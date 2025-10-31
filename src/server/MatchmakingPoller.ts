import { Logger } from "winston";
import { ServerConfig } from "../core/configuration/Config";
import { generateID, simpleHash } from "../core/Util";

export interface MatchAssignment {
  players: string[]; // Player tokens
  config: {
    queueType: "ranked" | "unranked";
    gameMode: "ffa" | "team";
    playerCount: number;
    teamConfig?: unknown; // TODO: define team config
  };
}

export class MatchmakingPoller {
  private serverId: string;
  private isPolling: boolean = false;

  constructor(
    private config: ServerConfig,
    private log: Logger,
    private onAssignment: (
      gameId: string,
      assignment: MatchAssignment,
    ) => Promise<void>,
    private getCCU: () => number,
  ) {
    this.serverId = `worker-${process.env.WORKER_ID ?? "0"}`;
  }

  start() {
    if (this.isPolling) return;
    this.isPolling = true;
    this.poll();
  }

  stop() {
    this.isPolling = false;
  }

  /**
   * Generate a game ID that will hash to this worker
   * This ensures clients connect to the correct worker
   */
  private generateWorkerGameID(workerId: number, numWorkers: number): string {
    // Keep generating IDs until we find one that hashes to this worker
    let attempts = 0;
    const maxAttempts = 1000; // Safety limit
    while (attempts < maxAttempts) {
      const id = generateID();
      if (simpleHash(id) % numWorkers === workerId) {
        return id;
      }
      attempts++;
    }
    // Fallback: this should never happen, but return any ID
    this.log.warn(
      `Failed to generate ID for worker ${workerId} after ${maxAttempts} attempts`,
    );
    return generateID();
  }

  private async poll() {
    while (this.isPolling) {
      try {
        const workerId = parseInt(process.env.WORKER_ID ?? "0");
        const numWorkers = this.config.numWorkers();
        const gameId = this.generateWorkerGameID(workerId, numWorkers);
        const ccu = this.getCCU();

        this.log.info("Polling matchmaking service", {
          id: workerId,
          ccu: ccu,
        });

        const response = await fetch(
          `${this.config.jwtIssuer()}/matchmaking/checkin`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-API-Key": process.env.GAME_SERVER_API_KEY ?? "",
            },
            body: JSON.stringify({
              id: workerId,
              ccu: ccu,
              gameId: gameId,
            }),
          },
        );

        if (response.ok) {
          const data = await response.json();

          if (data.assignment) {
            this.log.info("Received match assignment", {
              gameId,
              players: data.assignment.players.length,
            });

            await this.onAssignment(gameId, data.assignment);
          }
        } else {
          this.log.error("Matchmaking check-in failed", {
            status: response.status,
            statusText: response.statusText,
          });
        }

        // Wait before next poll (10 seconds)
        await this.sleep(10000);
      } catch (error) {
        this.log.error("Matchmaking polling error", { error });
        // Wait before retrying on error
        await this.sleep(5000);
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
