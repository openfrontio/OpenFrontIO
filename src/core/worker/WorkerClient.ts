import { getCdnBase } from "../AssetUrls";
import {
  BuildableUnit,
  Cell,
  PlayerActions,
  PlayerBorderTiles,
  PlayerBuildableUnitType,
  PlayerID,
  PlayerProfile,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { ErrorUpdate, GameUpdateViewData } from "../game/GameUpdates";
import { ClientID, GameStartInfo, Turn } from "../Schemas";
import { generateID } from "../Util";
import { WorkerMessage } from "./WorkerMessages";
// ?worker&url returns the worker bundle's URL as a string. We load it via a
// same-origin Blob trampoline because browsers refuse cross-origin
// `new Worker(url)` even with valid CORS+CORP. A Blob URL is same-origin to
// the page so the constructor accepts it, and dynamic `import()` inside the
// Blob IS CORS-checked and can fetch the real worker module from the CDN.
// R2 must serve the worker bundle with `Access-Control-Allow-Origin`.
import workerUrl from "./Worker.worker.ts?worker&url";

function createGameWorker(): Worker {
  const cdnBase = getCdnBase().replace(/\/+$/, "");
  // Same-origin path (dev, or any deploy without CDN_BASE set): construct the
  // worker directly. The Blob trampoline below is only needed for cross-origin
  // loads — browsers refuse `new Worker(url)` cross-origin even with valid
  // CORS+CORP, and Vite's dev server doesn't serve `?worker&url` URLs as
  // regular ES modules so the trampoline's dynamic `import()` would hang.
  if (!cdnBase) {
    return new Worker(workerUrl, { type: "module" });
  }
  const fullUrl = `${cdnBase}${workerUrl}`;
  // Buffer-and-replay: the worker's port enables when the trampoline script
  // starts, so any messages posted before the imported module attaches its
  // `message` handler would dispatch to no listener and be dropped. Capture
  // them here, then re-dispatch after the import resolves.
  const trampoline = `
const buffered = [];
const buffer = (e) => buffered.push(e);
self.addEventListener("message", buffer);
import(${JSON.stringify(fullUrl)}).then(() => {
  self.removeEventListener("message", buffer);
  for (const e of buffered) self.dispatchEvent(new MessageEvent("message", { data: e.data }));
}).catch((e) => self.postMessage({ type: "trampoline_error", message: String((e && e.message) || e) }));
`;
  const blobUrl = URL.createObjectURL(
    new Blob([trampoline], { type: "application/javascript" }),
  );
  const worker = new Worker(blobUrl, { type: "module" });
  URL.revokeObjectURL(blobUrl);
  return worker;
}

export class WorkerClient {
  private worker: Worker;
  private isInitialized = false;
  private messageHandlers: Map<string, (message: WorkerMessage) => void>;
  private gameUpdateCallback?: (
    update: GameUpdateViewData | ErrorUpdate,
  ) => void;

  constructor(
    private gameStartInfo: GameStartInfo,
    private clientID: ClientID | undefined,
  ) {
    this.worker = createGameWorker();
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
      case "game_update_batch":
        if (this.gameUpdateCallback && message.gameUpdates) {
          for (const gu of message.gameUpdates) {
            this.gameUpdateCallback(gu);
          }
        }
        break;
      case "game_error":
        if (this.gameUpdateCallback && message.error) {
          this.gameUpdateCallback(message.error);
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

      const onTrampolineError = (event: MessageEvent) => {
        if (event.data?.type !== "trampoline_error") return;
        this.worker.removeEventListener("message", onTrampolineError);
        this.messageHandlers.delete(messageId);
        reject(
          new Error(
            `Worker trampoline import failed: ${event.data.message ?? "unknown error"}`,
          ),
        );
      };
      this.worker.addEventListener("message", onTrampolineError);

      this.messageHandlers.set(messageId, (message) => {
        if (message.type === "initialized") {
          this.worker.removeEventListener("message", onTrampolineError);
          this.isInitialized = true;
          resolve();
        }
      });

      this.worker.postMessage({
        type: "init",
        id: messageId,
        gameStartInfo: this.gameStartInfo,
        clientID: this.clientID,
        cdnBase: getCdnBase(),
      });

      // Backstop for the worker hanging after a successful import (the
      // trampoline_error path handles the cross-origin / CORS load failure).
      setTimeout(() => {
        if (!this.isInitialized) {
          this.worker.removeEventListener("message", onTrampolineError);
          this.messageHandlers.delete(messageId);
          reject(new Error("Worker initialization timeout"));
        }
      }, 20000);
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
    x?: number,
    y?: number,
    units?: readonly PlayerBuildableUnitType[] | null,
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
        playerID,
        x,
        y,
        units,
      });
    });
  }

  playerBuildables(
    playerID: PlayerID,
    x?: number,
    y?: number,
    units?: readonly PlayerBuildableUnitType[],
  ): Promise<BuildableUnit[]> {
    return new Promise((resolve, reject) => {
      if (!this.isInitialized) {
        reject(new Error("Worker not initialized"));
        return;
      }

      const messageId = generateID();

      this.messageHandlers.set(messageId, (message) => {
        if (
          message.type === "player_buildables_result" &&
          message.result !== undefined
        ) {
          resolve(message.result);
        }
      });

      this.worker.postMessage({
        type: "player_buildables",
        id: messageId,
        playerID,
        x,
        y,
        units,
      });
    });
  }

  attackClusteredPositions(
    playerID: number,
    attackID?: string,
  ): Promise<{ id: string; positions: Cell[] }[]> {
    return new Promise((resolve, reject) => {
      if (!this.isInitialized) {
        reject(new Error("Worker not initialized"));
        return;
      }

      const messageId = generateID();

      const timeout = setTimeout(() => {
        this.messageHandlers.delete(messageId);
        reject(new Error("attack_clustered_positions request timed out"));
      }, 5000);

      this.messageHandlers.set(messageId, (message) => {
        clearTimeout(timeout);
        if (message.type !== "attack_clustered_positions_result") {
          reject(
            new Error(
              `Unexpected message type for attackClusteredPositions: ${message.type}`,
            ),
          );
          return;
        }
        resolve(
          message.attacks.map((a) => ({
            id: a.id,
            positions: a.positions.map((c) => new Cell(c.x, c.y)),
          })),
        );
      });

      this.worker.postMessage({
        type: "attack_clustered_positions",
        id: messageId,
        playerID,
        attackID,
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
