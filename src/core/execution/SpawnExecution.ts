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
    public readonly tile: TileRef,
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

    let player: Player | null = null;
    if (this.mg.hasPlayer(this.playerInfo.id)) {
      player = this.mg.player(this.playerInfo.id);
    } else {
      player = this.mg.addPlayer(this.playerInfo);
    }

    player.tiles().forEach((t) => player.relinquish(t));
    getSpawnTiles(this.mg, this.tile).forEach((t) => {
      player.conquer(t);
    });

    if (!player.hasSpawned()) {
      this.mg.addExecution(new PlayerExecution(player));
      if (player.type() === PlayerType.Bot) {
        this.mg.addExecution(new BotExecution(player));
      }
    }
    player.setHasSpawned(true);
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return true;
  }
}
