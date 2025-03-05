import { EventBus } from "../src/core/EventBus";
import { Cell, PlayerInfo, TerrainMap, TerrainTypes } from "../src/core/Game";
import { GameImpl, PlayerImpl } from "../src/core/GameImpl";

describe("borderTilesWith", () => {
  let game: GameImpl;
  let player1: PlayerImpl;
  let player2: PlayerImpl;
  let terrainMap: TerrainMap;

  beforeEach(() => {
    // Create a 5x5 terrain map
    terrainMap = {
      terrain: jest.fn().mockReturnValue(TerrainTypes.Land),
      width: jest.fn().mockReturnValue(5),
      height: jest.fn().mockReturnValue(5),
    };
    const eventBus = new EventBus();
    game = new GameImpl(terrainMap, eventBus);
    player1 = game.addPlayer(new PlayerInfo("Player 1", false)) as PlayerImpl;
    player2 = game.addPlayer(new PlayerInfo("Player 2", false)) as PlayerImpl;
  });

  test("should return an empty set when players have no bordering tiles", () => {
    const borderTiles = player1.borderTilesWith(player2);
    expect(borderTiles.size).toBe(0);
  });

  test("should return correct border tiles when players are adjacent", () => {
    game.conquer(player1, new Cell(0, 0));
    game.conquer(player2, new Cell(1, 0));

    const borderTilesP1 = player1.borderTilesWith(player2);
    const borderTilesP2 = player2.borderTilesWith(player1);

    expect(borderTilesP1.size).toBe(1);
    expect(borderTilesP2.size).toBe(1);

    const p1BorderTile = Array.from(borderTilesP1)[0];
    const p2BorderTile = Array.from(borderTilesP2)[0];

    expect(p1BorderTile.cell()).toEqual(new Cell(0, 0));
    expect(p2BorderTile.cell()).toEqual(new Cell(1, 0));
  });

  test("should update border tiles when a new tile is conquered", () => {
    game.conquer(player1, new Cell(0, 0));
    game.conquer(player2, new Cell(2, 0));

    expect(player1.borderTilesWith(player2).size).toBe(0);

    game.conquer(player2, new Cell(1, 0));

    const borderTiles = player1.borderTilesWith(player2);
    expect(borderTiles.size).toBe(1);
    expect(Array.from(borderTiles)[0].cell()).toEqual(new Cell(0, 0));
  });

  test("should handle multiple border tiles correctly", () => {
    game.conquer(player1, new Cell(0, 0));
    game.conquer(player1, new Cell(0, 1));
    game.conquer(player2, new Cell(1, 0));
    game.conquer(player2, new Cell(1, 1));

    const borderTiles = player1.borderTilesWith(player2);
    expect(borderTiles.size).toBe(2);

    const borderCells = Array.from(borderTiles).map((tile) => tile.cell());
    expect(borderCells).toEqual(
      expect.arrayContaining([new Cell(0, 0), new Cell(0, 1)]),
    );
  });

  test("should update border tiles when a tile changes ownership", () => {
    game.conquer(player1, new Cell(0, 0));
    game.conquer(player1, new Cell(1, 0));
    game.conquer(player2, new Cell(2, 0));

    expect(player1.borderTilesWith(player2).size).toBe(1);

    game.conquer(player2, new Cell(1, 0));

    const borderTilesP1 = player1.borderTilesWith(player2);
    const borderTilesP2 = player2.borderTilesWith(player1);

    expect(borderTilesP1.size).toBe(1);
    expect(borderTilesP2.size).toBe(1);

    expect(Array.from(borderTilesP1)[0].cell()).toEqual(new Cell(0, 0));
    expect(Array.from(borderTilesP2).map((t) => t.cell())).toEqual(
      expect.arrayContaining([new Cell(1, 0)]),
    );
  });

  test("should handle border tiles with TerraNullius", () => {
    game.conquer(player1, new Cell(0, 0));

    const borderWithTerraNullius = player1.borderTilesWith(game.terraNullius());
    expect(borderWithTerraNullius.size).toBe(1);

    const borderCells = Array.from(borderWithTerraNullius).map((tile) =>
      tile.cell(),
    );
    expect(borderCells).toEqual(expect.arrayContaining([new Cell(0, 0)]));
  });

  test("should not include diagonal tiles as borders", () => {
    game.conquer(player1, new Cell(0, 0));
    game.conquer(player2, new Cell(1, 1));

    expect(player1.borderTilesWith(player2).size).toBe(0);
    expect(player2.borderTilesWith(player1).size).toBe(0);
  });

  // test('should handle complex border scenarios', () => {
  //     // Create a more complex border scenario
  //     //   0 1 2 3 4
  //     // 0 1 1 2 2 2
  //     // 1 1 1 2 2 2
  //     // 2 1 1 1 2 2
  //     // 3 1 1 1 1 2
  //     // 4 1 1 1 1 1

  //     for (let y = 0; y < 5; y++) {
  //         for (let x = 0; x < 5; x++) {
  //             if (x + y < 6) {
  //                 game.conquer(player1, new Cell(x, y));
  //             } else {
  //                 game.conquer(player2, new Cell(x, y));
  //             }
  //         }
  //     }

  //     const borderTilesP1 = player1.borderTilesWith(player2);
  //     const borderTilesP2 = player2.borderTilesWith(player1);

  //     expect(borderTilesP1.size).toBe(5);
  //     expect(borderTilesP2.size).toBe(5);

  //     const expectedBorderP1 = [
  //         new Cell(2, 0),
  //         new Cell(2, 1),
  //         new Cell(3, 2),
  //         new Cell(3, 3),
  //         new Cell(4, 3)
  //     ];

  //     const expectedBorderP2 = [
  //         new Cell(2, 2),
  //         new Cell(3, 1),
  //         new Cell(3, 2),
  //         new Cell(4, 1),
  //         new Cell(4, 2)
  //     ];

  //     const actualBorderP1 = Array.from(borderTilesP1).map(t => t.cell());
  //     const actualBorderP2 = Array.from(borderTilesP2).map(t => t.cell());

  //     expect(actualBorderP1).toEqual(expect.arrayContaining(expectedBorderP1));
  //     expect(actualBorderP2).toEqual(expect.arrayContaining(expectedBorderP2));
  // });

  test("should handle border updates when a player loses all tiles", () => {
    game.conquer(player1, new Cell(0, 0));
    game.conquer(player2, new Cell(1, 0));

    expect(player1.borderTilesWith(player2).size).toBe(1);

    game.conquer(player1, new Cell(1, 0)); // Player 1 takes Player 2's only tile

    expect(player1.borderTilesWith(player2).size).toBe(0);
    expect(player2.borderTilesWith(player1).size).toBe(0);
  });
});
