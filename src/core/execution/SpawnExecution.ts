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

<<<<<<< Updated upstream
=======
    const spawnTile = this.isNukeWarsAndBaikal(player)
      ? this.findBestNukeWarsSpawn(player)
      : this.tile;

>>>>>>> Stashed changes
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

    private isNukeWarsAndBaikal(player: Player): boolean {
    const gc = this.mg.config().gameConfig();
    return (
      gc.gameMode === GameMode.NukeWars && gc.gameMap === GameMapType.Baikal
    );
  }

  private findBestNukeWarsSpawn(player: Player): TileRef {
    const mapWidth = this.mg.width();
    const midpoint = Math.floor(mapWidth / 2);
    const wantLeft = player.smallID() % 2 === 1;

    let bestTile: TileRef | null = null;
    let bestScore = Infinity;

    this.mg.forEachTile((t) => {
      const xt = this.mg.x(t);
      const onCorrectHalf = wantLeft ? xt < midpoint : xt >= midpoint;

      if (onCorrectHalf && !this.mg.hasOwner(t) && this.mg.isLand(t)) {
        const distToOriginal = this.mg.manhattanDist(this.tile, t);
        const distToMidpoint = Math.abs(xt - midpoint);
        const distToTeam = this.minDistToTeam(player, t);

        // Score combines distance from original tile, distance from midpoint, and distance from team members.
        // We want to be close to the original spawn, but also spread out from teammates.
        const score =
          distToOriginal +
          distToMidpoint * -0.5 + // Bias towards the center
          (isFinite(distToTeam) ? -distToTeam * 0.9 : 0) + // Bias away from teammates
          this.bandScore(player, t); // Bias towards a vertical band to spread out spawns

        if (score < bestScore) {
          bestScore = score;
          bestTile = t;
        }
      }
    });

    return bestTile ?? this.tile;
  }

  private minDistToTeam(player: Player, tile: TileRef): number {
    let minDist = Infinity;
    const team = player.team();
    if (!team) {
      return minDist;
    }

    for (const p of this.mg.players()) {
      if (p.team() !== team || p === player) {
        continue;
      }
      for (const owned of p.tiles()) {
        const d = this.mg.manhattanDist(owned, tile);
        if (d < minDist) {
          minDist = d;
        }
        if (minDist === 0) {
          return 0;
        }
      }
    }

    return minDist;
  }

  private bandScore(player: Player, tile: TileRef): number {
    const team = player.team();
    if (!team) {
      return 0;
    }

    const teamPlayers = this.mg
      .players()
      .filter((pp) => pp.team() === team)
      .sort((a, b) => a.smallID() - b.smallID());
    const teamIndex = teamPlayers.findIndex((pp) => pp === player);
    const teamCount = Math.max(1, teamPlayers.length);
    const numBands = Math.max(1, Math.round(Math.sqrt(teamCount)));
    const desiredBand = Math.floor((teamIndex / teamCount) * numBands);
    const y = this.mg.y(tile);
    const bandIndex = Math.floor((y / this.mg.height()) * numBands);
    const bandPenalty = 24; // tunes vertical spread strength

    return Math.abs(bandIndex - desiredBand) * bandPenalty;
  }
}
