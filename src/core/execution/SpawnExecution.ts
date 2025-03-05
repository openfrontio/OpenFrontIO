import { Execution, Game, Player, PlayerInfo, PlayerType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { BotExecution } from "./BotExecution";
import { PlayerExecution } from "./PlayerExecution";
import { getSpawnTiles } from "./Util";

export class SpawnExecution implements Execution {
  active: boolean = true;
  private mg: Game;

  constructor(
    private playerInfo: PlayerInfo,
    private tile: TileRef,
  ) {}

  init(mg: Game, ticks: number) {
    this.mg = mg;
  }

  tick(ticks: number) {
    this.active = false;

    if (!this.mg.inSpawnPhase()) {
      this.active = false;
      return;
    }

    const existing = this.mg
      .players()
      .find((p) => p.id() == this.playerInfo.id);
    if (existing) {
      existing.tiles().forEach((t) => existing.relinquish(t));
      getSpawnTiles(this.mg, this.tile).forEach((t) => {
        existing.conquer(t);
      });
      return;
    }

    const player = this.mg.addPlayer(
      this.playerInfo,
      this.mg.config().startManpower(this.playerInfo),
    );
    getSpawnTiles(this.mg, this.tile).forEach((t) => {
      player.conquer(t);
    });
    this.mg.addExecution(new PlayerExecution(player.id()));
    if (player.type() == PlayerType.Bot) {
      this.mg.addExecution(new BotExecution(player));
    }
  }

  owner(): Player {
    return null;
  }
  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return true;
  }
}
