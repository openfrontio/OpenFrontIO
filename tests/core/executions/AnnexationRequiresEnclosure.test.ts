import { beforeEach, describe, expect, test } from "vitest";
import { PlayerExecution } from "../../../src/core/execution/PlayerExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
} from "../../../src/core/game/Game";
import { TileRef } from "../../../src/core/game/GameMap";
import { calculateBoundingBox, inscribed } from "../../../src/core/Util";
import { setup } from "../../util/Setup";

// The annexation checks (surroundedBySamePlayer / isSurrounded) run on a
// cluster of *border* tiles, but removeCluster hands over the whole
// contiguous territory that cluster sits on. One territory owns a separate
// border cluster for every hole punched in it — a nuke crater, an enemy
// enclave — so those two sets are not the same thing, and the defect lives in
// the gap between them. Drive removeCluster directly to pin the invariant:
// only land that is genuinely sealed in may change hands.
type ClusterRemover = { removeCluster(cluster: TileRef[]): void };

function clusterRemoverFor(game: Game, player: Player) {
  const exec = new PlayerExecution(player);
  exec.init(game, 0);
  const internals = exec as unknown as ClusterRemover;
  return (cluster: TileRef[]) => internals.removeCluster(cluster);
}

let game: Game;
let defender: Player;
let attacker: Player;

describe("annexation only takes territory that is actually enclosed", () => {
  beforeEach(async () => {
    game = await setup("big_plains", {}, [
      new PlayerInfo("defender", PlayerType.Human, "client1", "defender_id"),
      new PlayerInfo("attacker", PlayerType.Human, "client2", "attacker_id"),
    ]);
    defender = game.player("defender_id");
    attacker = game.player("attacker_id");
  });

  test("an enemy enclave does not hand over the empire around it", () => {
    // The attacker holds a small enclave deep inside the defender's empire.
    // The defender's empire runs to the edge of the map, so it is wide open —
    // but the ring of tiles around the enclave is a border cluster of its own,
    // and it is that ring the annexation checks get to look at.
    const enclave = { min: 60, max: 64 };
    for (let x = 0; x <= 120; x++) {
      for (let y = 0; y <= 120; y++) {
        const inEnclave =
          x >= enclave.min &&
          x <= enclave.max &&
          y >= enclave.min &&
          y <= enclave.max;
        (inEnclave ? attacker : defender).conquer(game.ref(x, y));
      }
    }

    const ring: TileRef[] = [];
    for (let i = enclave.min; i <= enclave.max; i++) {
      ring.push(game.ref(enclave.min - 1, i));
      ring.push(game.ref(enclave.max + 1, i));
      ring.push(game.ref(i, enclave.min - 1));
      ring.push(game.ref(i, enclave.max + 1));
    }
    for (const tile of ring) {
      expect(game.ownerID(tile)).toBe(defender.smallID());
    }

    const defenderTilesBefore = defender.numTilesOwned();
    const attackerTilesBefore = attacker.numTilesOwned();

    clusterRemoverFor(game, defender)(ring);

    expect(defender.numTilesOwned()).toBe(defenderTilesBefore);
    expect(attacker.numTilesOwned()).toBe(attackerTilesBefore);
  });

  test("a genuinely sealed-in pocket is still annexed", () => {
    // Same shape inverted: this time the defender is the one walled in, with
    // no route out to open land, so the mechanic should still fire.
    const pocket = { min: 60, max: 64 };
    for (let x = 58; x <= 66; x++) {
      for (let y = 58; y <= 66; y++) {
        const inPocket =
          x >= pocket.min &&
          x <= pocket.max &&
          y >= pocket.min &&
          y <= pocket.max;
        (inPocket ? defender : attacker).conquer(game.ref(x, y));
      }
    }

    const cluster: TileRef[] = [];
    for (let x = pocket.min; x <= pocket.max; x++) {
      for (let y = pocket.min; y <= pocket.max; y++) {
        if (game.map().isBorder(game.ref(x, y))) {
          cluster.push(game.ref(x, y));
        }
      }
    }
    expect(cluster.length).toBeGreaterThan(0);

    const attackerTilesBefore = attacker.numTilesOwned();
    const pocketSize = defender.numTilesOwned();

    clusterRemoverFor(game, defender)(cluster);

    expect(defender.numTilesOwned()).toBe(0);
    expect(attacker.numTilesOwned()).toBe(attackerTilesBefore + pocketSize);
  });

  test("a doughnut empire where the inner hole has more border tiles than the outer perimeter is not annexed", () => {
    // Defender holds a ring of territory with an inner hole.
    // Outer perimeter: (30,30) to (70,70) -> perimeter ~ 160 tiles.
    for (let x = 30; x <= 70; x++) {
      for (let y = 30; y <= 70; y++) {
        const isInnerHole = x >= 40 && x <= 60 && y >= 40 && y <= 60;
        if (!isInnerHole) {
          defender.conquer(game.ref(x, y));
        } else {
          attacker.conquer(game.ref(x, y));
        }
      }
    }

    // Add teeth/crenellations to the inner hole so its border length exceeds 160
    for (let x = 40; x <= 60; x++) {
      for (let y = 40; y <= 60; y++) {
        if ((x + y) % 2 === 0) {
          defender.conquer(game.ref(x, y));
        } else {
          attacker.conquer(game.ref(x, y));
        }
      }
    }

    // Place attacker tiles at the corners of the outer border so that if the
    // outer border were mistakenly treated as a secondary cluster, isSurrounded()
    // would evaluate to true.
    attacker.conquer(game.ref(29, 29));
    attacker.conquer(game.ref(71, 29));
    attacker.conquer(game.ref(29, 71));
    attacker.conquer(game.ref(71, 71));

    const exec = new PlayerExecution(defender);
    exec.init(game, 0);
    const { clusters } = (exec as any).calculateClusters() as {
      clusters: TileRef[][];
    };
    expect(clusters.length).toBeGreaterThanOrEqual(2);

    // Verify that the inner hole's cluster has strictly more border tiles than the outer perimeter
    const boxes = clusters.map((c) => calculateBoundingBox(game, c));
    const innerIdx = clusters.findIndex((_, idx) =>
      clusters.some(
        (_, otherIdx) =>
          otherIdx !== idx && inscribed(boxes[otherIdx], boxes[idx]),
      ),
    );
    const outerIdx = clusters.findIndex((_, idx) => idx !== innerIdx);
    expect(innerIdx).toBeGreaterThanOrEqual(0);
    expect(clusters[innerIdx].length).toBeGreaterThan(
      clusters[outerIdx].length,
    );

    const defenderTilesBefore = defender.numTilesOwned();
    expect(defenderTilesBefore).toBeGreaterThan(0);

    (exec as unknown as { removeClusters(): void }).removeClusters();

    // Defender must not be wiped out / annexed
    expect(defender.numTilesOwned()).toBe(defenderTilesBefore);
  });
});
