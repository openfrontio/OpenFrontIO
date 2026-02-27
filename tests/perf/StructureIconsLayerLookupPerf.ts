import Benchmark from "benchmark";

const STRUCTURE_COUNT = 50000;
const LOOKUP_COUNT = 50000;
const UPGRADE_LOOKUP_COUNT = 5000;

interface StructureRenderSample {
  unitId: number;
  ownerId: number;
  level: number;
}

const rendersArray: StructureRenderSample[] = Array.from(
  { length: STRUCTURE_COUNT },
  (_, index) => ({
    unitId: index + 1,
    ownerId: (index % 5) + 1,
    level: (index % 4) + 1,
  }),
);

const rendersMap = new Map<number, StructureRenderSample>();
for (const render of rendersArray) {
  rendersMap.set(render.unitId, render);
}

const activeLookupIds = Array.from(
  { length: LOOKUP_COUNT },
  (_, index) => ((index * 97) % STRUCTURE_COUNT) + 1,
);

const inactiveLookupIds = Array.from(
  { length: LOOKUP_COUNT },
  (_, index) => ((index * 193) % STRUCTURE_COUNT) + 1,
);

const canUpgradeIds = Array.from(
  { length: UPGRADE_LOOKUP_COUNT },
  (_, index) => ((index * 389) % STRUCTURE_COUNT) + 1,
);

const myOwnerId = 3;
const results: string[] = [];

new Benchmark.Suite()
  .add("StructureIconsLayer BEFORE (array O(n) lookup/delete)", () => {
    const localRenders = [...rendersArray];

    for (const unitId of activeLookupIds) {
      const render = localRenders.find((entry) => entry.unitId === unitId);
      if (render) {
        render.level += 1;
      }
    }

    for (const canUpgradeId of canUpgradeIds) {
      const potentialUpgrade = localRenders.find(
        (entry) => entry.unitId === canUpgradeId && entry.ownerId === myOwnerId,
      );
      if (potentialUpgrade) {
        potentialUpgrade.level += 1;
      }
    }

    for (const unitId of inactiveLookupIds) {
      const index = localRenders.findIndex((entry) => entry.unitId === unitId);
      if (index !== -1) {
        localRenders.splice(index, 1);
      }
    }
  })
  .add("StructureIconsLayer AFTER (unit-id map O(1) lookup/delete)", () => {
    const localRenders = new Map<number, StructureRenderSample>(rendersMap);

    for (const unitId of activeLookupIds) {
      const render = localRenders.get(unitId);
      if (render) {
        render.level += 1;
      }
    }

    for (const canUpgradeId of canUpgradeIds) {
      const potentialUpgrade = localRenders.get(canUpgradeId);
      if (potentialUpgrade && potentialUpgrade.ownerId === myOwnerId) {
        potentialUpgrade.level += 1;
      }
    }

    for (const unitId of inactiveLookupIds) {
      localRenders.delete(unitId);
    }
  })
  .on("cycle", (event: any) => {
    results.push(String(event.target));
  })
  .on("complete", function () {
    console.log("\n=== StructureIconsLayer Lookup Benchmark Results ===");

    for (const result of results) {
      console.log(result);
    }

    const fastest = this.filter("fastest").map("name");
    console.log(`\nFastest implementation: ${fastest.join(", ")}`);
  })
  .run({ async: true });
