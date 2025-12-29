import { isClusterSurroundedBy } from "../src/core/execution/utils/surround";
import { playerInfo, setup } from "./util/Setup";
import { PlayerType } from "../src/core/game/Game";

function findLandWithLandNeighbors(game: any): number {
  const map = game.map();
  let center: number | null = null;
  map.forEachTile((t: number) => {
    if (center !== null) return;
    if (!map.isLand(t)) return;
    const ns = map.neighbors(t);
    if (ns.length < 4) return;
    if (ns.every((n: number) => map.isLand(n))) {
      center = t;
    }
  });
  if (center === null) throw new Error("No land tile found with land neighbors");
  return center;
}

describe("isClusterSurroundedBy", () => {
  it("returns true when surrounded by one attacker", async () => {
    const game = await setup(
      "plains",
      { infiniteTroops: true, infiniteGold: true, instantBuild: true },
      [playerInfo("a", PlayerType.Human), playerInfo("b", PlayerType.Human)],
    );
    const map = game.map();
    const center = findLandWithLandNeighbors(game);
    const target = game.player("a");
    const attacker = game.player("b");
    target.conquer(center);
    map.neighbors(center).forEach((t: number) => attacker.conquer(t));

    const borders = target.borderTiles();
    const allowed = new Set<number>([attacker.smallID()]);
    expect(
      isClusterSurroundedBy(
        game,
        borders,
        target.smallID(),
        allowed,
      ),
    ).toBe(true);
  });

  it("returns true when surrounded by attacker hierarchy (vassals)", async () => {
    const game = await setup(
      "plains",
      { enableVassals: true, infiniteTroops: true, infiniteGold: true, instantBuild: true },
      [
        playerInfo("a", PlayerType.Human),
        playerInfo("b", PlayerType.Human),
        playerInfo("v", PlayerType.Human),
      ],
    );
    const map = game.map();
    const center = findLandWithLandNeighbors(game);
    const target = game.player("a");
    const overlord = game.player("b");
    const vassal = game.player("v");
    game.vassalize(vassal, overlord);

    target.conquer(center);
    const ring = map.neighbors(center);
    ring.slice(0, Math.ceil(ring.length / 2)).forEach((t: number) => overlord.conquer(t));
    ring.slice(Math.ceil(ring.length / 2)).forEach((t: number) => vassal.conquer(t));

    const borders = target.borderTiles();
    const allowed = new Set<number>([
      overlord.smallID(),
      ...overlord.vassals().map((v) => v.smallID()),
    ]);
    expect(
      isClusterSurroundedBy(
        game,
        borders,
        target.smallID(),
        allowed,
      ),
    ).toBe(true);
  });

  it("returns false when mixed unrelated owners surround", async () => {
    const game = await setup(
      "plains",
      { infiniteTroops: true, infiniteGold: true, instantBuild: true },
      [
        playerInfo("a", PlayerType.Human),
        playerInfo("b", PlayerType.Human),
        playerInfo("c", PlayerType.Human),
      ],
    );
    const map = game.map();
    const center = findLandWithLandNeighbors(game);
    const target = game.player("a");
    const p1 = game.player("b");
    const p2 = game.player("c");
    target.conquer(center);
    const ring = map.neighbors(center);
    ring.slice(0, Math.ceil(ring.length / 2)).forEach((t: number) => p1.conquer(t));
    ring.slice(Math.ceil(ring.length / 2)).forEach((t: number) => p2.conquer(t));

    const borders = target.borderTiles();
    const allowed = new Set<number>([p1.smallID()]); // p2 not allowed
    expect(
      isClusterSurroundedBy(
        game,
        borders,
        target.smallID(),
        allowed,
      ),
    ).toBe(false);
  });
});
