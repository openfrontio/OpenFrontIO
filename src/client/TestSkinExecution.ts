import { EventBus } from "../core/EventBus";
import { GameView, PlayerView } from "../core/game/GameView";
import { ClientID } from "../core/Schemas";
import { ShowSkinTestModalEvent } from "./graphics/layers/SkinTestWinModal";
import { SendAttackIntentEvent } from "./Transport";

export class TestSkinExecution {
  private myPlayer: PlayerView | null = null;
  private initialAttackTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private modalTimeoutId: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private gameView: GameView,
    private eventBus: EventBus,
    private clientID: ClientID,

    private isActive: () => boolean,
    // callback to request the runner stop the game before showing the modal
    private onShowModalRequested: () => void,
  ) {}

  public start() {
    // schedule the initial attack
    this.scheduleInitialAttack(100);

    // schedule the modal after 2 minutes
    if (this.modalTimeoutId !== null) {
      clearTimeout(this.modalTimeoutId);
      this.modalTimeoutId = null;
    }
    this.modalTimeoutId = setTimeout(() => {
      this.modalTimeoutId = null;
      if (!this.isActive()) return;
      this.showModal();
    }, 120000);
  }

  public stop() {
    if (this.initialAttackTimeoutId !== null) {
      clearTimeout(this.initialAttackTimeoutId);
      this.initialAttackTimeoutId = null;
    }
    if (this.modalTimeoutId !== null) {
      clearTimeout(this.modalTimeoutId);
      this.modalTimeoutId = null;
    }
  }

  public showModal() {
    try {
      this.onShowModalRequested();
    } catch (e) {
      // ignore
    }

    // Clear running timeouts to avoid duplicate work
    this.stop();

    // Resolve player and emit modal event
    const myPlayer = this.gameView.playerByClientID(this.clientID);
    if (!myPlayer) {
      console.error(
        "No player found to show skin test modal for",
        this.clientID,
      );
      return;
    }

    if (!myPlayer?.cosmetics?.pattern) {
      console.error("No pattern found on player", myPlayer?.cosmetics);
      return;
    }

    const patternName = myPlayer.cosmetics.pattern.name;
    const colorPalette = myPlayer.cosmetics.pattern.colorPalette ?? null;

    this.eventBus.emit(new ShowSkinTestModalEvent(patternName, colorPalette));
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
