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
import { WorkerMessage } from "./WorkerMessages";

export class WorkerClient {
  private worker: Worker;
  private isInitialized = false;
  private messageHandlers: Map<string, (message: WorkerMessage) => void>;
  private gameUpdateCallback?: (
    update: GameUpdateViewData | ErrorUpdate,
  ) => void;

  constructor(
    private gameStartInfo: GameStartInfo,
    private clientID: ClientID,
  ) {
    this.worker = new Worker(new URL("./Worker.worker.ts", import.meta.url));
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

      case "initialized":
      default:
        if (message.id && this.messageHandlers.has(message.id)) {
          const handler = this.messageHandlers.get(message.id)!;
          handler(message);
          this.messageHandlers.delete(message.id);
        }
        break;
    }
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

      this.worker.postMessage({
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
      }, 5000); // 5 second timeout
    });
  }

  start(gameUpdate: (gu: GameUpdateViewData | ErrorUpdate) => void) {
    if (!this.isInitialized) {
      throw new Error("Failed to initialize pathfinder");
    }
    this.gameUpdateCallback = gameUpdate;
  }

  sendTurn(turn: Turn) {
    if (!this.isInitialized) {
      throw new Error("Worker not initialized");
    }

    this.worker.postMessage({
      type: "turn",
      turn,
    });
  }

  sendHeartbeat() {
    this.worker.postMessage({
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

      this.worker.postMessage({
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

      this.worker.postMessage({
        type: "player_border_tiles",
        id: messageId,
        playerID: playerID,
      });
    });
  }

  playerInteraction(
    playerID: PlayerID,
    x: number,
    y: number,
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

      this.worker.postMessage({
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

      this.worker.postMessage({
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

      this.worker.postMessage({
        type: "transport_ship_spawn",
        id: messageId,
        playerID: playerID,
        targetTile: targetTile,
      });
    });
  }

  cleanup() {
    this.worker.terminate();
    this.messageHandlers.clear();
    this.gameUpdateCallback = undefined;
  }
}
