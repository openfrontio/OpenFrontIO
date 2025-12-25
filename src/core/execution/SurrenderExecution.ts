import {
  Execution,
  Game,
  GameMode,
  MIN_GAME_TICKS_FOR_SURRENDER,
  Player,
  PlayerType,
} from "../game/Game";

export class SurrenderExecution implements Execution {
  private mg: Game | null = null;

  constructor(private player: Player) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;

    // Surrender only works in Duel mode
    const mode = mg.config().gameConfig().gameMode;
    if (mode !== GameMode.Duel) {
      console.warn("Surrender is only available in Duel mode");
      return;
    }

    // Check minimum game time (after spawn phase)
    const ticksSinceSpawnPhase = mg.ticks() - mg.config().numSpawnPhaseTurns();
    if (ticksSinceSpawnPhase < MIN_GAME_TICKS_FOR_SURRENDER) {
      console.warn(
        `Cannot surrender yet: ${Math.ceil((MIN_GAME_TICKS_FOR_SURRENDER - ticksSinceSpawnPhase) / 10)} seconds remaining`,
      );
      return;
    }

    // Find the opponent (the other human player in duel)
    const players = mg
      .players()
      .filter(
        (p) =>
          p.type() === PlayerType.Human && p !== this.player && p.isAlive(),
      );
    if (players.length !== 1) {
      console.warn("Cannot surrender: expected exactly one opponent");
      return;
    }

    const opponent = players[0];

    // Set the opponent as the winner
    mg.setWinner(opponent, mg.stats().stats());
    console.log(
      `${this.player.name()} surrendered. ${opponent.name()} wins the game.`,
    );
  }

  tick(ticks: number): void {
    return;
  }

  isActive(): boolean {
    return false;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
