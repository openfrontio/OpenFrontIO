import { UnitType, PlayerType } from "../src/core/game/Game";
import { playerInfo, setup } from "./util/Setup";

describe("Building on vassal territory", () => {
  it("allows building on vassal land but not on non-vassal land", async () => {
    const game = await setup(
      "plains",
      { enableVassals: true, infiniteGold: true, instantBuild: true },
      [
        playerInfo("overlord", PlayerType.Human),
        playerInfo("vassal", PlayerType.Human),
        playerInfo("neutral", PlayerType.Human),
      ],
    );

    const overlord = game.player("overlord");
    const vassal = game.player("vassal");
    const neutral = game.player("neutral");

    // Find two land tiles
    const landTiles: number[] = [];
    game.map().forEachTile((t) => {
      if (landTiles.length >= 2) return;
      if (game.map().isLand(t)) {
        landTiles.push(t);
      }
    });
    const [vassalTile, neutralTile] = landTiles;
    vassal.conquer(vassalTile);
    neutral.conquer(neutralTile);
    overlord.addGold(2_000_000n);

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    // Establish vassalage
    game.vassalize(vassal, overlord);
    expect(game.vassalages().length).toBe(1);
    expect(overlord.vassals().length).toBe(1);

    // Overlord should see vassal territory as valid build tiles
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const validOnVassal = (overlord as any).validStructureSpawnTiles?.(
      vassalTile,
    ) as number[] | undefined;
    expect(validOnVassal && validOnVassal.includes(vassalTile)).toBe(true);

    // Overlord should NOT see neutral territory as valid
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const validOnNeutral = (overlord as any).validStructureSpawnTiles?.(
      neutralTile,
    ) as number[] | undefined;
    expect(validOnNeutral && validOnNeutral.length).toBe(0);
  });
});
