import { consolex } from "../Consolex";
import { Execution, Game, Player } from "../game/Game";

export class QuickChatExecution implements Execution {
  private mg: Game;

  private active = true;

  constructor(
    private _owner: Player,
    private _target: Player,
    private quickChatKey: string,
    private variables: Record<string, string>,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    const message = this.getMessageFromKey(this.quickChatKey, this.variables);

    this.mg.displayChat(
      message[1],
      message[0],
      this.variables,
      this._target.id(),
      true,
      this._owner.name(),
    );

    this.mg.displayChat(
      message[1],
      message[0],
      this.variables,
      this._target.id(),
      false,
      this._owner.name(),
    );

    consolex.log(
      `[QuickChat] ${this._owner.name()} → ${this._target.name()}: ${message}`,
    );

    this.active = false;
  }

  owner(): Player {
    return this._owner;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  private getMessageFromKey(
    fullKey: string,
    vars: Record<string, string>,
  ): string[] {
    const translated = fullKey.split(".");
    return translated;
  }
}
