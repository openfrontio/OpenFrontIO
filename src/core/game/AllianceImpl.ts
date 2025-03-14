import { MutableAlliance, Player, Tick } from "./Game";
import { GameImpl } from "./GameImpl";
import { PlayerImpl } from "./PlayerImpl";

export class AllianceImpl implements MutableAlliance {
  constructor(
    private readonly mg: GameImpl,
    readonly requestor_: PlayerImpl,
    readonly recipient_: PlayerImpl,
    readonly createdAtTick_: Tick,
  ) {}

  other(player: Player): PlayerImpl {
    if (this.requestor_ == player) {
      return this.recipient_;
    }
    return this.requestor_;
  }

  requestor(): Player {
    return this.requestor_;
  }

  recipient(): Player {
    return this.recipient_;
  }

  createdAt(): Tick {
    return this.createdAtTick_;
  }

  expire(): void {
    this.mg.expireAlliance(this);
  }
}
