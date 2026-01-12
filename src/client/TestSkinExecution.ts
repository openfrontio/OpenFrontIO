import { EventBus } from "../core/EventBus";
import { GameView, PlayerView } from "../core/game/GameView";
import { ClientID } from "../core/Schemas";
import { SendAttackIntentEvent } from "./Transport";

export class TestSkinExecution {
  private myPlayer: PlayerView | null = null;
  private initialAttackTimeoutId: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private gameView: GameView,
    private eventBus: EventBus,
    private clientID: ClientID,

    private isActive: () => boolean,
  ) {}

  public start() {
    this.scheduleInitialAttack(100);
  }

  public stop() {
    if (this.initialAttackTimeoutId !== null) {
      clearTimeout(this.initialAttackTimeoutId);
      this.initialAttackTimeoutId = null;
    }
  }

  private scheduleInitialAttack(delayMs: number) {
    if (this.initialAttackTimeoutId !== null) {
      clearTimeout(this.initialAttackTimeoutId);
      this.initialAttackTimeoutId = null;
    }
    this.initialAttackTimeoutId = setTimeout(() => {
      this.initialAttackTimeoutId = null;
      if (!this.isActive()) return;
      this.initialAttack();
    }, delayMs);
  }

  private initialAttack() {
    if (!this.isActive()) return;

    if (this.myPlayer === null) {
      const myPlayer = this.gameView.playerByClientID(this.clientID);
      if (myPlayer === null) {
        // try again shortly
        this.scheduleInitialAttack(100);
        return;
      }
      this.myPlayer = myPlayer;
    }

    const troopCount = this.myPlayer.troops() ?? 1000000;
    this.eventBus.emit(
      new SendAttackIntentEvent(null, Math.floor(troopCount / 2)),
    );
  }
}
