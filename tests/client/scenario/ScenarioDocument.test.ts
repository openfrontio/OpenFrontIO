/**
 * The scenario document's stored form (docs/ScenarioEditor.md, "1. Scenario
 * document"): what it accepts, what it rejects, and that it round-trips.
 */

import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { ID } from "@openfront/engine-api/Schemas";
import {
  decodeOwnership,
  encodeOwnership,
  IMPASSABLE,
  isScenarioSize,
  land,
  MAX_NATIONS,
  MAX_WARSHIPS,
  newNation,
  newScenarioDocument,
  SCENARIO_FORMAT,
  ScenarioDocumentSchema,
  serializeScenarioDocument,
  type StoredScenarioDocument,
} from "../../../src/client/scenario/ScenarioDocument";

const W = 100;
const H = 100;

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

/**
 * Land in columns 10-89, impassable in 50-54; West owns columns 10-29 and
 * East 70-89.
 */
function stored(): StoredScenarioDocument {
  const terrain = new Uint8Array(W * H);
  const owners = new Uint16Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 10; x < 90; x++) {
      const t = y * W + x;
      terrain[t] = x >= 50 && x < 55 ? IMPASSABLE : land(x % 31);
      if (x < 30) owners[t] = 1;
      if (x >= 70) owners[t] = 2;
    }
  }
  return {
    format: SCENARIO_FORMAT,
    meta: { name: "Test", description: "two nations" },
    terrain: { width: W, height: H, tiles: base64(terrain) },
    nations: [
      {
        id: "WESTNAT1",
        name: "West",
        flag: "fr",
        troops: 1000,
        gold: 50,
        playable: true,
      },
      {
        id: "EASTNAT1",
        name: "East",
        flag: null,
        troops: 2000,
        gold: 0,
        playable: false,
      },
    ],
    ownership: encodeOwnership(owners),
    structures: [
      { type: UnitType.Port, tile: 10 * W + 10, nation: "WESTNAT1", level: 1 },
      { type: UnitType.City, tile: 20 * W + 20, nation: "WESTNAT1", level: 3 },
      { type: UnitType.City, tile: 20 * W + 80, nation: "EASTNAT1", level: 1 },
    ],
    config: {
      difficulty: "Hard",
      donateGold: false,
      donateTroops: false,
      infiniteGold: false,
      infiniteTroops: false,
      instantBuild: true,
      disabledUnits: [UnitType.MIRV],
    },
  } as StoredScenarioDocument;
}

function rejects(
  change: (s: StoredScenarioDocument) => void,
  message: RegExp,
): void {
  const s = stored();
  change(s);
  const result = ScenarioDocumentSchema.safeParse(s);
  expect(result.success).toBe(false);
  expect(result.error!.message).toMatch(message);
}

describe("ScenarioDocumentSchema", () => {
  test("accepts a valid document and decodes it", () => {
    const doc = ScenarioDocumentSchema.parse(stored());
    expect(doc.width).toBe(W);
    expect(doc.terrain[10]).toBe(land(10));
    expect(doc.terrain[50]).toBe(IMPASSABLE);
    expect(doc.owners[10]).toBe(1);
    expect(doc.owners[80]).toBe(2);
    expect(doc.owners[50]).toBe(0);
    expect(doc.nations.map((n) => n.id)).toEqual(["WESTNAT1", "EASTNAT1"]);
    expect(doc.structures).toHaveLength(3);
  });

  test("round-trips through its stored form", () => {
    const s = stored();
    const doc = ScenarioDocumentSchema.parse(s);
    expect(serializeScenarioDocument(doc)).toEqual(s);
    const again = ScenarioDocumentSchema.parse(
      JSON.parse(JSON.stringify(serializeScenarioDocument(doc))),
    );
    expect(again).toEqual(doc);
  });

  test("keeps structures in tile order", () => {
    const s = stored();
    s.structures.reverse();
    const doc = ScenarioDocumentSchema.parse(s);
    expect(doc.structures.map((x) => x.tile)).toEqual([
      10 * W + 10,
      20 * W + 20,
      20 * W + 80,
    ]);
  });

  test("a new document is all water and valid", () => {
    const doc = newScenarioDocument("New", 200, 120);
    expect(doc.terrain.every((b) => b === 0)).toBe(true);
    expect(doc.owners.every((o) => o === 0)).toBe(true);
    expect(
      ScenarioDocumentSchema.parse(serializeScenarioDocument(doc)),
    ).toEqual(doc);
  });

  test("rejects an unknown format version", () => {
    rejects((s) => ((s as { format: number }).format = 2), /expected 1/i);
  });

  test("rejects sides that aren't multiples of 4 or are too small", () => {
    rejects((s) => (s.terrain.width = 102), /multiple of 4/);
    rejects((s) => (s.terrain.height = 96), />=100/);
  });

  test("rejects a side over 5000", () => {
    rejects((s) => (s.terrain.width = 5004), /<=5000/);
    rejects((s) => (s.terrain.height = 5004), /<=5000/);
  });

  test("rejects the wrong number of terrain bytes", () => {
    rejects(
      (s) => (s.terrain.tiles = base64(new Uint8Array(W * H - 1))),
      /9999 terrain bytes for 10000 tiles/,
    );
  });

  test("rejects a terrain byte the author can't choose", () => {
    for (const bad of [0x01, 0x40, 0xa0, 0xff]) {
      rejects((s) => {
        const bytes = new Uint8Array(W * H);
        bytes[7] = bad;
        s.terrain.tiles = base64(bytes);
        s.ownership = [0, W * H];
        s.structures = [];
      }, /tile 7 has terrain/);
    }
  });

  test("rejects ownership that doesn't cover the map", () => {
    rejects((s) => s.ownership.push(0, 1), /don't cover/);
    rejects((s) => (s.ownership = [0, W * H - 1]), /don't cover/);
    rejects((s) => (s.ownership = [0, W * H, 0]), /pairs/);
    rejects((s) => (s.ownership = [0, 0, 0, W * H]), /empty/);
  });

  test("rejects ownership of a nation that isn't there", () => {
    rejects((s) => s.nations.pop(), /names nation 2/);
  });

  test("rejects owned water", () => {
    rejects((s) => {
      s.ownership = [1, W * H];
    }, /tile 0 is owned but is not land/);
  });

  test("rejects two nations with one id", () => {
    rejects((s) => (s.nations[1].id = "WESTNAT1"), /same id/);
  });

  test("rejects a structure that can't stand where it is", () => {
    rejects((s) => (s.structures[2].nation = "WESTNAT1"), /not WESTNAT1's/);
    rejects((s) => (s.structures[1].tile = 10 * W + 10), /already has/);
    rejects(
      (s) => (s.structures[1].type = UnitType.Port),
      /port needs a shore/,
    );
    rejects(
      (s) => (s.structures[1].type = UnitType.MIRV as UnitType.City),
      /Invalid option/,
    );
    rejects(
      (s) => (s.config.disabledUnits = [UnitType.City]),
      /City is disabled/,
    );
    rejects(
      (s) => (s.structures[1].type = UnitType.DefensePost),
      /Defense Post has no levels/,
    );
  });
});

describe("alliances", () => {
  /** stored() with a third nation, with no land, to ally. */
  function withThird(): StoredScenarioDocument {
    const s = stored();
    s.nations.push({
      id: "AAAANAT1",
      name: "Third",
      flag: null,
      troops: 0,
      gold: 0,
      playable: false,
    });
    return s;
  }

  test("a document from before alliances loads with none, and saves without the field", () => {
    const s = stored();
    expect("alliances" in s).toBe(false);
    const doc = ScenarioDocumentSchema.parse(s);
    expect(doc.alliances).toEqual([]);
    expect("alliances" in serializeScenarioDocument(doc)).toBe(false);
  });

  test("are kept as pairs in order, the lesser id first, and round-trip", () => {
    const s = withThird();
    s.alliances = [
      ["WESTNAT1", "EASTNAT1"],
      ["EASTNAT1", "AAAANAT1"],
      ["WESTNAT1", "AAAANAT1"],
    ];
    const doc = ScenarioDocumentSchema.parse(s);
    const sorted = [
      ["AAAANAT1", "EASTNAT1"],
      ["AAAANAT1", "WESTNAT1"],
      ["EASTNAT1", "WESTNAT1"],
    ];
    expect(doc.alliances).toEqual(sorted);
    expect(serializeScenarioDocument(doc).alliances).toEqual(sorted);
    expect(
      ScenarioDocumentSchema.parse(
        JSON.parse(JSON.stringify(serializeScenarioDocument(doc))),
      ),
    ).toEqual(doc);
  });

  test("rejects a pair with nobody, a nation with itself, or a pair twice", () => {
    rejects((s) => (s.alliances = [["WESTNAT1", "NOBODY01"]]), /no nation/);
    rejects(
      (s) => (s.alliances = [["WESTNAT1", "WESTNAT1"]]),
      /can't ally with itself/,
    );
    rejects(
      (s) =>
        (s.alliances = [
          ["WESTNAT1", "EASTNAT1"],
          ["EASTNAT1", "WESTNAT1"],
        ]),
      /already allies/,
    );
    rejects(
      (s) =>
        (s.alliances = [
          ["WESTNAT1", "EASTNAT1", "WESTNAT1"],
        ] as unknown as StoredScenarioDocument["alliances"]),
      /expected array to have <=2 items/,
    );
  });

  test("loads every pair of the most nations a document holds", () => {
    const s = stored();
    for (let i = s.nations.length; i < MAX_NATIONS; i++) {
      s.nations.push({
        id: `N${String(i).padStart(7, "0")}`,
        name: `Nation ${i}`,
        flag: null,
        troops: 0,
        gold: 0,
        playable: false,
      });
    }
    const ids = s.nations.map((n) => n.id).reverse();
    s.alliances = ids.flatMap((a, i) =>
      ids.slice(i + 1).map((b): [string, string] => [a, b]),
    );
    const doc = ScenarioDocumentSchema.parse(s);
    expect(doc.alliances).toHaveLength((MAX_NATIONS * (MAX_NATIONS - 1)) / 2);
    expect(doc.alliances[0]).toEqual(["EASTNAT1", "N0000002"]);
  });

  test("rejects alliances when the settings disable them", () => {
    rejects((s) => {
      s.alliances = [["WESTNAT1", "EASTNAT1"]];
      s.config.customAllianceDuration = 0;
    }, /alliances are disabled/);
    // With none, such settings are fine.
    const s = stored();
    s.config.customAllianceDuration = 0;
    expect(ScenarioDocumentSchema.safeParse(s).success).toBe(true);
  });
});

describe("warships", () => {
  test("a document from before warships loads with none, and saves without the field", () => {
    const s = stored();
    expect("warships" in s).toBe(false);
    const doc = ScenarioDocumentSchema.parse(s);
    expect(doc.warships).toEqual([]);
    expect("warships" in serializeScenarioDocument(doc)).toBe(false);
  });

  test("are kept in tile order, on any water, and round-trip", () => {
    const s = stored();
    s.warships = [
      { nation: "EASTNAT1", tile: 50 * W + 95 },
      { nation: "WESTNAT1", tile: 3 },
      { nation: "WESTNAT1", tile: 20 * W + 5 },
    ];
    const doc = ScenarioDocumentSchema.parse(s);
    const sorted = [
      { nation: "WESTNAT1", tile: 3 },
      { nation: "WESTNAT1", tile: 20 * W + 5 },
      { nation: "EASTNAT1", tile: 50 * W + 95 },
    ];
    expect(doc.warships).toEqual(sorted);
    expect(serializeScenarioDocument(doc).warships).toEqual(sorted);
    expect(
      ScenarioDocumentSchema.parse(
        JSON.parse(JSON.stringify(serializeScenarioDocument(doc))),
      ),
    ).toEqual(doc);
  });

  test("rejects one for nobody, off the map, on land, or two on a tile", () => {
    rejects(
      (s) => (s.warships = [{ nation: "NOBODY01", tile: 3 }]),
      /no nation/,
    );
    rejects(
      (s) => (s.warships = [{ nation: "WESTNAT1", tile: W * H }]),
      /not on the map/,
    );
    rejects(
      (s) => (s.warships = [{ nation: "WESTNAT1", tile: 10 }]),
      /needs water, tile 10/,
    );
    rejects(
      (s) => (s.warships = [{ nation: "WESTNAT1", tile: 50 }]),
      /needs water, tile 50/,
    );
    rejects(
      (s) =>
        (s.warships = [
          { nation: "WESTNAT1", tile: 3 },
          { nation: "EASTNAT1", tile: 3 },
        ]),
      /tile 3 already has a warship/,
    );
  });

  test("rejects warships when the settings disable them, and more than MAX_WARSHIPS", () => {
    rejects((s) => {
      s.warships = [{ nation: "WESTNAT1", tile: 3 }];
      s.config.disabledUnits = [UnitType.Warship];
    }, /Warship is disabled/);
    // With none, such settings are fine.
    const s = stored();
    s.config.disabledUnits = [UnitType.Warship];
    expect(ScenarioDocumentSchema.safeParse(s).success).toBe(true);
    rejects(
      (s) =>
        (s.warships = Array.from({ length: MAX_WARSHIPS + 1 }, (_, i) => ({
          nation: "WESTNAT1",
          tile: (i % 10) + Math.floor(i / 10) * W,
        }))),
      /<=1000/,
    );
  });

  test("loads the most a document holds", () => {
    const s = stored();
    // Columns 0-9 are water; reversed, so the load sorts them.
    s.warships = Array.from({ length: MAX_WARSHIPS }, (_, i) => ({
      nation: "WESTNAT1",
      tile: (i % 10) + Math.floor(i / 10) * W,
    })).reverse();
    const doc = ScenarioDocumentSchema.parse(s);
    expect(doc.warships).toHaveLength(MAX_WARSHIPS);
    expect(doc.warships[0].tile).toBe(0);
  });
});

describe("ownership run-length encoding", () => {
  test("round-trips", () => {
    const owners = new Uint16Array(5000);
    let seed = 7;
    for (let i = 0; i < owners.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      // Runs of varied length.
      owners[i] = seed % 10 < 8 && i > 0 ? owners[i - 1] : seed % 5;
    }
    const runs = encodeOwnership(owners);
    expect(runs.length).toBeLessThan(owners.length);
    expect(decodeOwnership(runs, owners.length, 4)).toEqual(owners);
  });

  test("merges a tile with its neighbours of the same owner", () => {
    expect(encodeOwnership(Uint16Array.of(0, 0, 3, 3, 3, 0))).toEqual([
      0, 2, 3, 3, 0, 1,
    ]);
  });
});

test("isScenarioSize takes what the schema takes", () => {
  expect(isScenarioSize(100, 100)).toBe(true);
  expect(isScenarioSize(5000, 5000)).toBe(true);
  expect(isScenarioSize(5004, 100)).toBe(false);
  expect(isScenarioSize(100, 5004)).toBe(false);
  expect(isScenarioSize(102, 100)).toBe(false);
  expect(isScenarioSize(100, 96)).toBe(false);
  expect(isScenarioSize(100.5, 100)).toBe(false);
  expect(isScenarioSize(Number.NaN, 100)).toBe(false);
});

describe("newNation", () => {
  test("takes the first free name and a new valid id", () => {
    const doc = newScenarioDocument("Nations", W, H);
    const name = (n: number) => `Nation ${n}`;
    const first = newNation(doc, name);
    expect(first).toMatchObject({ name: "Nation 1", flag: null, gold: 0 });
    expect(ID.safeParse(first.id).success).toBe(true);
    doc.nations.push(first, { ...newNation(doc, name), name: "Nation 3" });
    expect(newNation(doc, name).name).toBe("Nation 2");
    doc.nations.push(newNation(doc, name));
    const fourth = newNation(doc, name);
    expect(fourth.name).toBe("Nation 4");
    expect(new Set([...doc.nations.map((n) => n.id), fourth.id]).size).toBe(4);
    // It passes the document's schema, as add_nation checks.
    doc.nations.push(fourth);
    expect(() =>
      ScenarioDocumentSchema.parse(serializeScenarioDocument(doc)),
    ).not.toThrow();
  });
});
