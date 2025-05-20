import { Game, MutableAlliance, Player, Tick } from "./Game";

export class AllianceImpl implements MutableAlliance {
  constructor(
    private readonly mg: Game,
    readonly requestor_: Player,
    readonly recipient_: Player,
    readonly createdAtTick_: Tick,
  ) {}

  other(player: Player): Player {
    if (this.requestor_ === player) {
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
