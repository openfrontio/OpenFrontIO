import { PlayerView } from "../../../core/game/GameView";

/**
 * Singleton that tracks whether the player is in "pick a target country" mode
 * after selecting a requiresPlayer quick-chat preset.
 *
 * Intentionally has no EventBus dependency — callers poll `active` and call
 * `enter` / `exit` directly, keeping the state machine simple and testable.
 */
export class TargetSelectionMode {
  private static instance: TargetSelectionMode;

  private _active = false;
  private _pendingKey: string | null = null;
  private _pendingRecipient: PlayerView | null = null;

  static getInstance(): TargetSelectionMode {
    if (!TargetSelectionMode.instance) {
      TargetSelectionMode.instance = new TargetSelectionMode();
    }
    return TargetSelectionMode.instance;
  }

  get active(): boolean {
    return this._active;
  }

  get pendingKey(): string | null {
    return this._pendingKey;
  }

  get pendingRecipient(): PlayerView | null {
    return this._pendingRecipient;
  }

  /**
   * Activates target-selection mode.
   * @param key  Full quick-chat key, e.g. "attack.attack"
   * @param recipient  The player whose tile was right-clicked (message recipient)
   */
  enter(key: string, recipient: PlayerView): void {
    this._active = true;
    this._pendingKey = key;
    this._pendingRecipient = recipient;
  }

  /** Deactivates target-selection mode and clears all pending state. */
  exit(): void {
    this._active = false;
    this._pendingKey = null;
    this._pendingRecipient = null;
  }
}
