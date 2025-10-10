import { readFileSync } from "fs"; // Import readFileSync
import { join } from "path"; // Import join
import { Game } from "../game/Game";
import { TileRef } from "../game/GameMap";

export enum PathFindResultType {
  NextTile,
  Pending,
  Completed,
  PathNotFound,
}
export type AStarResult<NodeType> =
  | {
      type: PathFindResultType.NextTile;
      node: NodeType;
    }
  | {
      type: PathFindResultType.Pending;
    }
  | {
      type: PathFindResultType.Completed;
      node: NodeType;
    }
  | {
      type: PathFindResultType.PathNotFound;
    };

let wasm: typeof import("../../wasm/pathfinding/pkg");

async function loadWasm() {
  if (!wasm) {
    const pkg = await import("../../wasm/pathfinding/pkg");

    // Manually load the wasm file
    const wasmPath = join(__dirname, "../../../static/js/pathfinding_bg.wasm");
    const wasmBuffer = readFileSync(wasmPath);
    const wasmModule = await WebAssembly.compile(wasmBuffer);

    wasm = await pkg.default({ data: wasmModule }); // Pass the compiled module to init
  }
}

export class WasmPathFinder {
  private path: TileRef[] | null = null;

  constructor(private game: Game) {}

  async nextTile(
    curr: TileRef | null,
    dst: TileRef | null,
    dist: number = 1,
  ): Promise<AStarResult<TileRef>> {
    if (curr === null) {
      console.error("curr is null");
      return { type: PathFindResultType.PathNotFound };
    }
    if (dst === null) {
      console.error("dst is null");
      return { type: PathFindResultType.PathNotFound };
    }

    console.log(`WasmPathFinder.nextTile: curr=${curr} dst=${dst}`);
    console.log(
      `WasmPathFinder.nextTile: game.map().x(curr)=${this.game.map().x(curr)} game.map().y(curr)=${this.game.map().y(curr)}`,
    );
    console.log(
      `WasmPathFinder.nextTile: game.map().x(dst)=${this.game.map().x(dst)} game.map().y(dst)=${this.game.map().y(dst)}`,
    );
    console.log(
      `WasmPathFinder.nextTile: game.map().width=${this.game.map().width()} game.map().height=${this.game.map().height()}`,
    );

    if (this.game.manhattanDist(curr, dst) < dist) {
      return { type: PathFindResultType.Completed, node: curr };
    }

    await loadWasm();

    const fixedWidth = 16; // Use fixed width
    const fixedHeight = 16; // Use fixed height

    const gridData = new Array(fixedWidth * fixedHeight);
    for (let y = 0; y < fixedHeight; y++) {
      for (let x = 0; x < fixedWidth; x++) {
        const tile = this.game.map().ref(x, y);
        gridData[y * fixedWidth + x] = this.game.map().isWater(tile) ? 1 : 0;
      }
    }

    console.log(
      `WasmPathFinder.nextTile: fixedWidth=${fixedWidth} fixedHeight=${fixedHeight} gridData.length=${gridData.length}`,
    );

    const path = wasm.find_path(
      this.game.map().x(curr),
      this.game.map().y(curr),
      this.game.map().x(dst),
      this.game.map().y(dst),
      fixedWidth,
      fixedHeight,
      gridData,
    );

    if (path) {
      this.path = path.map((p: any) => this.game.map().ref(p.x, p.y)); // Cast p to any
      this.path.shift(); // Remove the start tile
      const tile = this.path.shift();
      if (tile === undefined) {
        return { type: PathFindResultType.PathNotFound };
      }
      return { type: PathFindResultType.NextTile, node: tile };
    } else {
      return { type: PathFindResultType.PathNotFound };
    }
  }
}
