import {
  Execution,
  Game,
  GameMapType,
  GameMode,
  Player,
  PlayerInfo,
  PlayerType,
  TeamGameType,
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
      gc.gameMode === GameMode.Team &&
      gc.teamGameType === TeamGameType.NukeWars &&
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
            // Previously we biased toward the midpoint which caused many
            // spawns to cluster near the center line. Prefer tiles that are
            // slightly further from the midpoint to spread spawns across the
            // team's half and avoid tight clumps near the border.
            const biasFactor = -0.5;
            const centerDistance = Math.abs(xt - midpoint);
            // Compute distance to existing team-owned tiles (if any) so we prefer
            // tiles that are farther away from already-assigned spawns. This
            // helps avoid clustering near the midpoint or other crowded areas.
            let minDistToTeam = Infinity;
            try {
              const team = player.team();
              if (team) {
                for (const p of this.mg.players()) {
                  if (p.team() !== team) continue;
                  // skip the current player
                  if (p === player) continue;
                  for (const owned of p.tiles()) {
                    const dd = this.mg.manhattanDist(owned, t);
                    if (dd < minDistToTeam) minDistToTeam = dd;
                    if (minDistToTeam === 0) break;
                  }
                  if (minDistToTeam === 0) break;
                }
              }
            } catch (e) {
              // defensive: if anything goes wrong, fall back to no team-distance bias
              minDistToTeam = Infinity;
            }

            const spreadFactor = 0.9;
            const teamDistanceScore = isFinite(minDistToTeam)
              ? -minDistToTeam * spreadFactor
              : 0;

            // Additionally, distribute spawns vertically into bands so we avoid
            // many spawns congregating at the top or bottom of the map.
            let bandScore = 0;
            try {
              const team = player.team();
              if (team) {
                const teamPlayers = this.mg
                  .players()
                  .filter((pp) => pp.team() === team)
                  .sort((a, b) => a.smallID() - b.smallID());
                const teamIndex = teamPlayers.findIndex((pp) => pp === player);
                const teamCount = Math.max(1, teamPlayers.length);
                const numBands = Math.max(1, Math.round(Math.sqrt(teamCount)));
                const desiredBand = Math.floor(
                  (teamIndex / teamCount) * numBands,
                );
                const y = this.mg.y(t);
                const bandIndex = Math.floor((y / this.mg.height()) * numBands);
                const bandPenalty = 24; // tunes vertical spread strength
                bandScore = Math.abs(bandIndex - desiredBand) * bandPenalty;
              }
            } catch (e) {
              bandScore = 0;
            }

            const score =
              d + centerDistance * biasFactor + teamDistanceScore + bandScore;
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
