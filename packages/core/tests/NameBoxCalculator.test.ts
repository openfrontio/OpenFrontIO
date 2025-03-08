// import {Game, Player, Tile, Cell, TerraNullius, PlayerInfo} from '../src/core/GameApi';
// import {placeName, calculateBoundingBox, createGrid, findLargestInscribedRectangle, largestRectangleInHistogram, calculateFontSize} from '../src/client/NameBoxCalculator';

// class MockPlayer implements Player {
//     constructor(private playerTiles: [number, number][]) { }

//     info(): PlayerInfo {
//         return new PlayerInfo("TestPlayer", false);
//     }

//     id(): PlayerID {
//         return 1;
//     }

//     troops(): number {
//         return 0;
//     }

//     ownsTile(cell: Cell): boolean {
//         return this.playerTiles.some(([x, y]) => x === cell.x && y === cell.y);
//     }

//     isAlive(): boolean {
//         return true;
//     }

//     gameState(): Game {
//         return {} as Game; // This should be properly implemented
//     }

//     executions(): ExecutionView[] {
//         return [];
//     }

//     borderTilesWith(other: Player | TerraNullius): ReadonlySet<Tile> {
//         return new Set();
//     }

//     isPlayer(): this is Player {
//         return true;
//     }

//     neighbors(): (Player | TerraNullius)[] {
//         return [];
//     }
// }

// class MockGame implements Game {
//     private tiles: Tile[][] = [];
//     private mockPlayer: Player;

//     constructor(width: number, height: number, playerTiles: [number, number][]) {
//         this.tiles = Array(height).fill(null).map(() => Array(width).fill(null));
//         this.mockPlayer = new MockPlayer(playerTiles);

//         for (let y = 0; y < height; y++) {
//             for (let x = 0; x < width; x++) {
//                 this.tiles[y][x] = {
//                     owner: () => playerTiles.some(([px, py]) => px === x && py === y) ? this.mockPlayer : this.terraNullius(),
//                     hasOwner: () => playerTiles.some(([px, py]) => px === x && py === y),
//                     isBorder: () => false,
//                     isInterior: () => false,
//                     cell: () => new Cell(x, y),
//                     terrain: () => ({expansionCost: 1, expansionTime: 1}),
//                     game: () => this,
//                     neighbors: () => []
//                 };
//             }
//         }
//     }

//     player(id: PlayerID): Player {return this.mockPlayer;}
//     tile(cell: Cell): Tile {return this.tiles[cell.y][cell.x];}
//     isOnMap(cell: Cell): boolean {return cell.x >= 0 && cell.x < this.width() && cell.y >= 0 && cell.y < this.height();}
//     neighbors(cell: Cell): Cell[] {return [];}
//     width(): number {return this.tiles[0].length;}
//     height(): number {return this.tiles.length;}
//     forEachTile(fn: (tile: Tile) => void): void {this.tiles.flat().forEach(fn);}
//     executions(): ExecutionView[] {return [];}
//     terraNullius(): TerraNullius {return {ownsTile: () => false, isPlayer: () => false};}
//     tick() { }
//     addExecution(...exec: Execution[]) { }
// }

// // Mock implementations
// class MockGame implements Game {
//     private tiles: Tile[][] = [];
//     private mockPlayer: Player;

//     constructor(width: number, height: number, playerTiles: [number, number][]) {
//         this.tiles = Array(height).fill(null).map(() => Array(width).fill(null));
//         this.mockPlayer = {
//             info: () => new PlayerInfo("TestPlayer", false),
//             id: () => 1,
//             troops: () => 0,
//             ownsTile: (cell: Cell) => playerTiles.some(([x, y]) => x === cell.x && y === cell.y),
//             isAlive: () => true,
//             gameState: () => this,
//             executions: () => [],
//             borderTilesWith: () => new Set(),
//             isPlayer: function (this: Player): this is Player {return true},
//             neighbors: () => []
//         };

//         for (let y = 0; y < height; y++) {
//             for (let x = 0; x < width; x++) {
//                 this.tiles[y][x] = {
//                     owner: () => playerTiles.some(([px, py]) => px === x && py === y) ? this.mockPlayer : this.terraNullius(),
//                     hasOwner: () => playerTiles.some(([px, py]) => px === x && py === y),
//                     isBorder: () => false,
//                     isInterior: () => false,
//                     cell: () => new Cell(x, y),
//                     terrain: () => ({expansionCost: 1, expansionTime: 1}),
//                     game: () => this,
//                     neighbors: () => []
//                 };
//             }
//         }
//     }

//     player(id: number): Player {return this.mockPlayer;}
//     tile(cell: Cell): Tile {return this.tiles[cell.y][cell.x];}
//     isOnMap(cell: Cell): boolean {return cell.x >= 0 && cell.x < this.width() && cell.y >= 0 && cell.y < this.height();}
//     neighbors(cell: Cell): Cell[] {return [];}
//     width(): number {return this.tiles[0].length;}
//     height(): number {return this.tiles.length;}
//     forEachTile(fn: (tile: Tile) => void): void {this.tiles.flat().forEach(fn);}
//     executions(): any[] {return [];}
//     terraNullius(): TerraNullius {return {ownsTile: () => false, isPlayer: () => false};}
//     tick() { }
//     addExecution(...exec: any[]) { }
// }

// describe('Territory Name Placement', () => {
//     test('placeName should return a position and font size', () => {
//         const game = new MockGame(5, 5, [[1, 1], [2, 1], [3, 1], [2, 2], [2, 3]]);
//         const player = game.player(1);
//         const result = placeName(game, player);

//         expect(result).toHaveProperty('position');
//         expect(result).toHaveProperty('fontSize');
//         expect(result.position).toHaveProperty('x');
//         expect(result.position).toHaveProperty('y');
//         expect(typeof result.fontSize).toBe('number');
//     });

//     test('calculateBoundingBox should return correct bounding box', () => {
//         const game = new MockGame(5, 5, [[1, 1], [3, 3]]);
//         const player = game.player(1);
//         const boundingBox = calculateBoundingBox(game, player);

//         expect(boundingBox).toEqual({min: {x: 1, y: 1}, max: {x: 3, y: 3}});
//     });

//     test('createGrid should create correct boolean grid', () => {
//         const game = new MockGame(3, 3, [[0, 0], [1, 1], [2, 2]]);
//         const player = game.player(1);
//         const boundingBox = {min: {x: 0, y: 0}, max: {x: 2, y: 2}};
//         const grid = createGrid(game, player, boundingBox);

//         expect(grid).toEqual([
//             [true, false, false],
//             [false, true, false],
//             [false, false, true]
//         ]);
//     });

//     test('findLargestInscribedRectangle should find correct rectangle', () => {
//         const grid = [
//             [true, true, true],
//             [true, true, false],
//             [true, true, false]
//         ];
//         const result = findLargestInscribedRectangle(grid);

//         expect(result).toEqual({x: 0, y: 0, width: 2, height: 3});
//     });

//     test('largestRectangleInHistogram should find correct rectangle', () => {
//         const heights = [2, 1, 5, 6, 2, 3];
//         const result = largestRectangleInHistogram(heights);

//         expect(result).toEqual({x: 2, y: 0, width: 2, height: 5});
//     });

//     test('calculateFontSize should return correct font size', () => {
//         const rectangle = {x: 0, y: 0, width: 100, height: 50};
//         const name = "TestPlayer";
//         const fontSize = calculateFontSize(rectangle, name);

//         expect(fontSize).toBe(25); // 50 / 2 = 25 (height constrained)
//     });
// });
