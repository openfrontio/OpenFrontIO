import {
  Cell,
  PlayerActions,
  PlayerBorderTiles,
  PlayerID,
  PlayerProfile,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { ErrorUpdate, GameUpdateViewData } from "../game/GameUpdates";
import { ClientID, GameStartInfo, Turn } from "../Schemas";
import { generateID } from "../Util";
import {
  SetWorkerDebugMessage,
  TileContext,
  WorkerMessage,
  WorkerMetricsMessage,
} from "./WorkerMessages";

export class WorkerClient {
  private worker: Worker;
  private isInitialized = false;
  private messageHandlers: Map<string, (message: WorkerMessage) => void>;
  private gameUpdateCallback?: (
    update: GameUpdateViewData | ErrorUpdate,
  ) => void;
  private workerMetricsCallback?: (metrics: WorkerMetricsMessage) => void;

  private pendingTurns: Turn[] = [];
  private turnFlushScheduled = false;
  private readonly maxTurnsPerBatch = 256;

  constructor(
    private gameStartInfo: GameStartInfo,
    private clientID: ClientID,
  ) {
    this.worker = new Worker(new URL("./Worker.worker.ts", import.meta.url), {
      type: "module",
    });
    this.messageHandlers = new Map();

    // Set up global message handler
    this.worker.addEventListener(
      "message",
      this.handleWorkerMessage.bind(this),
    );
  }

  private handleWorkerMessage(event: MessageEvent<WorkerMessage>) {
    const message = event.data;

    switch (message.type) {
      case "game_update":
        if (this.gameUpdateCallback && message.gameUpdate) {
          this.gameUpdateCallback(message.gameUpdate);
        }
        break;

      case "worker_metrics":
        this.workerMetricsCallback?.(message);
        break;

      case "initialized":
      case "renderer_ready":
      default:
        if (message.id && this.messageHandlers.has(message.id)) {
          const handler = this.messageHandlers.get(message.id)!;
          handler(message);
          this.messageHandlers.delete(message.id);
        }
        break;
    }
  }

  /**
   * Add a message handler for a specific message ID.
   */
  addMessageHandler(
    id: string,
    handler: (message: WorkerMessage) => void,
  ): void {
    this.messageHandlers.set(id, handler);
  }

  /**
   * Remove a message handler.
   */
  removeMessageHandler(id: string): void {
    this.messageHandlers.delete(id);
  }

  /**
   * Post a message to the worker with optional transferables.
   */
  postMessage(message: any, transfer?: Transferable[]): void {
    if (
      message &&
      typeof message === "object" &&
      typeof message.sentAtWallMs !== "number"
    ) {
      message.sentAtWallMs = Date.now();
    }
    if (transfer && transfer.length > 0) {
      this.worker.postMessage(message, transfer);
      return;
    }
    this.worker.postMessage(message);
  }

  onWorkerMetrics(callback?: (metrics: WorkerMetricsMessage) => void): void {
    this.workerMetricsCallback = callback;
  }

  setWorkerDebug(config: {
    enabled: boolean;
    intervalMs?: number;
    includeTrace?: boolean;
  }): void {
    this.postMessage({
      type: "set_worker_debug",
      enabled: config.enabled,
      intervalMs: config.intervalMs,
      includeTrace: config.includeTrace,
    } satisfies SetWorkerDebugMessage);
  }

  initialize(): Promise<void> {
    return new Promise((resolve, reject) => {
      const messageId = generateID();

      this.messageHandlers.set(messageId, (message) => {
        if (message.type === "initialized") {
          this.isInitialized = true;
          resolve();
        }
      });

      this.postMessage({
        type: "init",
        id: messageId,
        gameStartInfo: this.gameStartInfo,
        clientID: this.clientID,
      });

      // Add timeout for initialization
      setTimeout(() => {
        if (!this.isInitialized) {
          this.messageHandlers.delete(messageId);
          reject(new Error("Worker initialization timeout"));
        }
      }, 20000); // 20 second timeout
    });
  }

  start(gameUpdate: (gu: GameUpdateViewData | ErrorUpdate) => void) {
    if (!this.isInitialized) {
      throw new Error("Failed to initialize pathfinder");
    }
    this.gameUpdateCallback = gameUpdate;
  }

  private scheduleTurnFlush(): void {
    if (this.turnFlushScheduled) return;
    this.turnFlushScheduled = true;
    setTimeout(() => {
      this.turnFlushScheduled = false;
      this.flushTurns();
    }, 0);
  }

  private flushTurns(): void {
    while (this.pendingTurns.length > 0) {
      const batch = this.pendingTurns.splice(0, this.maxTurnsPerBatch);
      this.postMessage({
        type: "turn_batch",
        turns: batch,
      });
    }
  }

  sendTurn(turn: Turn) {
    if (!this.isInitialized) {
      throw new Error("Worker not initialized");
    }

    this.pendingTurns.push(turn);
    this.scheduleTurnFlush();
  }

  sendTurnBatch(turns: Turn[]) {
    if (!this.isInitialized) {
      throw new Error("Worker not initialized");
    }
    if (turns.length === 0) return;

    // Preserve order with any already queued turns.
    this.pendingTurns.push(...turns);
    this.scheduleTurnFlush();
  }

  sendHeartbeat() {
    this.postMessage({
      type: "heartbeat",
    });
  }

  playerProfile(playerID: number): Promise<PlayerProfile> {
    return new Promise((resolve, reject) => {
      if (!this.isInitialized) {
        reject(new Error("Worker not initialized"));
        return;
      }

      const messageId = generateID();

      this.messageHandlers.set(messageId, (message) => {
        if (
          message.type === "player_profile_result" &&
          message.result !== undefined
        ) {
          resolve(message.result);
        }
      });

      this.postMessage({
        type: "player_profile",
        id: messageId,
        playerID: playerID,
      });
    });
  }

  playerBorderTiles(playerID: PlayerID): Promise<PlayerBorderTiles> {
    return new Promise((resolve, reject) => {
      if (!this.isInitialized) {
        reject(new Error("Worker not initialized"));
        return;
      }

      const messageId = generateID();

      this.messageHandlers.set(messageId, (message) => {
        if (
          message.type === "player_border_tiles_result" &&
          message.result !== undefined
        ) {
          resolve(message.result);
        }
      });

      this.postMessage({
        type: "player_border_tiles",
        id: messageId,
        playerID: playerID,
      });
    });
  }

  playerInteraction(
    playerID: PlayerID,
    x?: number,
    y?: number,
  ): Promise<PlayerActions> {
    return new Promise((resolve, reject) => {
      if (!this.isInitialized) {
        reject(new Error("Worker not initialized"));
        return;
      }

      const messageId = generateID();

      this.messageHandlers.set(messageId, (message) => {
        if (
          message.type === "player_actions_result" &&
          message.result !== undefined
        ) {
          resolve(message.result);
        }
      });

      this.postMessage({
        type: "player_actions",
        id: messageId,
        playerID: playerID,
        x: x,
        y: y,
      });
    });
  }

  attackAveragePosition(
    playerID: number,
    attackID: string,
  ): Promise<Cell | null> {
    return new Promise((resolve, reject) => {
      if (!this.isInitialized) {
        reject(new Error("Worker not initialized"));
        return;
      }

      const messageId = generateID();

      this.messageHandlers.set(messageId, (message) => {
        if (
          message.type === "attack_average_position_result" &&
          message.x !== undefined &&
          message.y !== undefined
        ) {
          if (message.x === null || message.y === null) {
            resolve(null);
          } else {
            resolve(new Cell(message.x, message.y));
          }
        }
      });

      this.postMessage({
        type: "attack_average_position",
        id: messageId,
        playerID: playerID,
        attackID: attackID,
      });
    });
  }

  transportShipSpawn(
    playerID: PlayerID,
    targetTile: TileRef,
  ): Promise<TileRef | false> {
    return new Promise((resolve, reject) => {
      if (!this.isInitialized) {
        reject(new Error("Worker not initialized"));
        return;
      }

      const messageId = generateID();

      this.messageHandlers.set(messageId, (message) => {
        if (
          message.type === "transport_ship_spawn_result" &&
          message.result !== undefined
        ) {
          resolve(message.result);
        }
      });

      this.postMessage({
        type: "transport_ship_spawn",
        id: messageId,
        playerID: playerID,
        targetTile: targetTile,
      });
    });
  }

  tileContext(tile: TileRef): Promise<TileContext> {
    return new Promise((resolve, reject) => {
      if (!this.isInitialized) {
        reject(new Error("Worker not initialized"));
        return;
      }

      const messageId = generateID();

      this.messageHandlers.set(messageId, (message) => {
        if (message.type === "tile_context_result" && message.result) {
          resolve(message.result);
        }
      });

      this.postMessage({
        type: "tile_context",
        id: messageId,
        tile,
      });
    });
  }

  cleanup() {
    this.worker.terminate();
    this.messageHandlers.clear();
    this.gameUpdateCallback = undefined;
  }
}
