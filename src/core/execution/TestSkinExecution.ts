import { ColorPalette } from "../CosmeticSchemas";
import { Execution, Game, PlayerID } from "../game/Game";
import { GameView, PlayerView } from "../game/GameView";
import { ClientID } from "../Schemas";

export class TestSkinExecution implements Execution {
  private static readonly MAX_INITIAL_ATTACK_RETRIES = 50;

  private myPlayer: PlayerView | null = null;
  private initialAttackTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private modalTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private initialAttackRetries = 0;
  private active = true;

  constructor(
    private gameView: GameView,
    private clientID: ClientID,
    private isRunnerActive: () => boolean,
    private onShowModalRequested: () => void,
    private onAttackIntent: (targetID: PlayerID | null, troops: number) => void,
    private onShowModal: (
      patternName: string,
      colorPalette: ColorPalette | null,
    ) => void,
  ) {}

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  // Not driven by the game engine tick loop — managed externally via start()/stop().
  init(_mg: Game, _ticks: number): void {}
  tick(_ticks: number): void {}

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
      if (!this.isRunnerActive()) return;
      this.showModal();
    }, 120000);
  }

  public stop() {
    this.active = false;
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

    // Safety net: clear our own timeouts in case onShowModalRequested threw
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

    this.onShowModal(patternName, colorPalette);
  }

  private scheduleInitialAttack(delayMs: number) {
    if (this.initialAttackTimeoutId !== null) {
      clearTimeout(this.initialAttackTimeoutId);
      this.initialAttackTimeoutId = null;
    }
    this.initialAttackTimeoutId = setTimeout(() => {
      this.initialAttackTimeoutId = null;
      if (!this.isRunnerActive()) return;
      this.initialAttack();
    }, delayMs);
  }

  private initialAttack() {
    if (!this.isRunnerActive()) return;

    if (this.myPlayer === null) {
      const myPlayer = this.gameView.playerByClientID(this.clientID);
      if (myPlayer === null) {
        this.initialAttackRetries++;
        if (
          this.initialAttackRetries >=
          TestSkinExecution.MAX_INITIAL_ATTACK_RETRIES
        ) {
          console.error(
            "TestSkinExecution: gave up finding player after",
            this.initialAttackRetries,
            "retries",
          );
          return;
        }
        this.scheduleInitialAttack(100);
        return;
      }
      this.myPlayer = myPlayer;
    }

    const troopCount = this.myPlayer.troops() ?? 1000000;
    this.onAttackIntent(null, Math.floor(troopCount / 2));
  }
}
