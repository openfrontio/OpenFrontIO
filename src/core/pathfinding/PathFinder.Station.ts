import { Game } from "../game/Game";
import { StationManager } from "../game/RailNetworkImpl";
import { TrainStation } from "../game/TrainStation";
import { AStar, AStarAdapter } from "./algorithms/AStar";
import { PathFinder } from "./types";

export class StationPathFinder implements PathFinder<TrainStation> {
  private manager: StationManager;
  private aStar: AStar;

  constructor(game: Game) {
    this.manager = game.railNetwork().stationManager();
    const adapter = new StationGraphAdapter(game, this.manager);
    this.aStar = new AStar({ adapter });
  }

  findPath(
    from: TrainStation | TrainStation[],
    to: TrainStation,
  ): TrainStation[] | null {
    const toCluster = to.getCluster();
    const fromArray = Array.isArray(from) ? from : [from];
    const sameCluster = fromArray.filter((s) => s.getCluster() === toCluster);
    if (sameCluster.length === 0) return null;

    const fromIds = sameCluster.map((s) => s.id);
    const path = this.aStar.findPath(fromIds, to.id);

    if (!path) return null;
    return path.map((id) => this.manager.getById(id)!);
  }
}

class StationGraphAdapter implements AStarAdapter {
  constructor(
    private game: Game,
    private manager: StationManager,
  ) {}

  numNodes(): number {
    return this.manager.count();
  }

  maxNeighbors(): number {
    return 8;
  }

  maxPriority(): number {
    return this.game.map().width() + this.game.map().height();
  }

  neighbors(node: number, buffer: Int32Array): number {
    const station = this.manager.getById(node);
    if (!station) return 0;

    let count = 0;
    for (const n of station.neighbors()) {
      buffer[count++] = n.id;
    }
    return count;
  }

  cost(): number {
    return 1;
  }

  heuristic(node: number, goal: number): number {
    const a = this.manager.getById(node);
    const b = this.manager.getById(goal);
    if (!a || !b) return 0;

    const ax = this.game.x(a.tile());
    const ay = this.game.y(a.tile());
    const bx = this.game.x(b.tile());
    const by = this.game.y(b.tile());
    return Math.abs(ax - bx) + Math.abs(ay - by);
  }
}
