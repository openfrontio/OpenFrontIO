import {
  Execution,
  Game,
  GameMapType,
  GameMode,
  Player,
  PlayerInfo,
  PlayerType,
} from "../game/Game";
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

    if (!this.mg.isValidRef(this.tile)) {
      console.warn(`SpawnExecution: tile ${this.tile} not valid`);
      return;
    }

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

    // Enforce Nuke Wars spawn side restrictions on Baikal.
    let spawnTile = this.tile;
    const gc = this.mg.config().gameConfig();
    if (
      gc.gameMode === GameMode.NukeWars &&
      gc.gameMap === GameMapType.Baikal
    ) {
      const mapWidth = this.mg.width();
      const tx = this.mg.x(this.tile);
      // Determine side for this player. We map players to left/right by smallID parity
      // odd -> left side, even -> right side. This keeps a deterministic 50/50 split.
      const wantLeft = player.smallID() % 2 === 1;
      const isLeft = tx < Math.floor(mapWidth / 2);
      if (wantLeft !== isLeft) {
        // Find nearest valid tile on the correct half. Bias selection toward
        // tiles closer to the midpoint so both sides get spawn tiles that
        // produce more balanced territory when map land distribution is uneven.
        let best: TileRef | null = null;
        let bestScore = Infinity;
        const midpoint = Math.floor(mapWidth / 2);
        this.mg.forEachTile((t) => {
          const xt = this.mg.x(t);
          const onCorrectHalf = wantLeft ? xt < midpoint : xt >= midpoint;
          if (onCorrectHalf && !this.mg.hasOwner(t) && this.mg.isLand(t)) {
            const d = this.mg.manhattanDist(this.tile, t);
            // score combines distance from original tile and distance from midpoint
            // biasFactor controls how strongly we prefer midline tiles (0.0-1.0)
            const biasFactor = 0.5;
            const centerDistance = Math.abs(xt - midpoint);
            const score = d + centerDistance * biasFactor;
            if (score < bestScore) {
              bestScore = score;
              best = t;
            }
          }
        });
        if (best !== null) {
          spawnTile = best;
        }
      }
    }

    player.tiles().forEach((t) => player.relinquish(t));
    getSpawnTiles(this.mg, spawnTile).forEach((t) => {
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
