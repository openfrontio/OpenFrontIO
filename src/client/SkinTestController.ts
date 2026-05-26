import { EventBus } from "../core/EventBus";
import { GameView, PlayerView } from "../core/game/GameView";
import { ClientID } from "../core/Schemas";
import { SkinTestWinModal } from "./hud/layers/SkinTestWinModal";
import { SendAttackIntentEvent } from "./Transport";

const INITIAL_ATTACK_DELAY_MS = 100;
const MAX_PLAYER_LOOKUP_RETRIES = 50;
const MODAL_TIMEOUT_MS = 120_000;

/**
 * Client-side controller for the "preview a skin" singleplayer game.
 *
 * Spawns the player, fires an initial attack so the skin is visible on the map,
 * then shows the rate/buy modal after a fixed timeout (or sooner if the game
 * ends). Lives on the client because it depends on wall-clock timing and on
 * the EventBus + DOM — neither of which belong in src/core.
 */
export class SkinTestController {
  private myPlayer: PlayerView | null = null;
  private attackTimer: ReturnType<typeof setTimeout> | null = null;
  private modalTimer: ReturnType<typeof setTimeout> | null = null;
  private lookupRetries = 0;
  private active = true;

  constructor(
    private readonly gameView: GameView,
    private readonly clientID: ClientID,
    private readonly eventBus: EventBus,
    private readonly modal: SkinTestWinModal | null,
    private readonly onPreviewEnded: () => void,
  ) {}

  start(): void {
    this.scheduleAttack();
    this.modalTimer = setTimeout(() => this.showModal(), MODAL_TIMEOUT_MS);
  }

  stop(): void {
    this.active = false;
    if (this.attackTimer !== null) {
      clearTimeout(this.attackTimer);
      this.attackTimer = null;
    }
    if (this.modalTimer !== null) {
      clearTimeout(this.modalTimer);
      this.modalTimer = null;
    }
  }

  showModal(): void {
    if (!this.active) return;
    const player = this.gameView.playerByClientID(this.clientID);
    const pattern = player?.cosmetics?.pattern;
    this.stop();
    this.onPreviewEnded();
    if (!pattern) {
      console.error("Skin test: no pattern on player", this.clientID);
      return;
    }
    this.modal?.showByName(pattern.name, pattern.colorPalette ?? null);
  }

  private scheduleAttack(): void {
    this.attackTimer = setTimeout(() => {
      this.attackTimer = null;
      this.runAttack();
    }, INITIAL_ATTACK_DELAY_MS);
  }

  private runAttack(): void {
    if (!this.active) return;
    if (this.myPlayer === null) {
      const found = this.gameView.playerByClientID(this.clientID);
      if (found === null) {
        if (++this.lookupRetries >= MAX_PLAYER_LOOKUP_RETRIES) {
          console.error("Skin test: gave up finding player");
          return;
        }
        this.scheduleAttack();
        return;
      }
      this.myPlayer = found;
    }
    const troops = Math.floor(this.myPlayer.troops() / 2);
    this.eventBus.emit(new SendAttackIntentEvent(null, troops));
  }
}
