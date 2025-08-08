import { EventBus } from "../../../core/EventBus";
import { GameView } from "../../../core/game/GameView";
import { MouseMoveEvent } from "../../InputHandler";
import { TransformHandler } from "../TransformHandler";
import {
  HoverInfo,
  OVERLAY_CONFIG,
  PlayerInfoService,
} from "./PlayerInfoService";

export class PlayerInfoManager {
  private static instance: PlayerInfoManager | null = null;
  private readonly playerInfoService: PlayerInfoService;
  private eventBus: EventBus;
  private lastDataUpdate = 0;
  private currentHoverInfo: HoverInfo | null = null;
  private currentMousePosition = { x: 0, y: 0 };
  private dataSubscribers: Set<(hoverInfo: HoverInfo) => void> = new Set();
  private mouseSubscribers: Set<(x: number, y: number) => void> = new Set();
  private mouseMoveCallback: ((event: MouseMoveEvent) => void) | null = null;
  private isActive = false;

  private constructor(
    game: GameView,
    transform: TransformHandler,
    eventBus: EventBus,
  ) {
    this.playerInfoService = new PlayerInfoService(game, transform);
    this.eventBus = eventBus;
  }

  static getInstance(
    game: GameView,
    transform: TransformHandler,
    eventBus: EventBus,
  ): PlayerInfoManager {
    PlayerInfoManager.instance ??= new PlayerInfoManager(
      game,
      transform,
      eventBus,
    );
    return PlayerInfoManager.instance;
  }

  init() {
    if (this.isActive) return;

    this.mouseMoveCallback = (e: MouseMoveEvent) => this.onMouseMove(e);
    this.eventBus.on(MouseMoveEvent, this.mouseMoveCallback);
    this.isActive = true;
  }

  destroy() {
    if (this.mouseMoveCallback) {
      this.eventBus.off(MouseMoveEvent, this.mouseMoveCallback);
      this.mouseMoveCallback = null;
    }
    this.dataSubscribers.clear();
    this.mouseSubscribers.clear();
    this.isActive = false;
    PlayerInfoManager.instance = null;
  }

  subscribeToData(callback: (hoverInfo: HoverInfo) => void) {
    this.dataSubscribers.add(callback);
    if (this.currentHoverInfo) {
      callback(this.currentHoverInfo);
    }
  }

  unsubscribeFromData(callback: (hoverInfo: HoverInfo) => void) {
    this.dataSubscribers.delete(callback);
  }

  subscribeToMouse(callback: (x: number, y: number) => void) {
    this.mouseSubscribers.add(callback);
    callback(this.currentMousePosition.x, this.currentMousePosition.y);
  }

  unsubscribeFromMouse(callback: (x: number, y: number) => void) {
    this.mouseSubscribers.delete(callback);
  }

  private async onMouseMove(event: MouseMoveEvent) {
    this.currentMousePosition.x = event.x;
    this.currentMousePosition.y = event.y;

    this.notifyMouseSubscribers();

    const now = Date.now();
    if (now - this.lastDataUpdate < OVERLAY_CONFIG.updateThrottleMs) {
      return;
    }
    this.lastDataUpdate = now;

    this.currentHoverInfo = await this.playerInfoService.getHoverInfo(
      event.x,
      event.y,
    );
    this.notifyDataSubscribers();
  }

  private notifyDataSubscribers() {
    if (this.currentHoverInfo) {
      this.dataSubscribers.forEach((callback) =>
        callback(this.currentHoverInfo!),
      );
    }
  }

  private notifyMouseSubscribers() {
    this.mouseSubscribers.forEach((callback) =>
      callback(this.currentMousePosition.x, this.currentMousePosition.y),
    );
  }

  getPlayerInfoService(): PlayerInfoService {
    return this.playerInfoService;
  }
}
